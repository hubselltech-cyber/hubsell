// ============================================================
// Mã đọc được trên tem có "trông giống mã vận đơn" không — hàm THUẦN.
//
// Vì sao phải lọc: một tem có nhiều mã (tem TikTok × J&T có cả QR mang mã vận đơn lẫn QR đường link —
// bài học lát 0 trên Note8, 14/11/2026). Chỉ mã trông như mã vận đơn mới được mở / cắt clip.
// Luật: 8–30 ký tự A–Z / 0–9 (sau khi cắt khoảng trắng), có ít nhất 6 chữ số, không phải đường link.
// ============================================================

/** Trả mã đã cắt khoảng trắng, hoặc null nếu phải bỏ qua. */
export function looksLikeTracking(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (value.length < 8 || value.length > 30) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /^www\./i.test(value) || value.includes("/")) return null;
  if (!/^[A-Z0-9]+$/.test(value)) return null;
  if ((value.match(/[0-9]/g) ?? []).length < 6) return null;
  return value;
}

/**
 * Mã của clip QUAY TAY (không có tem): QUAYTAY (đóng hàng) hoặc KHUITAY (khui hàng hoàn) + giờ phút giây lúc bấm.
 * Vẫn hợp luật mã phía máy chủ; không khớp đơn nào nên nằm ở "Chưa khớp đơn".
 */
export function manualClipCode(kind: "PACK" | "UNBOX" = "PACK", now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kind === "UNBOX" ? "KHUITAY" : "QUAYTAY"}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export function isManualClipCode(code: string): boolean {
  return /^(QUAYTAY|KHUITAY)\d{6}$/.test(code);
}
