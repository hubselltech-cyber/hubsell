// ============================================================
// ADAPTER LAZADA — gọi API sản phẩm THẬT của Lazada, chuẩn hoá về Hubsell.
//
// Đây là nơi DUY NHẤT chứa kiến thức riêng của Lazada cho luồng sản phẩm:
//   1. Tự refresh access_token (getValidLazadaAccessToken).
//   2. Phân trang /products/get (offset/limit ≤50, filter=all để không sót
//      hàng ẩn/hết lượt bán).
//   3. TRANSFORMER: mỗi biến thể (sku) của Lazada → 1 dòng NormalizedChannelProduct.
// ============================================================

import type { Channel } from "@prisma/client";
import {
  getProducts,
  lazadaChannelSku,
  type LazadaProduct,
  type LazadaProductSku,
} from "../../integrations/lazada/client";
import { getValidLazadaAccessToken } from "../../integrations/lazada/service";
import type { MarketplaceProductAdapter, NormalizedChannelProduct } from "../types";

const PRODUCTS_PAGE = 50; // Lazada cho tối đa 50 sản phẩm/lần products/get
const MAX_PAGES = 200; // chốt chặn phân trang vô tận

// ---------- TRANSFORMER (Lazada → chuẩn Hubsell) ----------

/**
 * Trạng thái hợp lệ để BÁN: item lẫn sku đều phải active. Lazada dùng chữ
 * thường ("active"/"inactive"/"deleted"); phòng hờ so sánh không phân hoa-thường.
 */
function lazadaStatusToNorm(itemStatus?: string, skuStatus?: string): "ACTIVE" | "DELISTED" {
  const item = (itemStatus ?? "active").toLowerCase();
  const sku = (skuStatus ?? "active").toLowerCase();
  return item === "active" && sku === "active" ? "ACTIVE" : "DELISTED";
}

/** Mỗi biến thể (sku) = 1 dòng chuẩn — SKU thật của Lazada nằm ở cấp biến thể. */
function transformSku(p: LazadaProduct, s: LazadaProductSku): NormalizedChannelProduct {
  const sku = lazadaChannelSku({
    sellerSku: s.SellerSku,
    shopSku: s.ShopSku,
    itemId: p.item_id,
    skuId: s.SkuId,
  });
  // Giá bán hiện hành: ưu tiên giá khuyến mãi (special_price) nếu có.
  const price = Number(s.special_price ?? 0) || Number(s.price ?? 0) || 0;
  return {
    channelSku: sku,
    productName: p.attributes?.name ?? sku,
    variantName: s.Variation?.trim() || null,
    price,
    imageUrl: s.Images?.[0] || p.images?.[0] || null,
    externalId: `${p.item_id ?? "0"}-${s.SkuId ?? "0"}`,
    itemSku: null, // Lazada không có SKU tổng cấp item — SellerSku nằm ở từng skus[]
    // Tồn trên sàn: Lazada trả `quantity` ở cấp biến thể; thiếu trường = null.
    channelStock: typeof s.quantity === "number" ? s.quantity : null,
    status: lazadaStatusToNorm(p.status, s.Status),
  };
}

// ---------- ADAPTER ----------

export const lazadaProductAdapter: MarketplaceProductAdapter = {
  name: "lazada",

  async fetchProducts(channel: Channel): Promise<NormalizedChannelProduct[]> {
    // (1) Tự refresh token trước khi gọi — token mới được lưu xuống DB.
    const accessToken = await getValidLazadaAccessToken(channel);

    // (2) Phân trang /products/get.
    const products: LazadaProduct[] = [];
    let offset = 0;
    let page = 0;
    for (;;) {
      const r = await getProducts(accessToken, offset, PRODUCTS_PAGE);
      products.push(...r.products);
      page++;
      if (r.products.length < PRODUCTS_PAGE || page >= MAX_PAGES) break;
      offset += r.products.length;
    }

    // (3) Chuẩn hoá: mỗi biến thể một dòng; sản phẩm không khai skus vẫn ra
    // 1 dòng (khoá tổng hợp từ item_id) để không mất sản phẩm nào.
    const normalized: NormalizedChannelProduct[] = [];
    for (const p of products) {
      const skus = p.skus ?? [];
      if (skus.length === 0) {
        normalized.push(transformSku(p, {}));
        continue;
      }
      for (const s of skus) normalized.push(transformSku(p, s));
    }

    // Gộp dòng TRÙNG channelSku (người bán đặt chung SellerSku cho nhiều biến
    // thể) — một SKU bán là MỘT dòng kho, variant để null vì không xác định.
    const bySku = new Map<string, NormalizedChannelProduct>();
    for (const p of normalized) {
      const existing = bySku.get(p.channelSku);
      if (existing) {
        existing.variantName = null;
        // Mỗi biến thể giữ tồn RIÊNG trên sàn — gộp dòng thì CỘNG tồn.
        if (p.channelStock !== null) {
          existing.channelStock = (existing.channelStock ?? 0) + p.channelStock;
        }
      } else bySku.set(p.channelSku, p);
    }
    return [...bySku.values()];
  },
};
