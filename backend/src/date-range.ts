/**
 * BỘ LỌC KHOẢNG THỜI GIAN DÙNG CHUNG
 *
 * Mọi API báo cáo (analytics, dòng tiền, đơn lỗ, chi phí, đối soát ship) đều
 * nhận cùng một cặp query param `?from=yyyy-mm-dd&to=yyyy-mm-dd`, nên frontend
 * chỉ cần một component chọn ngày duy nhất cho tất cả các trang.
 *
 * Quy ước: `from` tính từ 00:00:00.000 và `to` tính đến 23:59:59.999 theo giờ
 * máy chủ — người dùng chọn "01/07 đến 15/07" thì đơn lúc 15/07 20:30 vẫn phải
 * được tính, nếu cắt ở 00:00 sẽ mất trọn ngày cuối.
 */

export interface DateRangeFilter {
  gte: Date;
  lte: Date;
}

/** Chuỗi "yyyy-mm-dd" → Date đầu ngày (giờ máy chủ). Sai định dạng → null. */
function parseDayStart(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
  // Chặn ngày không tồn tại kiểu 2026-02-31 (JS tự nhảy sang tháng sau)
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

/**
 * Đọc `from`/`to` từ query string.
 * Trả về `undefined` khi không lọc (xem toàn bộ lịch sử) để nơi gọi cứ truyền
 * thẳng vào Prisma: `where: { createdAt: range }` — undefined thì Prisma bỏ qua.
 */
export function parseDateRange(query: {
  from?: unknown;
  to?: unknown;
}): DateRangeFilter | undefined {
  const from = parseDayStart(query.from);
  const to = parseDayStart(query.to);
  if (!from || !to) return undefined;

  // Người dùng lỡ chọn ngược (từ 15/07 đến 01/07) → tự đảo lại thay vì trả rỗng
  const [start, end] = from <= to ? [from, to] : [to, from];

  const lte = new Date(end);
  lte.setHours(23, 59, 59, 999);

  return { gte: start, lte };
}
