// ============================================================
// CHỮ GỢI Ý VỪA MỘT DÒNG trong ô nhập (26/11/2026 — soi máy ảo Android cỡ chữ lớn).
//
// Ô nhập Android KHÔNG cắt "…" chữ gợi ý dài: nó XUỐNG DÒNG, và dòng thứ hai lòi mép chữ ở đáy ô (ô tìm tab Đơn hàng
// ở màn 360dp, cỡ chữ máy lớn: "Mã đơn, tên khách, SĐT, mã" + nửa trên của "vận đơn…"). iPhone thì cắt cụt giữa chữ.
// Cách chữa: mỗi ô có vài câu gợi ý từ dài tới ngắn, chọn câu DÀI NHẤT còn vừa bề ngang thật của ô.
// Tệp THUẦN để chạy test bằng node:test.
// ============================================================

/** Trần hệ số phóng chữ của app (shims/react-native-font-scale.js). */
const MAX_FONT_SCALE = 1.2;

/**
 * Bề ngang trung bình một ký tự, tính theo cỡ chữ. SỐ ĐO trên máy ảo Android (Roboto / Inter, câu tiếng Việt có dấu):
 * 26 ký tự ≈ 183 dp ở cỡ 16,8 → ≈ 0,42; lấy dư ra 0,47 để chữ đậm / máy khác phông không tràn.
 */
const CHAR_EM = 0.47;

/**
 * @param options  các câu gợi ý, DÀI TRƯỚC NGẮN SAU; câu cuối là câu ngắn nhất, luôn được dùng khi không câu nào vừa
 * @param widthDp  bề ngang chỗ viết chữ của ô nhập (đã trừ đệm, icon)
 * @param fontScale hệ số cỡ chữ của máy (`useWindowDimensions().fontScale`)
 * @param fontSize cỡ chữ của ô nhập (text-sm = 14)
 */
export function fitHint(options: readonly string[], widthDp: number, fontScale: number, fontSize = 14): string {
  const scale = Math.min(Math.max(Number.isFinite(fontScale) ? fontScale : 1, 1), MAX_FONT_SCALE);
  const perChar = fontSize * CHAR_EM * scale;
  return options.find((o) => o.length * perChar <= widthDp) ?? options[options.length - 1] ?? "";
}
