// ============================================================
// THỜI GIAN CHỜ GIỮA HAI LẦN THỬ TẢI LÊN (rủi ro N2 + N3, docs/VIDEO-DONG-HANG-THIET-KE.md mục 18.4).
//
// Hàm thuần. Luật:
//   · thử lại KHÔNG giới hạn số lần — video phải lên hệ thống, không có "bỏ cuộc";
//   · trần chờ tăng gấp đôi sau mỗi lần hỏng liên tiếp: 4 → 8 → 16 … giây, tới trần 5 phút;
//   · LỆCH NGẪU NHIÊN TOÀN PHẦN: chờ một khoảng bất kỳ trong [sàn, trần] — sau một sự cố chung, hàng chục
//     nghìn trình duyệt không thử lại cùng một nhịp (dồn sóng vào máy chủ vừa sống lại);
//   · sàn 2 giây: kho R2 chỉ cho ghi cùng MỘT tên tệp 1 lần / giây (rủi ro N8);
//   · máy chủ bảo chờ (Retry-After) thì chờ ít nhất chừng đó.
//
// Các con số dưới là số TỰ CHỌN (chưa có số đo): trần 5 phút = lúc tệ nhất một shop thấy video lên chậm thêm
// tối đa 5 phút sau khi mạng / máy chủ sống lại; nền 4 giây để lần thử lại đầu rơi trong 2–4 giây.
// ============================================================

/** Sàn: không bao giờ thử lại sớm hơn mức này. */
export const RETRY_FLOOR_MS = 2_000;
/** Trần chờ của lần hỏng đầu tiên; mỗi lần hỏng liên tiếp nhân đôi. */
export const RETRY_BASE_MS = 4_000;
/** Trần chờ lớn nhất. */
export const RETRY_CAP_MS = 5 * 60_000;

/** Trần chờ (chưa lệch ngẫu nhiên) sau `failures` lần hỏng liên tiếp (1 = lần hỏng đầu). */
export function retryCeilingMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  // 2^n vượt số nguyên an toàn từ n rất lớn → chặn mũ trước khi tính.
  const doubled = RETRY_BASE_MS * 2 ** Math.min(n - 1, 20);
  return Math.min(RETRY_CAP_MS, doubled);
}

/**
 * Số mili giây chờ trước lần thử kế.
 * @param failures số lần hỏng LIÊN TIẾP của cả hàng chờ (về 0 khi có một clip lên kho)
 * @param random   số ngẫu nhiên trong [0, 1) — truyền vào để test được
 * @param retryAfterMs máy chủ / kho yêu cầu chờ ít nhất chừng này (tiêu đề Retry-After), nếu có
 */
export function retryDelayMs(failures: number, random: number, retryAfterMs: number | null = null): number {
  const ceiling = retryCeilingMs(failures);
  const r = Math.min(Math.max(random, 0), 0.999_999);
  const jittered = RETRY_FLOOR_MS + Math.floor(r * (ceiling - RETRY_FLOOR_MS + 1));
  const asked = retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0;
  // Máy chủ bảo chờ lâu hơn trần của mình thì nghe máy chủ, nhưng không quá 2 lần trần lớn nhất (phòng số rác).
  return Math.max(jittered, Math.min(asked, RETRY_CAP_MS * 2));
}
