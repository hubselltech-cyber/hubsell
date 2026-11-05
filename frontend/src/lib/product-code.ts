/**
 * MÃ ĐỂ QUÉT của sản phẩm kho (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.2).
 *
 * Kho quét bằng MÃ VẠCH QUẢN LÝ (13 số, hệ thống tự sinh hoặc mã khách nhập); mã SKU vẫn được
 * nhận để tem cũ / thói quen gõ mã SKU không gãy. Mọi ô quét so khớp qua MỘT hàm này — đừng viết
 * lại `skuCode.toUpperCase() === …` rải rác.
 */
export function productMatchesCode(
  p: { skuCode: string; barcode?: string | null },
  code: string
): boolean {
  const q = code.trim().toUpperCase();
  if (!q) return false;
  return p.skuCode.toUpperCase() === q || (p.barcode ?? "").toUpperCase() === q;
}
