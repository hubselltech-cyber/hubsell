/**
 * CHI PHÍ ĐỊNH KỲ — phép tính NGÀY TỚI HẠN thuần (không đụng DB), 26/11/2026.
 * Thiết kế: docs/THU-CHI-VAN-HANH-CHI-PHI-DINH-KY.md mục 5.
 *
 * Ngày ở đây luôn là chuỗi "yyyy-mm-dd" theo LỊCH GIỜ VIỆT NAM (lib/date-range.ts
 * → toBusinessDateKey). Cùng luật với câu SQL ghi gộp ở services/recurring-expense.ts;
 * test `recurring-expense.test.ts` giữ hai bên khớp nhau:
 *
 *   DAILY    mỗi ngày từ startDay.
 *   MONTHLY  startDay + n tháng, tính TỪ NGÀY GỐC (không cộng dồn từ kỳ trước):
 *            31/01 → 28/02 → 31/03. Cộng dồn sẽ ra 28/03 và lệch mãi về sau.
 *   YEARLY   startDay + n năm; 29/02 → 28/02 ở năm thường.
 * (Đúng cách Postgres cộng `date + n * interval '1 month'`: ngày vượt cuối tháng thì kẹp
 * về ngày cuối tháng.)
 */

export type RecurringCadenceKey = "DAILY" | "MONTHLY" | "YEARLY";

export const RECURRING_CADENCES: RecurringCadenceKey[] = ["DAILY", "MONTHLY", "YEARLY"];

/** Luật hằng ngày dài tối đa ngần này ngày (kể cả hai đầu) — mặc định tự chọn 26/11/2026:
 *  đủ một năm nhuận, để một luật gõ nhầm ngày kết thúc không ghi ra hàng nghìn dòng. */
export const DAILY_MAX_DAYS = 366;
/** Số luật ĐANG CHẠY tối đa của một chủ shop — mặc định tự chọn, chặn tạo luật hàng loạt. */
export const MAX_ACTIVE_RULES = 200;
/** Năm sớm nhất / muộn nhất còn nhận cho ngày của luật — bắt gõ nhầm (tự chọn). */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "yyyy-mm-dd" hợp lệ (ngày có thật, năm trong khoảng) → true. */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Cột DATE của Prisma (Date lúc 00:00 UTC) → "yyyy-mm-dd". */
export function dateToDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "yyyy-mm-dd" → Date 00:00 UTC để ghi vào cột DATE qua Prisma. */
export function dayKeyToDate(day: string): Date {
  return new Date(toUtc(day));
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** Số ngày từ a tới b (b − a); cùng ngày = 0. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** startDay + n tháng, ngày vượt cuối tháng thì kẹp về ngày cuối tháng. */
export function addMonthsClamped(start: string, n: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const total = (m - 1) + n;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(ty, tm, Math.min(d, lastDay)));
}

/** Ngày tới hạn thứ n (n = 0 là chính startDay). */
export function occurrenceAt(cadence: RecurringCadenceKey, start: string, n: number): string {
  if (cadence === "DAILY") return addDays(start, n);
  return addMonthsClamped(start, cadence === "MONTHLY" ? n : n * 12);
}

/** Chỉ số n nhỏ nhất có occurrenceAt(n) > after (after có thể trước startDay → 0). */
function firstIndexAfter(cadence: RecurringCadenceKey, start: string, after: string): number {
  if (after < start) return 0;
  if (cadence === "DAILY") return daysBetween(start, after) + 1;
  const [sy, sm] = start.split("-").map(Number);
  const [ay, am] = after.split("-").map(Number);
  // Ước lượng thấp hơn một kỳ rồi dò lên — ngày kẹp cuối tháng làm phép chia không chính xác.
  const months = (ay - sy) * 12 + (am - sm);
  let n = Math.max(0, cadence === "MONTHLY" ? months - 1 : Math.floor(months / 12) - 1);
  while (occurrenceAt(cadence, start, n) <= after) n++;
  return n;
}

/**
 * Các ngày tới hạn trong khoảng (after, through] — after KHÔNG tính, through CÓ tính;
 * có `end` thì không vượt quá end.
 */
export function occurrencesBetween(input: {
  cadence: RecurringCadenceKey;
  start: string;
  after: string;
  through: string;
  end?: string | null;
}): string[] {
  const { cadence, start, after } = input;
  const through = input.end && input.end < input.through ? input.end : input.through;
  const out: string[] = [];
  for (let n = firstIndexAfter(cadence, start, after); ; n++) {
    const day = occurrenceAt(cadence, start, n);
    if (day > through) break;
    out.push(day);
  }
  return out;
}

/** Ngày tới hạn KẾ TIẾP sau `after` (null khi đã qua ngày kết thúc). */
export function nextOccurrence(input: {
  cadence: RecurringCadenceKey;
  start: string;
  after: string;
  end?: string | null;
}): string | null {
  const day = occurrenceAt(input.cadence, input.start, firstIndexAfter(input.cadence, input.start, input.after));
  return input.end && day > input.end ? null : day;
}

export type RecurringScheduleCheck = { ok: true } | { ok: false; error: string };

/** Kiểm lịch của một luật trước khi tạo. */
export function checkRecurringSchedule(input: {
  cadence: unknown;
  startDay: unknown;
  endDay: unknown;
}): RecurringScheduleCheck {
  const { cadence, startDay, endDay } = input;
  if (typeof cadence !== "string" || !RECURRING_CADENCES.includes(cadence as RecurringCadenceKey)) {
    return { ok: false, error: "Chu kỳ lặp lại không hợp lệ (hằng ngày, hằng tháng hoặc hằng năm)" };
  }
  if (!isDayKey(startDay)) {
    return { ok: false, error: "Ngày bắt đầu chưa đúng — nhập đủ ngày/tháng/năm, năm 4 chữ số" };
  }
  const hasEnd = endDay !== undefined && endDay !== null && endDay !== "";
  if (hasEnd && !isDayKey(endDay)) {
    return { ok: false, error: "Ngày kết thúc chưa đúng — nhập đủ ngày/tháng/năm, năm 4 chữ số" };
  }
  if (hasEnd && (endDay as string) < startDay) {
    return { ok: false, error: "Ngày kết thúc phải từ ngày bắt đầu trở đi" };
  }
  if (cadence === "DAILY") {
    if (!hasEnd) return { ok: false, error: "Chi phí hằng ngày cần ngày kết thúc" };
    if (daysBetween(startDay, endDay as string) + 1 > DAILY_MAX_DAYS) {
      return {
        ok: false,
        error: `Chi phí hằng ngày dài tối đa ${DAILY_MAX_DAYS} ngày — hết kỳ thì tạo khoản định kỳ mới`,
      };
    }
  }
  return { ok: true };
}
