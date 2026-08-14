/**
 * Nhận diện đơn HỎA TỐC từ tên hãng nguyên văn sàn trả —
 * CHÉP TAY từ backend/src/shipping.ts isExpressShipping, giữ đồng bộ
 * (mobile cũng có bản chép riêng tại hubsell-mobile/src/lib/shipping.ts).
 * KHÔNG dùng từ "express" trần: "SPX Express" là giao THƯỜNG.
 */
export function isExpressShipping(name?: string | null): boolean {
  const s = (name ?? "").toLowerCase();
  if (!s.trim()) return false;
  return (
    s.includes("hỏa tốc") ||
    s.includes("hoả tốc") ||
    s.includes("hoa toc") ||
    s.includes("instant") ||
    s.includes("siêu tốc") ||
    s.includes("sieu toc") ||
    s.includes("ahamove") ||
    s.includes("grab") ||
    s.includes("bedelivery") ||
    s.includes("be delivery") ||
    s.includes("trong ngày") ||
    s.includes("trong ngay") ||
    s.includes("same day")
  );
}
