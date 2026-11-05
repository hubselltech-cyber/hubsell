// ============================================================
// ADAPTER SHOPEE — gọi API sản phẩm THẬT của Shopee, chuẩn hoá về Hubsell.
//
// Đây là nơi DUY NHẤT chứa kiến thức riêng của Shopee cho luồng sản phẩm:
//   1. Tự refresh access_token (getValidShopeeAccessToken).
//   2. Phân trang get_item_list (offset/has_next_page/next_offset), lấy ĐỦ mọi
//      item_status để không sót sản phẩm mới đăng/đang chờ.
//   3. get_item_base_info (lô ≤50) + get_model_list (SKU thật ở cấp model).
//      Shopee tối đa 2 tầng phân loại; get_model_list trả MỖI TỔ HỢP đủ tầng là
//      một model (tier_index [i, j]) — không có phân loại lồng nhau, không cần
//      gọi thêm API nào để tới phân loại lá (đối chiếu docs 15/10/2026).
//   4. TRANSFORMER: đổi cấu trúc Shopee → NormalizedChannelProduct, mỗi model
//      một dòng KỂ CẢ khi trùng model_sku (khóa duy nhất gán ở product-sync).
// ============================================================

import type { Channel } from "@prisma/client";
import {
  getItemBaseInfo,
  getItemList,
  getModelList,
  shopeeChannelSku,
  shopeeSellerStock,
  shopeeStockLocationId,
  type ShopeeItemBaseInfo,
  type ShopeeModel,
} from "../../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../../integrations/shopee/service";
import { prisma } from "../../lib/prisma";
import { SkipBudget, withTransientRetry } from "../transient-retry";
import type {
  FetchedProducts,
  FetchProductsOptions,
  MarketplaceProductAdapter,
  NormalizedChannelProduct,
} from "../types";

const ITEM_LIST_PAGE = 100; // Shopee cho tối đa 100 item/lần get_item_list
const BASE_INFO_BATCH = 50; // tối đa 50 item_id/lần get_item_base_info
const MAX_PAGES = 200; // chốt chặn phân trang vô tận
/** Giãn nhịp giữa hai call chi tiết/model trong cùng một lượt kéo (né rate limit). */
const PACE_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- TRANSFORMER (Shopee → chuẩn Hubsell) ----------

function shopeeStatusToNorm(status?: string): "ACTIVE" | "DELISTED" {
  return status === "NORMAL" ? "ACTIVE" : "DELISTED";
}

/** Sản phẩm ĐƠN (không có phân loại): 1 item = 1 dòng chuẩn. */
function transformItem(info: ShopeeItemBaseInfo): NormalizedChannelProduct {
  const sku = shopeeChannelSku({ itemId: info.item_id, itemSku: info.item_sku });
  const price = Number(info.price_info?.[0]?.current_price ?? 0) || 0;
  return {
    channelSku: sku,
    productName: info.item_name ?? sku,
    variantName: null,
    price,
    imageUrl: info.image?.image_url_list?.[0] ?? null,
    externalId: String(info.item_id),
    itemSku: info.item_sku?.trim() || null,
    channelStock: shopeeSellerStock(info.stock_info_v2),
    channelStockLocationId: shopeeStockLocationId(info.stock_info_v2),
    status: shopeeStatusToNorm(info.item_status),
  };
}

/** Sản phẩm CÓ phân loại: mỗi model = 1 dòng chuẩn (SKU + giá riêng). */
function transformModel(
  info: ShopeeItemBaseInfo,
  model: ShopeeModel
): NormalizedChannelProduct {
  const sku = shopeeChannelSku({
    itemId: info.item_id,
    modelId: model.model_id,
    itemSku: info.item_sku,
    modelSku: model.model_sku,
    modelName: model.model_name,
  });
  const price =
    Number(model.price_info?.[0]?.current_price ?? info.price_info?.[0]?.current_price ?? 0) || 0;
  return {
    channelSku: sku,
    productName: info.item_name ?? sku,
    variantName: model.model_name ?? null,
    price,
    imageUrl: info.image?.image_url_list?.[0] ?? null,
    externalId: `${info.item_id}-${model.model_id}`,
    itemSku: info.item_sku?.trim() || null,
    channelStock: shopeeSellerStock(model.stock_info_v2),
    channelStockLocationId: shopeeStockLocationId(model.stock_info_v2),
    status: shopeeStatusToNorm(info.item_status),
  };
}

// ---------- CHỌN SẢN PHẨM CẦN ĐỌC CHI TIẾT (lượt tăng dần, 05/11/2026) ----------

export interface ShopeeListedItem {
  item_id: number;
  item_status?: string;
  update_time?: number;
}

