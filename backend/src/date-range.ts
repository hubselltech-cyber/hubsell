/**
 * BỘ LỌC KHOẢNG THỜI GIAN DÙNG CHUNG
 *
 * Mọi API báo cáo (analytics, dòng tiền, đơn lỗ, chi phí, đối soát ship) đều
 * nhận cùng một cặp query param `?from=yyyy-mm-dd&to=yyyy-mm-dd`, nên frontend
 * chỉ cần một component chọn ngày duy nhất cho tất cả các trang.
 *
 * ⚠️ MÚI GIỜ NGHIỆP VỤ CỐ ĐỊNH UTC+7 (Việt Nam) — TUYỆT ĐỐI không dùng giờ
 * máy chủ để cắt ngày: Render chạy UTC nên "hôm nay" từng bắt đầu lúc 7h sáng
 * VN, mọi đơn phát sinh 0h–7h bị dạt về ngày hôm trước trên mọi báo cáo (bug
 * thật 07/08/2026 — đơn sáng sớm có trong Lãi/Lỗ nhưng "Hôm nay" đếm 0).
 * Ghim +7 thì local dev (máy VN) và Render ra cùng một con số.
 *
 * Quy ước: `from` tính từ 00:00:00.000 và `to` tính đến 23:59:59.999 theo
 * GIỜ VIỆT NAM.
 */

/** Múi giờ nghiệp vụ của shop (VN, UTC+7) tính bằng mili giây. */
export const BUSINESS_TZ_OFFSET_MS = 7 * 3_600_000;

const DAY_MS = 86_400_000;

export interface DateRangeFilter {
  gte: Date;
  lte: Date;
}

/** Chuỗi "yyyy-mm-dd" → Date 00:00 NGÀY ĐÓ GIỜ VN. Sai định dạng → null. */
function parseDayStart(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const utcMidnight = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  // Chặn ngày không tồn tại kiểu 2026-02-31 (JS tự nhảy sang tháng sau)
  const probe = new Date(utcMidnight);
  if (
    probe.getUTCFullYear() !== Number(y) ||
    probe.getUTCMonth() !== Number(mo) - 1 ||
    probe.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  // 00:00 giờ VN = 17:00 UTC ngày hôm trước
  return new Date(utcMidnight - BUSINESS_TZ_OFFSET_MS);
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

  // Hết ngày `to` giờ VN = đầu ngày + 24h − 1ms (KHÔNG setHours — giờ máy chủ)
  return { gte: start, lte: new Date(end.getTime() + DAY_MS - 1) };
}

/**
 * Date → chuỗi "yyyy-mm-dd" theo NGÀY GIỜ VN — nguồn duy nhất để bucket
 * doanh thu/chi phí theo ngày trên biểu đồ (analytics.ts + finance.ts).
 */
export function toBusinessDateKey(d: Date): string {
  const t = new Date(d.getTime() + BUSINESS_TZ_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** Đầu ngày (00:00 giờ VN) chứa thời điểm `d` — thay cho setHours(0,0,0,0). */
export function businessDayStart(d: Date): Date {
  return new Date(
    Math.floor((d.getTime() + BUSINESS_TZ_OFFSET_MS) / DAY_MS) * DAY_MS -
      BUSINESS_TZ_OFFSET_MS
  );
}

/** "yyyy-mm-dd" → nhãn "dd/mm" cho trục X biểu đồ. */
export function dateKeyLabel(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}
