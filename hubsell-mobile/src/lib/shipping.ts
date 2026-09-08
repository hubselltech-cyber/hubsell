/**
 * Nhận diện đơn HỎA TỐC từ tên hãng nguyên văn sàn trả —
 * CHÉP TAY từ backend/src/shipping.ts isExpressShipping, giữ đồng bộ.
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
    s.includes("xanh sm") ||
    s.includes("green sm")
  );
}

/**
 * Đơn GIAO TRONG NGÀY (Shopee "Trong Ngày", TikTok "Giao Trong Ngày/Sameday")
 * — KHÔNG phải hỏa tốc (anh Trung chốt 08/09): chỉ chú thích dưới tên hãng.
 * Chép tay từ backend SAME_DAY_KEYWORDS.
 */
export function isSameDayShipping(name?: string | null): boolean {
  const s = (name ?? "").toLowerCase();
  if (!s.trim() || isExpressShipping(s)) return false;
  return (
    s.includes("trong ngày") ||
    s.includes("trong ngay") ||
    s.includes("same day") ||
    s.includes("sameday") ||
    s.includes("same-day")
  );
}
