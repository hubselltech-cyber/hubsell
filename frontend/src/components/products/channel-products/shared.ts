// ============================================================
// SẢN PHẨM TRÊN SÀN — thiết kế lại 05/11/2026 (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md).
// Phần thuần dùng chung: gom dòng ChannelProduct thành SẢN PHẨM sàn, trạng thái nối,
// luật mã chuẩn. Không gọi API, không React.
// ============================================================

import type { ChannelName, ChannelProduct, Product } from "@/lib/api";

/** Mã máy Hubsell tự sinh khi sàn không có SKU người bán — không coi là mã chuẩn. */
export function isFallbackSku(sku: string): boolean {
  return /^(SPE|TTK|LZD)-\d/.test(sku);
}

/** Mã kho hợp lệ: chữ/số/-/_/., 1–50 ký tự (giữ mã sàn ngắn, khớp backend /warehouse-only skuMin 1). */
export const SKU_PATTERN_LOOSE = /^[A-Za-z0-9._-]{1,50}$/;

/** Mã sàn "chuẩn" = có, không phải mã máy, đúng mẫu ký tự. */
export function isStandardSku(sku: string): boolean {
  const s = sku.trim();
  return Boolean(s) && !isFallbackSku(s) && SKU_PATTERN_LOOSE.test(s);
}

/** Tên phân loại để hiện — sàn không trả tên thì lấy mã sàn. */
export function variantLabel(r: Pick<ChannelProduct, "variantName" | "channelSku">): string {
  const v = (r.variantName ?? "").trim();
  return v || r.channelSku;
}

/** Id sản phẩm sàn (phần trước dấu "-" của externalId) — cùng khóa gom với backend. */
export function channelItemId(externalId: string | null | undefined): string | null {
  const head = (externalId ?? "").split("-")[0];
  return head || null;
}

/** Id phân loại sàn (model / SKU id — phần sau dấu "-" đầu tiên của externalId); sản phẩm không phân loại → null. */
export function channelModelId(externalId: string | null | undefined): string | null {
  const s = externalId ?? "";
  const i = s.indexOf("-");
  const tail = i >= 0 ? s.slice(i + 1) : "";
  return tail && tail !== "0" ? tail : null;
}

export type GroupLinkStatus = "unlinked" | "partial" | "linked";

export interface ChannelGroup {
  /** gian:idSảnPhẩmSàn (hoặc gian:idDòng khi sàn không cấp id). */
  key: string;
  channelId: string;
  channelName: ChannelName;
  shopName: string;
  itemId: string | null;
  title: string;
  imageUrl: string | null;
  rows: ChannelProduct[];
  total: number;
  linkedCount: number;
  status: GroupLinkStatus;
  /** Mọi phân loại đều DELISTED (sàn đã gỡ cả sản phẩm). */
  delisted: boolean;
  /** Mọi phân loại đều bị Bỏ qua. */
  ignored: boolean;
  minPrice: number;
  maxPrice: number;
  totalStock: number | null;
}

const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

