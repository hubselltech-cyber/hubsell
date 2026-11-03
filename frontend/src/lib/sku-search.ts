import { normalizeText } from "./text";

/**
 * Độ khớp của một SKU với từ khóa đã normalizeText: 0 trùng đúng mã, 1 bắt đầu bằng từ khóa, 2 mã có chứa,
 * 3 chỉ khớp ở tên hoặc phân loại. Cùng luật với searchRank ở backend/src/lib/sku-catalog-page.ts, dùng cho gian
 * dưới trần đang lọc trên trình duyệt.
 */
export function skuSearchRank(
  item: { sku: string; stockSku?: string | null; itemId: string | null; modelId: string | null },
  keyword: string
): number {
  const codes = [item.sku, item.stockSku ?? ""].map(normalizeText);
  const ids = [item.itemId ?? "", item.modelId ?? ""];
  if (codes.includes(keyword) || ids.includes(keyword)) return 0;
  if (codes.some((c) => c.startsWith(keyword))) return 1;
  if (codes.some((c) => c.includes(keyword)) || ids.some((c) => c.includes(keyword))) return 2;
  return 3;
}
