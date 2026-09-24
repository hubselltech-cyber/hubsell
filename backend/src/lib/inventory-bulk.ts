/**
 * PHIẾU NHẬP / XUẤT NHIỀU MÃ (24/09/2026) — phần thuần, không đụng DB, để test.
 *
 * Trang Hàng hóa trước đây chỉ nhập/xuất từng SKU một hộp thoại; nhập 30 mã từ
 * xưởng là 30 lần bấm. Phiếu nhiều mã gom một lượt: gõ/quét mã → số lượng →
 * một lý do chung → MỘT transaction. Khác Excel: đây là CỘNG THÊM / TRỪ BỚT,
 * không đè tổng.
 */

export const BULK_MAX_ITEMS = 200;

export interface BulkItemInput {
  productId?: unknown;
  quantity?: unknown;
}

export interface BulkItem {
  productId: string;
  quantity: number;
}

export type BulkParseResult =
  | { ok: true; items: BulkItem[] }
  | { ok: false; error: string };

/**
 * Chuẩn hoá danh sách dòng phiếu: bỏ dòng rỗng, gộp mã trùng (quét cùng một mã
 * hai lần = cộng dồn), chặn số không nguyên dương, chặn quá trần.
 */
export function normalizeBulkItems(raw: unknown): BulkParseResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Phiếu chưa có dòng nào" };
  }
  const merged = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] as BulkItemInput;
    const productId = typeof it?.productId === "string" ? it.productId.trim() : "";
    if (!productId) {
      return { ok: false, error: `Dòng ${i + 1}: thiếu mã sản phẩm` };
    }
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { ok: false, error: `Dòng ${i + 1}: số lượng phải là số nguyên dương` };
    }
    merged.set(productId, (merged.get(productId) ?? 0) + qty);
  }
  if (merged.size > BULK_MAX_ITEMS) {
    return {
      ok: false,
      error: `Một phiếu tối đa ${BULK_MAX_ITEMS} mã — tách thành nhiều phiếu`,
    };
  }
  return {
    ok: true,
    items: [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity })),
  };
}

/**
 * Với phiếu XUẤT: mã nào không đủ hàng thì báo đích danh (mã + tồn + muốn xuất),
 * không báo chung chung "không đủ hàng".
 */
export function findInsufficient(
  items: BulkItem[],
  stockById: Map<string, { skuCode: string; quantityInStock: number }>
): { skuCode: string; quantityInStock: number; wanted: number }[] {
  const out: { skuCode: string; quantityInStock: number; wanted: number }[] = [];
  for (const it of items) {
    const p = stockById.get(it.productId);
    if (!p) continue;
    if (p.quantityInStock < it.quantity) {
      out.push({ skuCode: p.skuCode, quantityInStock: p.quantityInStock, wanted: it.quantity });
    }
  }
  return out;
}
