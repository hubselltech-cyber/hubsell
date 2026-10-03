/**
 * KỲ KẾ TOÁN — tháng / quý / năm / khoảng ngày tùy chọn.
 *
 * Kế toán nghĩ theo KỲ (chốt sổ tháng, tờ khai quý, quyết toán năm) chứ không
 * theo "7 ngày qua" như trang báo cáo bán hàng. Kỳ vẫn chỉ là một DateRange
 * (nguồn chân lý chung ở date-range.ts) — loại kỳ được SUY RA từ hai mốc ngày,
 * nên nơi gọi API không phải biết đang xem tháng hay quý.
 */

import { formatDayVN, previousRange, rangeDayCount, type DateRange } from "./date-range";

export type AccountingPeriodKind = "month" | "quarter" | "year" | "custom";

export type AccountingPeriod =
  | { kind: "month"; year: number; month: number } // month: 1–12
  | { kind: "quarter"; year: number; quarter: number } // quarter: 1–4
  | { kind: "year"; year: number }
  | { kind: "custom" };

/** Trọn tháng `month` (1–12; ngoài khoảng thì tự tràn sang năm kề). */
export function monthPeriod(year: number, month: number): DateRange {
  return { from: new Date(year, month - 1, 1), to: new Date(year, month, 0) };
}

/** Trọn quý `quarter` (1–4; ngoài khoảng thì tự tràn sang năm kề). */
export function quarterPeriod(year: number, quarter: number): DateRange {
  return {
    from: new Date(year, (quarter - 1) * 3, 1),
    to: new Date(year, quarter * 3, 0),
  };
}

export function yearPeriod(year: number): DateRange {
  return { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
}

export function currentMonthPeriod(now: Date = new Date()): DateRange {
  return monthPeriod(now.getFullYear(), now.getMonth() + 1);
}

/** "yyyy-mm-dd" → Date đầu ngày theo lịch địa phương. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Khoảng ngày khớp trọn tháng/quý/năm nào thì trả loại đó, còn lại là custom. */
export function detectPeriod(range: DateRange): AccountingPeriod {
  const { from, to } = range;
  const year = from.getFullYear();
  const startsOnFirst = from.getDate() === 1;
  // Ngày kế sau `to` là mùng 1 ⇔ `to` là ngày cuối tháng.
  const endsOnLast =
    new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getDate() === 1;
  if (!startsOnFirst || !endsOnLast || to.getFullYear() !== year) {
    return { kind: "custom" };
  }
  const span = to.getMonth() - from.getMonth() + 1;
  if (span === 1) return { kind: "month", year, month: from.getMonth() + 1 };
  if (span === 3 && from.getMonth() % 3 === 0) {
    return { kind: "quarter", year, quarter: from.getMonth() / 3 + 1 };
  }
  if (span === 12) return { kind: "year", year };
  return { kind: "custom" };
}

/** Nhãn trên nút chọn kỳ: "Tháng 10/2026", "Quý 4/2026", "Năm 2026", hoặc hai mốc ngày. */
export function formatPeriodLabel(range: DateRange): string {
  const p = detectPeriod(range);
  if (p.kind === "month") return `Tháng ${p.month}/${p.year}`;
  if (p.kind === "quarter") return `Quý ${p.quarter}/${p.year}`;
  if (p.kind === "year") return `Năm ${p.year}`;
  return `${formatDayVN(range.from)} - ${formatDayVN(range.to)}`;
}

/** Cụm ghép SAU danh từ ("Tổng THU …", "Cơ cấu chi …"): "tháng 10/2026",
 *  "quý 4/2026", "năm 2026"; khoảng lẻ thì "kỳ đã chọn" (hai mốc ngày đã
 *  nằm trên nút chọn kỳ, lặp lại trong từng thẻ chỉ làm tràn chữ). */
export function formatPeriodPhrase(range: DateRange): string {
  const p = detectPeriod(range);
  if (p.kind === "custom") return "kỳ đã chọn";
  const label = formatPeriodLabel(range);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Mã kỳ cho tên tệp/sheet: "2026-10", "2026-Q4", "2026", "2026-10-01_2026-10-15". */
export function periodSlug(range: DateRange): string {
  const p = detectPeriod(range);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (p.kind === "month") return `${p.year}-${pad(p.month)}`;
  if (p.kind === "quarter") return `${p.year}-Q${p.quarter}`;
  if (p.kind === "year") return `${p.year}`;
  const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${key(range.from)}_${key(range.to)}`;
}

/** Kỳ liền trước (-1) / liền sau (+1) CÙNG LOẠI: tháng → tháng kề, quý → quý
 *  kề, năm → năm kề; khoảng lẻ thì trượt đúng bằng số ngày của nó. */
export function shiftPeriod(range: DateRange, dir: -1 | 1): DateRange {
  const p = detectPeriod(range);
  if (p.kind === "month") return monthPeriod(p.year, p.month + dir);
  if (p.kind === "quarter") return quarterPeriod(p.year, p.quarter + dir);
  if (p.kind === "year") return yearPeriod(p.year + dir);
  if (dir === -1) return previousRange(range);
  const days = rangeDayCount(range);
  const { to } = range;
  return {
    from: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1),
    to: new Date(to.getFullYear(), to.getMonth(), to.getDate() + days),
  };
}
