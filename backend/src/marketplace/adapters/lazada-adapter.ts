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
import type {
  FetchedProducts,
  FetchProductsOptions,
  MarketplaceProductAdapter,
  NormalizedChannelProduct,
} from "../types";

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

/** "Nâu, 3-5kg" từ saleProp (giữ thứ tự sàn trả); rỗng/thiếu → null. */
export function lazadaVariantFromSaleProp(
  saleProp: Record<string, unknown> | null | undefined
): string | null {
  if (!saleProp || typeof saleProp !== "object") return null;
  const parts = Object.values(saleProp)
    .map((v) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
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
    // /products/get thật (Hi.Bé 15/10: 258 dòng đều trống tên) không trả
    // `Variation` — tên phân loại nằm ở saleProp {color_family: "Nâu", size: "3-5kg"}.
    variantName: s.Variation?.trim() || lazadaVariantFromSaleProp(s.saleProp),
    price,
    imageUrl: s.Images?.[0] || p.images?.[0] || null,
    externalId: `${p.item_id ?? "0"}-${s.SkuId ?? "0"}`,
    itemSku: null, // Lazada không có SKU tổng cấp item — SellerSku nằm ở từng skus[]
    // Tồn trên sàn: Lazada trả `quantity` ở cấp biến thể; thiếu trường = null.
    channelStock: typeof s.quantity === "number" ? s.quantity : null,
    channelStockLocationId: null, // Lazada VN: sellable update không theo kho
    status: lazadaStatusToNorm(p.status, s.Status),
    sourceUpdatedAt: lazadaUpdatedAtSec(p.updated_time),
  };
}

/** updated_time của Lazada là mili-giây epoch (chuỗi hoặc số) → giây; không đọc được = null. */
export function lazadaUpdatedAtSec(raw: string | number | undefined): number | null {
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
}

// ---------- ADAPTER ----------

export const lazadaProductAdapter: MarketplaceProductAdapter = {
  name: "lazada",
  // Đọc tăng dần bằng `update_after` của /products/get (docs chính thức đọc 05/11/2026). CHƯA đo trên
  // gian thật: bán hàng làm đổi tồn có làm đổi updated_time không → lượt toàn bộ định kỳ đo đối chiếu.
  supportsIncremental: true,

  async fetchProducts(channel: Channel, opts?: FetchProductsOptions): Promise<FetchedProducts> {
    // (1) Tự refresh token trước khi gọi — token mới được lưu xuống DB.
    const accessToken = await getValidLazadaAccessToken(channel);
    const updateAfter = opts?.since ? opts.since.toISOString() : undefined;

    // (2) Phân trang /products/get. Lượt tăng dần phân trang trong tập đã lọc theo update_after;
    // chạm chốt chặn (200 trang = 10.000 sản phẩm, cũng là trần offset của sàn) thì báo chưa đủ,
    // mốc không tiến, lượt sau đọc lại.
    const products: LazadaProduct[] = [];
    let offset = 0;
    let page = 0;
    let complete = true;
    for (;;) {
      const r = await getProducts(accessToken, offset, PRODUCTS_PAGE, undefined, updateAfter);
      products.push(...r.products);
      page++;
      if (r.products.length < PRODUCTS_PAGE) break;
      if (page >= MAX_PAGES) {
        complete = false; // còn trang mà chạm chốt chặn — danh mục CHƯA đủ
        break;
      }
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

    // KHÔNG gộp dòng trùng SellerSku (15/10/2026, cùng luật 3 sàn): Lazada vốn
    // bắt SellerSku duy nhất trong gian nên hiếm khi trùng; có trùng thì
    // product-sync gán đuôi tên phân loại (marketplace/sku-key.ts).
    return { products: normalized, complete, apiCalls: page, ...(updateAfter ? { incremental: true } : {}) };
  },
};
