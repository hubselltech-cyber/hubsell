// ============================================================
// ĐỊNH DẠNG SỐ trong câu chữ của nhóm quảng cáo — căn cứ ghi Sổ hành động, thẻ
// Trung tâm điều hành, nhật ký vận hành, gợi ý chạy ads. Một nguồn duy nhất
// (01/10/2026): trước đó mỗi tệp tự chép một bản. Thuần.
// ============================================================

/** 336000 → "336.000₫" (làm tròn đồng). */
export function vndText(n: number): string {
  return `${Math.round(n).toLocaleString("vi-VN")}₫`;
}

/** 6.634 → "6,63x" (tối đa 2 số lẻ). */
export function roasText(n: number): string {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
}