export interface ShopeeRefreshPick {
  ids: number[];
  /** Số sản phẩm chọn theo từng lý do (một sản phẩm chỉ tính lý do đầu tiên khớp). */
  reasons: { changed: number; noTime: number; newToDb: number; statusDiff: number };
}

/**
 * Lượt tăng dần của Shopee: get_item_list vẫn đọc ĐỦ danh sách id (rẻ: 100 sản phẩm một lệnh, kèm
 * update_time + item_status từng sản phẩm), chỉ gọi chi tiết (get_item_base_info + get_model_list —
 * phần tốn gần hết thời gian) cho sản phẩm:
 *   · sàn báo đổi từ mốc (update_time ≥ sinceSec);
 *   · sàn không trả update_time (không biết → coi như đổi, không đoán);
 *   · chưa có dòng nào trong DB (lượt trước sót / sản phẩm mới) — trừ sản phẩm đã xóa / bị khóa;
 *   · trạng thái ở danh sách khác trạng thái đang lưu (NORMAL ↔ không còn dòng ACTIVE và ngược lại).
 * Cách này KHÔNG dùng tham số lọc update_time_from/to của sàn: trang tài liệu chính thức của
 * get_item_list không mở được lúc làm (05/11/2026) nên không biết giới hạn cửa sổ — không đoán.
 * `dbItems`: item_id → gian đang có ít nhất một dòng ACTIVE của sản phẩm đó hay không. Hàm thuần.
 */
export function pickShopeeItemsToRefresh(
  items: ShopeeListedItem[],
  sinceSec: number,
  dbItems: Map<string, boolean>
): ShopeeRefreshPick {
  const reasons = { changed: 0, noTime: 0, newToDb: 0, statusDiff: 0 };
  const ids: number[] = [];
  for (const it of items) {
    const db = dbItems.get(String(it.item_id));
    if (typeof it.update_time !== "number") reasons.noTime++;
    else if (it.update_time >= sinceSec) reasons.changed++;
    else if (db === undefined) {
      // Sản phẩm đã xóa / bị khóa mà DB chưa từng có dòng: không cần dòng nào → không đọc lại mỗi lượt.
      if (it.item_status === "DELETED" || it.item_status === "BANNED") continue;
      reasons.newToDb++;
    } else if (it.item_status !== undefined && (it.item_status === "NORMAL") !== db) reasons.statusDiff++;
    else continue;
    ids.push(it.item_id);
  }
  return { ids, reasons };
}

