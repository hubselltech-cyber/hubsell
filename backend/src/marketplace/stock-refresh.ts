// ============================================================
// LÀM MỚI TỒN SÀN CHO RIÊNG CÁC SKU ĐÃ NỐI (targeted refresh)
//
// Màn so sánh trước khi bật đồng bộ và worker đối soát chỉ cần số tồn của
// những SKU sàn ĐÃ nối về kho — kéo nguyên danh mục (syncChannelProducts) cho
// shop 300-400 SKU là hàng trăm call dồn dập, Shopee chặn error_rate_limit
// ngay (sự cố DarkMan Store 05/09). Ở đây:
//   · Shopee: gom item_id của SKU đã nối → get_item_base_info lô ≤50, chỉ gọi
//     get_model_list cho item có SKU nối ở cấp model; giãn nhịp giữa các call.
//   · Lazada: /products/get 50 sp/trang không lọc được theo SKU, nhưng ít call
//     (376 sp = 8 trang) và sàn dễ tính → dùng lại adapter, chỉ ghi SKU đã nối.
// KHÔNG tạo/đánh DELISTED gì — chỉ cập nhật channelStock (+ location Shopee)
// của các dòng đã nối. Ném lỗi khi không đọc được sàn để nơi gọi tự báo.
// ============================================================

import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  getItemBaseInfo,
  getModelList,
  shopeeSellerStock,
  shopeeStockLocationId,
} from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";
import { parseShopeeExternalId } from "../integrations/shopee/inventory-sync";
import { getProductAdapter } from "./registry";

const BASE_INFO_BATCH = 50;
const PACE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StockRefreshResult {
  /** Số SKU đã nối được cập nhật tồn sàn. */
  refreshed: number;
  /** Số SKU đã nối mà sàn không trả số (giữ nguyên số cũ). */
  missing: number;
}

/** Tồn sàn mới nhất cho các SKU ĐÃ NỐI của một gian — ghi vào ChannelProduct.channelStock. */
export async function refreshLinkedChannelStock(channel: Channel): Promise<StockRefreshResult> {
  const linked = await prisma.channelProduct.findMany({
    where: {
      channelId: channel.id,
      productId: { not: null },
      externalId: { not: null },
      status: "ACTIVE",
    },
    select: { id: true, channelSku: true, externalId: true },
  });
  if (linked.length === 0) return { refreshed: 0, missing: 0 };

  if (channel.channelName === ChannelName.SHOPEE) {
    return refreshShopee(channel, linked);
  }

  // Lazada (và sàn khác có adapter): kéo danh mục rồi chỉ ghi các dòng đã nối.
  const adapter = getProductAdapter(channel);
  const products = await adapter.fetchProducts(channel);
  const bySku = new Map(products.map((p) => [p.channelSku, p]));
  const now = new Date();
  let refreshed = 0;
  let missing = 0;
  for (const row of linked) {
    const p = bySku.get(row.channelSku);
    if (!p || p.channelStock === null) {
      missing++;
      continue;
    }
    await prisma.channelProduct.update({
      where: { id: row.id },
      data: { channelStock: p.channelStock, lastSyncedAt: now },
    });
    refreshed++;
  }
  return { refreshed, missing };
}

async function refreshShopee(
  channel: Channel,
  linked: { id: string; channelSku: string; externalId: string | null }[]
): Promise<StockRefreshResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

  // Gom theo item: SKU nối ở cấp item (externalId "123") đọc từ base_info;
  // cấp model ("123-456") phải qua get_model_list của item đó.
  const itemLevel = new Map<number, string>(); // itemId → row.id
  const modelLevel = new Map<number, Map<number, string>>(); // itemId → modelId → row.id
  for (const row of linked) {
    const ids = parseShopeeExternalId(row.externalId);
    if (!ids) continue;
    if (ids.modelId) {
      const m = modelLevel.get(ids.itemId) ?? new Map<number, string>();
      m.set(ids.modelId, row.id);
      modelLevel.set(ids.itemId, m);
    } else {
      itemLevel.set(ids.itemId, row.id);
    }
  }
  const itemIds = [...new Set([...itemLevel.keys(), ...modelLevel.keys()])];

  const now = new Date();
  let refreshed = 0;
  let missing = 0;
  const seen = new Set<string>();

  for (let i = 0; i < itemIds.length; i += BASE_INFO_BATCH) {
    if (i > 0) await sleep(PACE_MS);
    const infos = await getItemBaseInfo(accessToken, shopId, itemIds.slice(i, i + BASE_INFO_BATCH));
    for (const info of infos) {
      const rowId = itemLevel.get(info.item_id);
      if (rowId) {
        const stock = shopeeSellerStock(info.stock_info_v2);
        seen.add(rowId);
        if (stock === null) missing++;
        else {
          await prisma.channelProduct.update({
            where: { id: rowId },
            data: {
              channelStock: stock,
              channelStockLocationId: shopeeStockLocationId(info.stock_info_v2),
              lastSyncedAt: now,
            },
          });
          refreshed++;
        }
      }
      const models = modelLevel.get(info.item_id);
      if (models) {
        await sleep(PACE_MS);
        const list = await getModelList(accessToken, shopId, info.item_id);
        for (const m of list) {
          const mRow = models.get(m.model_id);
          if (!mRow) continue;
          seen.add(mRow);
          const stock = shopeeSellerStock(m.stock_info_v2);
          if (stock === null) {
            missing++;
            continue;
          }
          await prisma.channelProduct.update({
            where: { id: mRow },
            data: {
              channelStock: stock,
              channelStockLocationId: shopeeStockLocationId(m.stock_info_v2),
              lastSyncedAt: now,
            },
          });
          refreshed++;
        }
      }
    }
  }

  // SKU nối nhưng sàn không còn trả item/model đó (đã xóa/ẩn) → coi như thiếu số.
  missing += linked.filter((r) => !seen.has(r.id)).length;
  return { refreshed, missing };
}
