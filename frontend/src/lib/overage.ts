// Chữ + mốc dùng chung của PHÍ VƯỢT TRẦN ĐƠN (11/11/2026) — một nguồn cho dải nhắc, popup,
// màn khóa, khối trả tiền ở trang Gói dịch vụ và bảng phiếu ở HQ.

/** Neo tới khối phí vượt ở trang Gói dịch vụ — MỘT chỗ trả tiền cho mọi lời nhắc. */
export const OVERAGE_PAY_HREF = "/settings/plan#phi-vuot";

/** "11/2026" từ "2026-11". */
export function overageMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${m}/${y}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Ngày cuối còn trả được của một phiếu. Backend trả `dueAt` = 00:00 hôm SAU hạn (mốc khóa),
 * nên lùi một mili giây. `withYear` cho bảng HQ ("05/12/2026"), mặc định "05/12".
 */
export function overageLastPayDay(dueAt: string, withYear = false): string {
  const d = new Date(new Date(dueAt).getTime() - 1);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${withYear ? `/${d.getFullYear()}` : ""}`;
}
