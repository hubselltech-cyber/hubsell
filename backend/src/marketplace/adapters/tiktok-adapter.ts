// ============================================================
// ADAPTER TIKTOK SHOP — gọi API sản phẩm THẬT (Product API 202309), chuẩn hoá
// về Hubsell. Mirror lazada-adapter (16/09/2026, shop nhà and.not.or đã ủy quyền).
//
// Nơi DUY NHẤT chứa kiến thức riêng của TikTok cho luồng sản phẩm:
//   1. Tự refresh access_token (getValidAccessToken) + shop_cipher.
//   2. Phân trang POST /product/202309/products/search (page_token, ≤100/trang),
//      không lọc trạng thái để không sót hàng ẩn/khóa (đánh DELISTED thay vì mất).
//   3. TRANSFORMER: mỗi SKU của TikTok → 1 dòng NormalizedChannelProduct.
//      externalId = "productId-skuId" (worker đẩy tồn bóc ra để gọi
//      inventory/update); channelStockLocationId = warehouse_id đang giữ tồn
//      (TikTok ghi tồn theo kho — thiếu thì worker tự tra kho mặc định).
// ============================================================

import type { Channel } from "@prisma/client";
import {
  searchProducts,
  type TikTokProduct,
  type TikTokProductSku,
} from "../../integrations/tiktok/client";
import { getValidAccessToken } from "../../integrations/tiktok/service";
import type { MarketplaceProductAdapter, NormalizedChannelProduct } from "../types";

const PRODUCTS_PAGE = 100;
const MAX_PAGES = 200; // chốt chặn phân trang vô tận

/**
 * Sinh KHOÁ SKU CHUẨN cho một biến thể TikTok — DÙNG CHUNG cho đồng bộ sản
 * phẩm lẫn đồng bộ đơn (đơn: line_item.seller_sku || sku_id || id) để hai
 * luồng khớp khoá. Ưu tiên seller_sku người bán tự đặt; trống thì sku_id.
 */
export function tiktokChannelSku(sku: Pick<TikTokProductSku, "id" | "seller_sku">): string {
  const seller = sku.seller_sku?.trim();
  if (seller) return seller;
  return sku.id ? String(sku.id) : "";
}

/** ACTIVATE = đang bán; mọi trạng thái khác (nháp, chờ duyệt, khóa, xóa…) = DELISTED. */
export function tiktokStatusToNorm(status?: string): "ACTIVE" | "DELISTED" {
  return (status ?? "ACTIVATE").toUpperCase() === "ACTIVATE" ? "ACTIVE" : "DELISTED";
}

/** Tên phân loại từ sales_attributes ("Đen, XL"); rỗng nếu sản phẩm đơn. */
function variantNameOf(sku: TikTokProductSku): string | null {
  const parts = (sku.sales_attributes ?? [])
    .map((a) => a.value_name?.trim())
    .filter((v): v is string => Boolean(v));
  return parts.length ? parts.join(", ") : null;
}

function firstImage(p: TikTokProduct, sku: TikTokProductSku): string | null {
  const skuImg = (sku.sales_attributes ?? []).map((a) => a.sku_img?.url).find(Boolean);
  if (skuImg) return skuImg;
  const main = p.main_images?.[0];
  return main?.url || main?.urls?.[0] || main?.thumb_urls?.[0] || null;
}

/** Mỗi SKU = 1 dòng chuẩn. Tồn = Σ các kho (TikTok ghi tồn theo warehouse). */
export function transformTiktokSku(p: TikTokProduct, s: TikTokProductSku): NormalizedChannelProduct {
  const sku = tiktokChannelSku(s) || `TTK-${p.id}`;
  const inventory = s.inventory ?? [];
  const hasStock = inventory.some((i) => typeof i.quantity === "number");
  const stock = hasStock ? inventory.reduce((sum, i) => sum + (i.quantity ?? 0), 0) : null;
  // Kho đang giữ tồn (ưu tiên kho có số > 0, không thì kho đầu tiên).
  const warehouseId =
    inventory.find((i) => (i.quantity ?? 0) > 0)?.warehouse_id ?? inventory[0]?.warehouse_id ?? null;
  return {
    channelSku: sku,
    productName: p.title?.trim() || sku,
    variantName: variantNameOf(s),
    price: Number(s.price?.sale_price ?? s.price?.tax_exclusive_price ?? 0) || 0,
    imageUrl: firstImage(p, s),
    externalId: s.id ? `${p.id}-${s.id}` : null,
    itemSku: null,
    channelStock: stock,
    channelStockLocationId: warehouseId,
    status: tiktokStatusToNorm(p.status),
  };
}

export const tiktokProductAdapter: MarketplaceProductAdapter = {
  name: "tiktok",

  async fetchProducts(channel: Channel): Promise<NormalizedChannelProduct[]> {
    const { accessToken, shopCipher } = await getValidAccessToken(channel);

    const products: TikTokProduct[] = [];
    let pageToken: string | undefined;
    let page = 0;
    let shapeLogged = false;
    do {
      const r = await searchProducts({ accessToken, shopCipher, pageSize: PRODUCTS_PAGE, pageToken });
      products.push(...r.products);
      page++;
      if (!shapeLogged && r.products[0] && process.env.TIKTOK_SHAPE_LOG !== "0") {
        shapeLogged = true;
        const p0 = r.products[0];
        const s0 = p0.skus?.[0];
        console.log(
          `[TikTok] Hình dạng sản phẩm (products/search): keys=[${Object.keys(p0).join(",")}] sku=[${Object.keys(s0 ?? {}).join(",")}] price=[${Object.keys(s0?.price ?? {}).join(",")}] inventory=[${Object.keys(s0?.inventory?.[0] ?? {}).join(",")}] status=${JSON.stringify(p0.status)}`
        );
      }
      pageToken = r.next_page_token || undefined;
    } while (pageToken && page < MAX_PAGES);

    const normalized: NormalizedChannelProduct[] = [];
    for (const p of products) {
      const skus = p.skus ?? [];
      if (skus.length === 0) {
        normalized.push(transformTiktokSku(p, { id: "" }));
        continue;
      }
      for (const s of skus) normalized.push(transformTiktokSku(p, s));
    }

    // Gộp dòng TRÙNG channelSku (người bán đặt chung seller_sku cho nhiều biến
    // thể) — một SKU bán là MỘT dòng kho, variant để null, tồn CỘNG dồn.
    const bySku = new Map<string, NormalizedChannelProduct>();
    for (const p of normalized) {
      const existing = bySku.get(p.channelSku);
      if (existing) {
        existing.variantName = null;
        if (p.channelStock !== null) {
          existing.channelStock = (existing.channelStock ?? 0) + p.channelStock;
        }
      } else bySku.set(p.channelSku, p);
    }
    return [...bySku.values()];
  },
};
