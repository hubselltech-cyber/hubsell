/**
 * NGÀY PHÁT SINH của khoản thu/chi vận hành — kiểm trước khi ghi (26/11/2026).
 *
 * Sự cố: ô <input type="date"> của trình duyệt nhận NĂM GÕ TAY đúng từng chữ số —
 * gõ "15/11/26" ra "0026-11-15". `new Date("0026-11-15")` vẫn hợp lệ nên máy chủ
 * lưu khoản chi vào NĂM 26: báo "Đã thêm" nhưng không kỳ báo cáo nào chứa nó,
 * khách tưởng "nhập tay thì không nhận". Chọn bằng lịch luôn ra năm đủ 4 chữ số
 * nên không dính.
 *
 * Luật ở đây là hàng rào CUỐI cho mọi nơi gọi POST /api/expenses (web, app, bản
 * web cũ còn nằm trong bộ đệm trình duyệt): năm ngoài khoảng hợp lý thì TỪ CHỐI
 * kèm câu nói rõ cách sửa, không tự đoán. (Web tự đổi "26" → "2026" ngay trên ô
 * để khách nhìn thấy trước khi lưu — frontend/src/lib/date-input.ts.)
 */

/** Trước mốc này chắc chắn là gõ nhầm — mặc định tự chọn, không có căn cứ nghiệp vụ nào khác. */
export const EXPENSE_DATE_MIN_YEAR = 2000;
/** Cho ghi trước tối đa hết NĂM SAU (tiền thuê trả trước…); xa hơn coi là gõ nhầm — mặc định tự chọn. */
export const EXPENSE_DATE_MAX_YEARS_AHEAD = 1;

export type ExpenseDateResult =
  | { ok: true; date: Date | undefined }
  | { ok: false; error: string };

export function parseExpenseDate(input: unknown, now: Date = new Date()): ExpenseDateResult {
  // Bỏ trống → để DB tự lấy thời điểm lưu (hành vi cũ).
  if (input === undefined || input === null || input === "") return { ok: true, date: undefined };
  if (typeof input !== "string") return { ok: false, error: "Ngày phát sinh không hợp lệ" };

  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "Ngày phát sinh không hợp lệ" };

  const year = d.getUTCFullYear();
  const maxYear = now.getUTCFullYear() + EXPENSE_DATE_MAX_YEARS_AHEAD;
  if (year < EXPENSE_DATE_MIN_YEAR || year > maxYear) {
    return {
      ok: false,
      error: `Ngày phát sinh chưa đúng năm — nhập năm đủ 4 chữ số (ví dụ ${now.getUTCFullYear()})`,
    };
  }
  return { ok: true, date: d };
}
