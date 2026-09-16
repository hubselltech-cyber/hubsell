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
  getProduct,
  searchProducts,
  type TikTokProduct,
  type TikTokProductSku,
} from "../../integrations/tiktok/client";
import { getValidAccessToken } from "../../integrations/tiktok/service";
import { prisma } from "../../lib/prisma";
import type {
  FetchProductsOptions,
  MarketplaceProductAdapter,
  NormalizedChannelProduct,
} from "../types";

const PRODUCTS_PAGE = 100;
const MAX_PAGES = 200; // chốt chặn phân trang vô tận
/**
 * products/search (payload thật 16/09) KHÔNG trả ảnh lẫn tên phân loại — chỉ
 * GET /products/{id} mới có main_images + sales_attributes. Mỗi lượt kéo bổ
 * sung chi tiết cho tối đa N sản phẩm (giãn nhịp), ƯU TIÊN sản phẩm CHƯA có
 * ảnh trong DB (ChannelProduct.imageUrl) — không dựa cache RAM: server khởi
 * động lại là cache trống, nếu xếp theo thứ tự danh mục thì 60 sản phẩm đầu
 * bị kéo lại mãi còn phần sau không bao giờ tới lượt (lỗi thật 16/09 chiều).
 * Cache (id, update_time) chỉ để tránh gọi lặp trong cùng tiến trình.
 */
const DETAIL_PER_RUN = 100;
const DETAIL_PACE_MS = 120;
const detailCache = new Map<string, { updateTime: number; product: TikTokProduct }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tập product_id ĐÃ có ảnh trong DB của gian → coi là đã bổ sung chi tiết.
 * externalId = "productId-skuId"; sản phẩm không có SKU dùng channelSku
 * "TTK-productId".
 */
export async function loadEnrichedProductIds(channelId: string): Promise<Set<string>> {
  const rows = await prisma.channelProduct.findMany({
    where: { channelId, imageUrl: { not: null } },
    select: { externalId: true, channelSku: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.externalId) ids.add(r.externalId.split("-")[0]);
    else if (r.channelSku.startsWith("TTK-")) ids.add(r.channelSku.slice(4));
  }
  return ids;
}

/**
 * Chọn sản phẩm cần gọi chi tiết lượt này: chưa có ảnh trong DB lên trước,
 * rồi mới tới sản phẩm đã có (để bắt ảnh/phân loại đổi), cắt theo trần.
 * Hàm thuần để test.
 */
export function pickDetailTargets(
  products: TikTokProduct[],
  enriched: Set<string>,
  limit: number = DETAIL_PER_RUN
): TikTokProduct[] {
  const missing = products.filter((p) => !enriched.has(p.id));
  const done = products.filter((p) => enriched.has(p.id));
  return [...missing, ...done].slice(0, limit);
}

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

/** Ảnh theo shape TikTok {url?|urls[]|thumb_urls[]} → URL đầu tiên có. */
function pickUrl(img?: { url?: string; urls?: string[]; thumb_urls?: string[] } | null): string | null {
  if (!img) return null;
  return img.url || img.urls?.[0] || img.thumb_urls?.[0] || null;
}

function firstImage(p: TikTokProduct, sku: TikTokProductSku): string | null {
  const skuImg = (sku.sales_attributes ?? []).map((a) => pickUrl(a.sku_img)).find(Boolean);
  if (skuImg) return skuImg;
  return pickUrl(p.main_images?.[0]);
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

/** Ghép sales_attributes (ảnh SKU + tên phân loại) từ chi tiết vào SKU của search theo id. */
function mergeSkuAttributes(
  base: TikTokProductSku[] | undefined,
  detail: TikTokProductSku[] | undefined
): TikTokProductSku[] | undefined {
  if (!base || !detail?.length) return base;
  const byId = new Map(detail.map((s) => [String(s.id), s]));
  return base.map((s) => {
    const d = byId.get(String(s.id));
    return d ? { ...s, sales_attributes: s.sales_attributes ?? d.sales_attributes } : s;
  });
}

export const tiktokProductAdapter: MarketplaceProductAdapter = {
  name: "tiktok",

  async fetchProducts(channel: Channel, opts?: FetchProductsOptions): Promise<NormalizedChannelProduct[]> {
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

    // Bổ sung chi tiết (ảnh + phân loại): cache RAM trước, rồi gọi API cho
    // sản phẩm CHƯA có ảnh trong DB (ưu tiên), trần DETAIL_PER_RUN mỗi lượt.
    if (opts?.details !== false) {
      const applyDetail = (p: TikTokProduct, d: TikTokProduct) => {
        p.main_images = p.main_images ?? d.main_images;
        // search không trả SKU (hàng ẩn/khóa) → lấy SKU từ chi tiết để khóa
        // SKU đúng seller_sku thay vì "TTK-productId".
        p.skus = p.skus?.length ? mergeSkuAttributes(p.skus, d.skus) : d.skus;
      };
      const pending: TikTokProduct[] = [];
      for (const p of products) {
        const cached = detailCache.get(p.id);
        if (cached && cached.updateTime === (p.update_time ?? 0)) applyDetail(p, cached.product);
        else pending.push(p);
      }
      const enriched = await loadEnrichedProductIds(channel.id);
      const targets = pickDetailTargets(pending, enriched);
      let ok = 0;
      let failed = 0;
      let firstErr = "";
      let shapeLoggedDetail = false;
      for (const p of targets) {
        try {
          if (ok + failed > 0) await sleep(DETAIL_PACE_MS);
          const d = await getProduct({ accessToken, shopCipher, productId: p.id });
          detailCache.set(p.id, { updateTime: p.update_time ?? 0, product: d });
          applyDetail(p, d);
          ok++;
          if (!shapeLoggedDetail && process.env.TIKTOK_SHAPE_LOG !== "0") {
            shapeLoggedDetail = true;
            const m0 = d.main_images?.[0];
            const a0 = d.skus?.[0]?.sales_attributes?.[0];
            console.log(
              `[TikTok] Hình dạng chi tiết (products/{id}): keys=[${Object.keys(d).join(",")}] main_images[0]=[${Object.keys(m0 ?? {}).join(",")}] sku_img=[${Object.keys(a0?.sku_img ?? {}).join(",")}] anh=${pickUrl(m0) ? "co" : "KHONG"}`
            );
          }
        } catch (err) {
          failed++;
          if (!firstErr) firstErr = (err as Error).message;
        }
      }
      const remaining = pending.length - targets.length;
      console.log(
        `[TikTok] Bổ sung chi tiết gian ${channel.shopName}: ${ok} ok, ${failed} lỗi` +
          `${firstErr ? ` (lỗi đầu: ${firstErr})` : ""}, ${enriched.size} SP đã có ảnh trong DB` +
          `${remaining > 0 ? `, còn ${remaining} SP chờ lượt sau` : ""}`
      );
    }

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
