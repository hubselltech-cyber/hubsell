// ============================================================
// ĐỊNH DẠNG SỐ trong câu chữ của nhóm quảng cáo — căn cứ ghi Sổ hành động, thẻ
// Trung tâm điều hành, nhật ký vận hành, gợi ý chạy ads. Một nguồn duy nhất
// (01/10/2026): trước đó mỗi tệp tự chép một bản. Thuần.
// ============================================================

/** 336000 → "336.000₫" (làm tròn đồng). */
export function vndText(n: number): string {
  return `${Math.round(n).toLocaleString("vi-VN")}₫`;
}

/**
 * 2.140.000 → "2,1 tr", 850.000 → "850 k", 1,2 tỷ, 500 → "500 đ" — cho TIÊU ĐỀ
 * chuông / tin đẩy (≤ 70 ký tự), nơi "2.140.000₫" quá dài. Thân tin vẫn dùng vndText.
 */
export function vndCompact(v: number): string {
  const a = Math.abs(v);
  const f = (x: number, d: number) => x.toFixed(d).replace(/\.0+$/, "").replace(".", ",");
  if (a >= 1e9) return `${f(v / 1e9, 1)} tỷ`;
  if (a >= 1e6) return `${f(v / 1e6, 1)} tr`;
  if (a >= 1e3) return `${Math.round(v / 1e3)} k`;
  return `${Math.round(v)} đ`;
}

/** 6.634 → "6,63x" (tối đa 2 số lẻ). */
export function roasText(n: number): string {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
}
