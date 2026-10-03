/**
 * KỲ XEM SỔ QUỸ NỘI BỘ (HQ) — tháng / quý / năm / khoảng ngày tùy chọn.
 *
 * Frontend luôn gửi `?from=yyyy-mm-dd&to=yyyy-mm-dd` (bộ chọn kỳ kế toán tự
 * đổi tháng/quý/năm thành hai mốc ngày). `?month=YYYY-MM` là tham số đời đầu,
 * giữ lại để bản frontend cũ còn mở trong trình duyệt không vỡ lúc deploy.
 *
 * Mốc ngày cắt theo GIỜ VIỆT NAM (parseDateRange) — không dùng giờ máy chủ:
 * Render chạy UTC nên cắt theo giờ máy thì khoản thu tự sinh lúc 0h–7h sáng
 * ngày 1 bị dạt về tháng/quý trước.
 */

import {
  parseDateRange,
  toBusinessDateKey,
  type DateRangeFilter,
} from "./date-range";

export interface LedgerPeriod {
  /** Ngày đầu / ngày cuối kỳ "yyyy-mm-dd" (giờ VN, tính cả hai đầu). */
  from: string;
  to: string;
  /** "YYYY-MM" khi kỳ là TRỌN một tháng lịch — checklist chi cố định chỉ có
   *  nghĩa theo tháng; kỳ khác (quý/năm/tùy chọn) trả null. */
  month: string | null;
  range: DateRangeFilter;
}

/** Ngày cuối của tháng "YYYY-MM" (28–31). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function wholeMonth(from: string, to: string): string | null {
  if (from.slice(0, 7) !== to.slice(0, 7)) return null;
  if (from.slice(8) !== "01") return null;
  const [y, m] = from.split("-").map(Number);
  return Number(to.slice(8)) === lastDayOfMonth(y, m) ? from.slice(0, 7) : null;
}

export function parseLedgerPeriod(
  query: { from?: unknown; to?: unknown; month?: unknown },
  now: Date = new Date()
): LedgerPeriod {
  const explicit = parseDateRange(query);
  if (explicit) {
    const from = toBusinessDateKey(explicit.gte);
    const to = toBusinessDateKey(explicit.lte);
    return { from, to, month: wholeMonth(from, to), range: explicit };
  }

  const month =
    typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
      ? query.month
      : toBusinessDateKey(now).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  // from/to tự dựng nên chắc chắn hợp lệ.
  return { from, to, month, range: parseDateRange({ from, to })! };
}
