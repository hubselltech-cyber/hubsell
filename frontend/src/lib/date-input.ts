/**
 * Ô NGÀY GÕ TAY (<input type="date">) — sửa năm gõ thiếu chữ số (26/11/2026).
 *
 * Trình duyệt nhận năm đúng từng chữ số người dùng gõ: "15/11/26" thành giá trị
 * "0026-11-15" (năm 26), không tự hiểu là 2026. Chọn bằng lịch thì luôn đủ 4 chữ
 * số nên không dính. Khoản chi lưu vào năm 26 không nằm trong kỳ báo cáo nào →
 * khách thấy "nhập tay thì không nhận".
 *
 * Hai hàm dưới dùng chung cho mọi ô ngày:
 *  - fixTypedYear: năm 00–99 → 20yy (ý người gõ rõ ràng). <Input type="date"> tự
 *    gọi lúc rời ô để người dùng NHÌN THẤY năm đã đổi trước khi bấm lưu; form nào
 *    có thể bấm Enter khi con trỏ còn trong ô thì gọi thêm lần nữa lúc gửi.
 *  - isPlausibleDay: chặn phần còn lại không đoán được (gõ dở "0202", gõ thừa
 *    "20261") — cùng khoảng năm với máy chủ (backend/src/lib/expense-date.ts).
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "0026-11-15" → "2026-11-15". Chuỗi khác (rỗng, năm đủ 4 chữ số, gõ dở) trả nguyên. */
export function fixTypedYear(value: string): string {
  const m = /^00(\d{2})(-\d{2}-\d{2})$/.exec(value);
  return m ? `20${m[1]}${m[2]}` : value;
}

/** Năm sớm nhất còn coi là thật — mặc định tự chọn, khớp máy chủ. */
const MIN_YEAR = 2000;
/** Cho ghi trước tối đa hết năm sau — mặc định tự chọn, khớp máy chủ. */
const MAX_YEARS_AHEAD = 1;

/** Giá trị ô ngày có phải một ngày "yyyy-mm-dd" với năm hợp lý không. */
export function isPlausibleDay(value: string, now: Date = new Date()): boolean {
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  return year >= MIN_YEAR && year <= now.getFullYear() + MAX_YEARS_AHEAD;
}

/** "yyyy-mm-dd" → "dd/mm/yyyy" để hiện cho người Việt (chuỗi khác trả nguyên). */
export function formatDayKeyVN(day: string): string {
  const m = DAY_RE.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

/** Số ngày từ a tới b KỂ CẢ hai đầu (cùng ngày = 1); a, b là "yyyy-mm-dd" hợp lệ. */
export function dayCountInclusive(a: string, b: string): number {
  const ms = (d: string) => {
    const [y, mo, dd] = d.split("-").map(Number);
    return Date.UTC(y, mo - 1, dd);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000) + 1;
}

/**
 * Ghi giá trị mới vào ô và báo cho React như thể người dùng vừa gõ — gán thẳng
 * `el.value` thì ô điều khiển (useState / react-hook-form) không nhận được onChange.
 */
export function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