/** Gom dòng (đã về theo thứ tự nhóm của backend) thành sản phẩm sàn, giữ thứ tự xuất hiện. */
export function groupChannelProducts(items: ChannelProduct[]): ChannelGroup[] {
  const map = new Map<string, ChannelGroup>();
  for (const r of items) {
    const itemId = channelItemId(r.externalId);
    const key = `${r.channel.id}:${itemId ?? r.id}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        channelId: r.channel.id,
        channelName: r.channel.channelName,
        shopName: r.channel.shopName,
        itemId,
        title: r.productName,
        imageUrl: r.imageUrl,
        rows: [],
        total: 0,
        linkedCount: 0,
        status: "unlinked",
        delisted: true,
        ignored: true,
        minPrice: Number.POSITIVE_INFINITY,
        maxPrice: 0,
        totalStock: null,
      };
      map.set(key, g);
    }
    g.rows.push(r);
    if (!g.imageUrl && r.imageUrl) g.imageUrl = r.imageUrl;
    g.total += 1;
    if (r.productId) g.linkedCount += 1;
    if (r.status !== "DELISTED") g.delisted = false;
    if (!r.ignoredAt) g.ignored = false;
    const price = Number(r.price) || 0;
    g.minPrice = Math.min(g.minPrice, price);
    g.maxPrice = Math.max(g.maxPrice, price);
    if (r.channelStock != null) g.totalStock = (g.totalStock ?? 0) + r.channelStock;
  }
  const out = [...map.values()];
  for (const g of out) {
    if (!Number.isFinite(g.minPrice)) g.minPrice = 0;
    g.status = g.linkedCount === 0 ? "unlinked" : g.linkedCount === g.total ? "linked" : "partial";
    g.rows.sort((a, b) => collator.compare(variantLabel(a), variantLabel(b)));
  }
  return out;
}

/** Nhóm sản phẩm KHO (cha–con theo groupKey) cho hộp chọn trong ngăn kéo. */
export interface WarehouseGroup {
  key: string;
  title: string;
  imageUrl: string | null;
  variants: Product[];
  /** Mã gốc đoán: tiền tố chung dài nhất của các mã (bỏ dấu "-" cuối); sản phẩm đơn = chính mã. */
  rootGuess: string;
}

export function groupWarehouseProducts(items: Product[]): WarehouseGroup[] {
  const map = new Map<string, WarehouseGroup>();
  for (const p of items) {
    const key = p.groupKey ?? p.id;
    let g = map.get(key);
    if (!g) {
      g = { key, title: p.productName, imageUrl: p.imageUrl ?? null, variants: [], rootGuess: "" };
      map.set(key, g);
    }
    g.variants.push(p);
    if (!g.imageUrl && p.imageUrl) g.imageUrl = p.imageUrl;
  }
  for (const g of map.values()) {
    g.variants.sort((a, b) => collator.compare(a.variantName ?? a.skuCode, b.variantName ?? b.skuCode));
    g.rootGuess = commonSkuRoot(g.variants.map((v) => v.skuCode));
  }
  return [...map.values()];
}

export function commonSkuRoot(codes: string[]): string {
  if (codes.length === 0) return "";
  if (codes.length === 1) return codes[0];
  let prefix = codes[0];
  for (const c of codes.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < c.length && prefix[i].toUpperCase() === c[i].toUpperCase()) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.replace(/[-_.]+$/, "");
}

/** Chuẩn hóa tên phân loại để so khớp: bỏ dấu, thường, bỏ khoảng trắng / dấu câu. */
function normName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Gợi ý ghép phân loại sàn → SKU kho trong một nhóm kho đã chọn:
 *   1. trùng mã (mã sàn = mã kho, không phân biệt hoa thường);
 *   2. trùng tên phân loại (chuẩn hóa);
 *   3. sản phẩm đơn ↔ nhóm kho một SKU.
 * Mỗi SKU kho chỉ gợi ý cho MỘT dòng sàn.
 */
export function suggestVariantMapping(rows: ChannelProduct[], variants: Product[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const bySku = new Map(variants.map((v) => [v.skuCode.toUpperCase(), v]));
  for (const r of rows) {
    const v = bySku.get(r.channelSku.trim().toUpperCase());
    if (v && !used.has(v.id)) {
      out.set(r.id, v.id);
      used.add(v.id);
    }
  }
  const byName = new Map<string, Product[]>();
  for (const v of variants) {
    const k = normName(v.variantName);
    const list = byName.get(k) ?? [];
    list.push(v);
    byName.set(k, list);
  }
  for (const r of rows) {
    if (out.has(r.id)) continue;
    const k = normName(r.variantName);
    if (!k) continue;
    const v = (byName.get(k) ?? []).find((x) => !used.has(x.id));
    if (v) {
      out.set(r.id, v.id);
      used.add(v.id);
    }
  }
  if (rows.length === 1 && variants.length === 1 && !out.has(rows[0].id) && !used.has(variants[0].id)) {
    out.set(rows[0].id, variants[0].id);
  }
  return out;
}