/** item_id (đoạn đầu externalId) → gian còn dòng ACTIVE của sản phẩm đó không. Một câu GROUP BY. */
async function loadDbItemIndex(channelId: string): Promise<Map<string, boolean>> {
  const rows = await prisma.$queryRaw<{ item: string; active: boolean }[]>`
    SELECT split_part("externalId", '-', 1) AS item, bool_or(status = 'ACTIVE') AS active
    FROM "ChannelProduct"
    WHERE "channelId" = ${channelId} AND "externalId" IS NOT NULL
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.item, r.active]));
}

// ---------- ADAPTER ----------

export const shopeeProductAdapter: MarketplaceProductAdapter = {
  name: "shopee",
  supportsIncremental: true,

  async fetchProducts(channel: Channel, opts?: FetchProductsOptions): Promise<FetchedProducts> {
    // (4) Tự refresh token trước khi gọi — nếu access_token sắp/đã hết hạn,
    // hàm này gọi refresh_token và lưu token mới xuống DB.
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    let apiCalls = 0;

    // (2) Phân trang get_item_list — gom hết item_id (đủ mọi item_status). Lượt tăng dần cũng đọc
    // đủ danh sách này: nó cho update_time + item_status của MỌI sản phẩm với 1 lệnh / 100 sản phẩm.
    // Khử trùng item_id (get_item_list đôi khi trả trùng qua các trang) để không gọi chi tiết/model
    // thừa và không thổi phồng số liệu.
    const listed = new Map<number, ShopeeListedItem>();
    let offset = 0;
    let page = 0;
    let complete = true;
    for (;;) {
      apiCalls++;
      const list = await withTransientRetry(
        () =>
          getItemList({
            accessToken,
            shopId,
            offset,
            pageSize: ITEM_LIST_PAGE,
          }),
        `Shopee "${channel.shopName}" get_item_list`
      );
      const batch = list.response?.item ?? [];
      for (const it of batch) if (!listed.has(it.item_id)) listed.set(it.item_id, it);

      page++;
      const hasNext = list.response?.has_next_page && batch.length > 0;
      if (!hasNext) break;
      if (page >= MAX_PAGES) {
        complete = false; // còn trang mà chạm chốt chặn — danh mục CHƯA đủ
        break;
      }
      // Shopee đưa next_offset để lấy trang tiếp; fallback cộng dồn nếu thiếu.
      offset = list.response?.next_offset ?? offset + batch.length;
    }

    const incremental = Boolean(opts?.since);
    let uniqueIds = [...listed.keys()];
    if (opts?.since) {
      const pick = pickShopeeItemsToRefresh(
        [...listed.values()],
        Math.floor(opts.since.getTime() / 1000),
        await loadDbItemIndex(channel.id)
      );
      const r = pick.reasons;
      console.log(
        `[Catalog-sync] Shopee "${channel.shopName}" tăng dần: ${listed.size} SP trên sàn, đọc chi tiết ${pick.ids.length} ` +
          `(sàn báo đổi ${r.changed}, chưa có trong DB ${r.newToDb}, lệch trạng thái ${r.statusDiff}, sàn không trả update_time ${r.noTime})`
      );
      uniqueIds = pick.ids;
    }
    if (uniqueIds.length === 0) return { products: [], complete, apiCalls, ...(incremental ? { incremental } : {}) };
    // Lượt toàn bộ có đo đối chiếu: đánh dấu sản phẩm mà lượt tăng dần từ mốc đó CŨNG sẽ đọc chi tiết.
    const shadowPicked = opts?.shadowSince
      ? new Set(
          pickShopeeItemsToRefresh(
            [...listed.values()],
            Math.floor(opts.shadowSince.getTime() / 1000),
            await loadDbItemIndex(channel.id)
          ).ids
        )
      : null;

    // (3) Lấy chi tiết theo lô ≤50 + model → chuẩn hoá. Giãn nhịp giữa các
    // call (shop 300-400 SKU = hàng trăm get_model_list) để né error_rate_limit;
    // client còn tự retry khi vẫn bị chặn.
    //
    // ★ 03/11/2026: sàn chậm một lệnh không được bỏ cả lượt (Hy Korea 38.889 dòng hỏng sau 10 phút vì
    // một get_model_list quá 30 giây). Thử lại lệnh đó; vẫn hỏng thì bỏ qua đúng phần đó, dòng cũ giữ
    // nguyên và danh mục báo chưa đủ để không đánh dấu gỡ nhầm. Hỏng liên tiếp nhiều thì dừng.
    const normalized: NormalizedChannelProduct[] = [];
    const stamp = (p: NormalizedChannelProduct, itemId: number): NormalizedChannelProduct => ({
      ...p,
      sourceUpdatedAt: listed.get(itemId)?.update_time ?? null,
      ...(shadowPicked ? { inIncrementalWindow: shadowPicked.has(itemId) } : {}),
    });
    const budget = new SkipBudget();
    for (let i = 0; i < uniqueIds.length; i += BASE_INFO_BATCH) {
      const ids = uniqueIds.slice(i, i + BASE_INFO_BATCH);
      if (i > 0) await sleep(PACE_MS);
      let infos: Awaited<ReturnType<typeof getItemBaseInfo>>;
      try {
        apiCalls++;
        infos = await withTransientRetry(
          () => getItemBaseInfo(accessToken, shopId, ids),
          `Shopee "${channel.shopName}" get_item_base_info`
        );
        budget.ok();
      } catch (err) {
        budget.skip(err);
        continue;
      }
      for (const info of infos) {
        if (info.has_model) {
          await sleep(PACE_MS);
          let models: Awaited<ReturnType<typeof getModelList>>;
          try {
            apiCalls++;
            models = await withTransientRetry(
              () => getModelList(accessToken, shopId, info.item_id),
              `Shopee "${channel.shopName}" get_model_list`
            );
            budget.ok();
          } catch (err) {
            budget.skip(err);
            continue;
          }
          if (models.length > 0) {
            for (const m of models) normalized.push(stamp(transformModel(info, m), info.item_id));
            continue;
          }
        }
        normalized.push(stamp(transformItem(info), info.item_id));
      }
    }
    if (budget.skipped > 0) {
      complete = false;
      console.warn(`[Catalog-sync] Shopee "${channel.shopName}": bỏ qua ${budget.skipped} phần do sàn chậm, lượt này chưa đủ`);
    }

    // KHÔNG gộp dòng trùng model_sku (sửa 15/10/2026, sự cố Hi.Bé): người bán bấm
    // "Áp dụng cho tất cả phân loại" là 5 size cùng một mã — gộp lại thì chỉ còn
    // 1 model nhận tồn. Mỗi model = một dòng; khóa duy nhất do product-sync gán
    // (marketplace/sku-key.ts: đuôi tên phân loại).
    return { products: normalized, complete, apiCalls, ...(incremental ? { incremental } : {}) };
  },
};
