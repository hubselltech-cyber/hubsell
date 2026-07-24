// ============================================================
// ADAPTER SHOPEE — gọi API sản phẩm THẬT của Shopee, chuẩn hoá về Hubsell.
//
// Đây là nơi DUY NHẤT chứa kiến thức riêng của Shopee cho luồng sản phẩm:
//   1. Tự refresh access_token (getValidShopeeAccessToken).
//   2. Phân trang get_item_list (offset/has_next_page/next_offset), lấy ĐỦ mọi
//      item_status để không sót sản phẩm mới đăng/đang chờ.
//   3. get_item_base_info (lô ≤50) + get_model_list (SKU thật ở cấp model).
//   4. TRANSFORMER: đổi cấu trúc Shopee → NormalizedChannelProduct.
// ============================================================

import type { Channel } from "@prisma/client";
import {
  getItemBaseInfo,
  getItemList,
  getModelList,
  shopeeChannelSku,
  type ShopeeItemBaseInfo,
  type ShopeeModel,
} from "../../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../../integrations/shopee/service";
import type { MarketplaceProductAdapter, NormalizedChannelProduct } from "../types";

const ITEM_LIST_PAGE = 100; // Shopee cho tối đa 100 item/lần get_item_list
const BASE_INFO_BATCH = 50; // tối đa 50 item_id/lần get_item_base_info
const MAX_PAGES = 200; // chốt chặn phân trang vô tận

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
    status: shopeeStatusToNorm(info.item_status),
  };
}

// ---------- ADAPTER ----------

export const shopeeProductAdapter: MarketplaceProductAdapter = {
  name: "shopee",

  async fetchProducts(channel: Channel): Promise<NormalizedChannelProduct[]> {
    // (4) Tự refresh token trước khi gọi — nếu access_token sắp/đã hết hạn,
    // hàm này gọi refresh_token và lưu token mới xuống DB.
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

    // (2) Phân trang get_item_list — gom hết item_id (đủ mọi item_status).
    const itemIds: number[] = [];
    let offset = 0;
    let page = 0;
    for (;;) {
      const list = await getItemList({
        accessToken,
        shopId,
        offset,
        pageSize: ITEM_LIST_PAGE,
      });
      const batch = list.response?.item ?? [];
      for (const it of batch) itemIds.push(it.item_id);

      page++;
      const hasNext = list.response?.has_next_page && batch.length > 0;
      if (!hasNext || page >= MAX_PAGES) break;
      // Shopee đưa next_offset để lấy trang tiếp; fallback cộng dồn nếu thiếu.
      offset = list.response?.next_offset ?? offset + batch.length;
    }

    // Khử trùng item_id (get_item_list đôi khi trả trùng qua các trang) để không
    // gọi chi tiết/model thừa và không thổi phồng số liệu.
    const uniqueIds = Array.from(new Set(itemIds));
    if (uniqueIds.length === 0) return [];

    // (3) Lấy chi tiết theo lô ≤50 + model → chuẩn hoá.
    const normalized: NormalizedChannelProduct[] = [];
    for (let i = 0; i < uniqueIds.length; i += BASE_INFO_BATCH) {
      const ids = uniqueIds.slice(i, i + BASE_INFO_BATCH);
      const infos = await getItemBaseInfo(accessToken, shopId, ids);
      for (const info of infos) {
        if (info.has_model) {
          const models = await getModelList(accessToken, shopId, info.item_id);
          if (models.length > 0) {
            for (const m of models) normalized.push(transformModel(info, m));
            continue;
          }
        }
        normalized.push(transformItem(info));
      }
    }

    // Gộp các dòng TRÙNG channelSku: người bán có thể đặt CHUNG một SKU cho nhiều
    // model (vd Áo gió 9 màu×size cùng "AOGIO_001"). Về mặt kho, đó là MỘT SKU bán
    // (đơn hàng cũng tham chiếu đúng SKU đó) → gộp về 1 dòng, variant để null vì
    // không xác định. Nhờ vậy số liệu & bảng đệm phản ánh đúng số SKU thật.
    const bySku = new Map<string, NormalizedChannelProduct>();
    for (const p of normalized) {
      const existing = bySku.get(p.channelSku);
      if (existing) existing.variantName = null;
      else bySku.set(p.channelSku, p);
    }
    return [...bySku.values()];
  },
};
