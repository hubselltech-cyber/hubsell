/**
 * Khoảng thời gian cho bộ lọc báo cáo — backend nhận ?from=yyyy-mm-dd&to=...
 * và tự cắt ngày theo GIỜ VIỆT NAM (backend/src/date-range.ts). Ở đây chỉ cần
 * sinh chuỗi ngày theo đồng hồ máy (điện thoại của shop đều đặt giờ VN).
 */
export type RangeKey = "today" | "7d" | "30d" | "month";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày" },
  { key: "30d", label: "30 ngày" },
  { key: "month", label: "Tháng này" },
];

function toKey(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Khoảng "hôm qua" — để tính % tăng/giảm so với kỳ trước trên Tổng quan. */
export function yesterdayRange(): { from: string; to: string } {
  const d = new Date(Date.now() - 86_400_000);
  const key = toKey(d);
  return { from: key, to: key };
}

export function rangeFor(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  const to = toKey(now);
  if (key === "today") return { from: to, to };
  if (key === "month") {
    return { from: toKey(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  }
  const days = key === "7d" ? 6 : 29;
  const start = new Date(now.getTime() - days * 86_400_000);
  return { from: toKey(start), to };
}

/**
 * KỲ TRƯỚC liền kề, cùng độ dài — mốc so sánh ▲/▼ cho 4 thẻ Báo cáo dòng tiền
 * (web: deltaOf(cur, prev) trên cùng bộ lọc với kỳ trước).
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  return { from: toKey(prevStart), to: toKey(prevEnd) };
}

// ───────────── Bộ lọc ngày CHUẨN (cùng mốc với DateRangePicker của web) ─────────────

/** Khoảng ngày dạng chuỗi yyyy-mm-dd, tính cả hai đầu. */
export interface DateRange {
  from: string;
  to: string;
}

export interface RangePreset {
  key: string;
  label: string;
  /** Tính tại lúc bấm — để qua nửa đêm vẫn đúng. */
  resolve: () => DateRange;
}

export function dateToKey(d: Date): string {
  return toKey(d);
}

export function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/**
 * Sáu mốc đầu CHÉP từ frontend/src/lib/date-range.ts (buildPresets) để app và
 * web cùng nhãn, cùng nghĩa. "Năm nay" / "Năm trước" thêm riêng cho app — anh
 * Trung 04/10 cần xem lại các năm cũ mà không phải bấm lịch.
 */
export const RANGE_PRESETS: RangePreset[] = [
  { key: "today", label: "Hôm nay", resolve: () => ({ from: toKey(new Date()), to: toKey(new Date()) }) },
  { key: "yesterday", label: "Hôm qua", resolve: () => ({ from: toKey(daysAgo(1)), to: toKey(daysAgo(1)) }) },
  { key: "last7", label: "7 ngày qua", resolve: () => ({ from: toKey(daysAgo(6)), to: toKey(new Date()) }) },
  { key: "last30", label: "30 ngày qua", resolve: () => ({ from: toKey(daysAgo(29)), to: toKey(new Date()) }) },
  {
    key: "thisMonth",
    label: "Tháng này",
    resolve: () => {
      const t = new Date();
      return { from: toKey(new Date(t.getFullYear(), t.getMonth(), 1)), to: toKey(t) };
    },
  },
  {
    key: "lastMonth",
    label: "Tháng trước",
    resolve: () => {
      const t = new Date();
      return {
        from: toKey(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
        to: toKey(new Date(t.getFullYear(), t.getMonth(), 0)), // ngày 0 = cuối tháng trước
      };
    },
  },
  {
    key: "thisYear",
    label: "Năm nay",
    resolve: () => {
      const t = new Date();
      return { from: toKey(new Date(t.getFullYear(), 0, 1)), to: toKey(t) };
    },
  },
  {
    key: "lastYear",
    label: "Năm trước",
    resolve: () => {
      const y = new Date().getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

/** Kỳ mặc định khi mở trang: HÔM NAY (anh Trung 04/10 — web mặc định 30 ngày, app thì xem trong ngày). */
export function defaultRange(): DateRange {
  return RANGE_PRESETS.find((p) => p.key === "today")!.resolve();
}

/** Khoảng trùng khít một mốc thì trả mốc đó (để hiện nhãn đẹp). */
export function matchPreset(range: DateRange): RangePreset | undefined {
  return RANGE_PRESETS.find((p) => {
    const r = p.resolve();
    return r.from === range.from && r.to === range.to;
  });
}

/** yyyy-mm-dd → dd/mm/yyyy. */
export function formatDayVN(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
}

/** Nhãn trên nút lọc: ưu tiên tên mốc, không khớp thì dd/mm/yyyy - dd/mm/yyyy. */
export function formatRangeLabel(range: DateRange): string {
  const preset = matchPreset(range);
  if (preset) return preset.label;
  if (range.from === range.to) return formatDayVN(range.from);
  return `${formatDayVN(range.from)} - ${formatDayVN(range.to)}`;
}
