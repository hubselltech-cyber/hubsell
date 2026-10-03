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
