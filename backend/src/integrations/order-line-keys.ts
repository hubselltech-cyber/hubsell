// ============================================================
// KHỚP DÒNG ĐƠN / DÒNG HOÀN VỚI DÒNG SKU SÀN (ChannelProduct) — dùng chung 3 sàn
//
// Từ 15/10/2026 (sự cố Hi.Bé, marketplace/sku-key.ts) một mã người bán có thể
// ứng với NHIỀU dòng ChannelProduct ("LT075-HONG (Hồng, 3-5kg)", "… 5-7kg"…).
// Dòng đơn của sàn luôn mang id phân loại lá (Shopee item_id+model_id, TikTok
// product_id+sku_id) → tra theo `externalId` TRƯỚC, mã người bán chỉ là đường
// lui cho dòng cũ chưa có externalId hoặc sản phẩm chưa kéo về.
//
// Dòng đơn ghi `channelSku` = khóa của dòng ChannelProduct khớp được (có đuôi
// phân loại nếu có), để Lãi/Lỗ theo SKU, ảnh dòng đơn, điền bù giá vốn
// (lib/cost-price SKU_MATCH so bằng) đều trỏ đúng phân loại. Không khớp được
// thì giữ mã thô của sàn như trước.
// ============================================================

import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | { channelProduct: Prisma.TransactionClient["channelProduct"] };

export interface OrderLineKey {
  /** Mã thô của sàn (seller sku / model_sku, trống thì khóa tổng hợp). */
  channelSku: string;
  /** Id phân loại lá phía sàn, cùng định dạng adapter sản phẩm ("item-model"); null nếu sàn không cho. */
  externalId: string | null;
}

export interface ResolvedLineRow {
  channelSku: string;
  productId: string | null;
  costPrice: Prisma.Decimal | null;
  product: { costPrice: Prisma.Decimal } | null;
}

/** externalId dòng đơn Shopee: item_id + model_id (>0 mới là phân loại; 0 = sản phẩm đơn). */
export function shopeeLineExternalId(itemId?: number, modelId?: number): string | null {
  if (!itemId) return null;
  return modelId ? `${itemId}-${modelId}` : String(itemId);
}

/** externalId dòng đơn TikTok: product_id + sku_id (cùng khuôn tiktok-adapter). */
export function tiktokLineExternalId(productId?: string, skuId?: string): string | null {
  return productId && skuId ? `${productId}-${skuId}` : null;
}

/**
 * Tra dòng ChannelProduct cho từng dòng đơn, MỘT truy vấn cho cả đơn. Trả về
 * map "khóa dòng đơn" (externalId ?? channelSku thô) → dòng khớp (hoặc undefined).
 */
export async function resolveOrderLineRows(
  db: Db,
  channelId: string,
  lines: OrderLineKey[]
): Promise<Map<string, ResolvedLineRow | undefined>> {
  const out = new Map<string, ResolvedLineRow | undefined>();
  if (lines.length === 0) return out;
  const exts = [...new Set(lines.map((l) => l.externalId).filter((x): x is string => Boolean(x)))];
  const skus = [...new Set(lines.map((l) => l.channelSku).filter(Boolean))];
  const rows = await db.channelProduct.findMany({
    where: {
      channelId,
      OR: [
        ...(exts.length ? [{ externalId: { in: exts } }] : []),
        ...(skus.length ? [{ channelSku: { in: skus } }] : []),
      ],
    },
    select: {
      channelSku: true,
      externalId: true,
      status: true,
      productId: true,
      costPrice: true,
      product: { select: { costPrice: true } },
    },
  });
  const byExt = new Map<string, (typeof rows)[number]>();
  const bySku = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    bySku.set(r.channelSku, r);
    if (!r.externalId) continue;
    // DB lỡ có 2 dòng cùng id sàn (đổi mã) → ưu tiên dòng đang bán.
    const cur = byExt.get(r.externalId);
    if (!cur || (cur.status !== "ACTIVE" && r.status === "ACTIVE")) byExt.set(r.externalId, r);
  }
  for (const l of lines) {
    const row = (l.externalId ? byExt.get(l.externalId) : undefined) ?? bySku.get(l.channelSku);
    out.set(lineKey(l), row);
  }
  return out;
}

/** Khóa gom dòng trong một đơn: theo phân loại lá, không gom hai size cùng mã. */
export function lineKey(l: OrderLineKey): string {
  return l.externalId ?? l.channelSku;
}

/**
 * Mở rộng bảng số lượng hoàn theo id sàn → theo KHÓA dòng ChannelProduct, để so
 * với OrderItem.channelSku (đơn mới ghi khóa có đuôi phân loại). `byExternalId`
 * có thể là id đầy đủ "item-model" hoặc chỉ id lá (TikTok return_line_items
 * không có product_id) — tra bằng đuôi "-skuId" khi không khớp đầy đủ.
 */
export async function expandReturnKeys(
  db: Db,
  channelId: string,
  byExternalId: Map<string, number>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (byExternalId.size === 0) return out;
  const ids = [...byExternalId.keys()];
  const full = ids.filter((k) => k.includes("-"));
  const leaf = ids.filter((k) => !k.includes("-"));
  const rows = await db.channelProduct.findMany({
    where: {
      channelId,
      OR: [
        ...(full.length ? [{ externalId: { in: full } }] : []),
        ...leaf.map((id) => ({ externalId: { endsWith: `-${id}` } })),
      ],
    },
    select: { channelSku: true, externalId: true },
  });
  for (const r of rows) {
    if (!r.externalId) continue;
    const qty = byExternalId.get(r.externalId) ?? byExternalId.get(r.externalId.slice(r.externalId.lastIndexOf("-") + 1));
    if (qty !== undefined) out.set(r.channelSku, (out.get(r.channelSku) ?? 0) + qty);
  }
  return out;
}
