// ============================================================
// NGÀY của các phép tính quảng cáo — dùng chung Shopee / Lazada / TikTok.
//
// Số quảng cáo của sàn lưu theo NGÀY SÀN (giờ VN) trong cột @db.Date (00:00
// UTC); server Render chạy UTC. Các hàm ở đây đổi qua lại giữa "YYYY-MM-DD"
// ngày sàn, Date của cột @db.Date và bộ lọc ?from=&to= của trang Trợ lý quảng
// cáo. Thuần — không gọi database.
// ============================================================

/** 00:00 (giờ máy chủ) của ngày đầu một cửa sổ `days` ngày tính cả hôm nay. */
export function startOfDaysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** "YYYY-MM-DD" theo UTC — cột @db.Date lưu 00:00 UTC nên đọc bằng UTC mới đúng ngày. */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" của N ngày trước theo GIỜ VN — ngày trong AdsCampaignDailyPerf
 *  là ngày của SÀN (múi giờ VN), server Render chạy UTC nên phải cộng 7h. */
export function vnDateKey(daysAgo: number): string {
  return new Date(Date.now() + 7 * 3600_000 - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Cửa sổ `daysBack` NGÀY SÀN (giờ VN) tính cả hôm nay — khoảng ngày mọi lượt kéo
 * số quảng cáo gửi lên sàn. Không được tính bằng getDate() của máy chủ: Render
 * chạy UTC nên từ 0h tới 7h sáng VN "hôm nay" của máy chủ vẫn là hôm qua của sàn
 * (01/10/2026: xung không có dòng hôm nay suốt 7 tiếng đầu ngày).
 */
export function vnDayWindow(daysBack: number): { startKey: string; endKey: string } {
  return { startKey: vnDateKey(Math.max(1, daysBack) - 1), endKey: vnDateKey(0) };
}

/** "YYYY-MM-DD" (ngày sàn) → "DD-MM-YYYY" — định dạng ngày của Shopee Ads API. */
export function shopeeDateParam(key: string): string {
  return `${key.slice(8, 10)}-${key.slice(5, 7)}-${key.slice(0, 4)}`;
}

// ---- Khoảng ngày của BỘ LỌC trang Trợ lý quảng cáo (24/09/2026) ----
//
// Trang Shopee/Lazada dùng bộ lọc chuẩn của app (?from=&to= theo NGÀY SÀN, giờ
// VN) thay cho 4 nút cứng Hôm nay/7/14/30 ngày. Số hiệu suất đọc từ DB, xung
// ads không dọn dòng cũ nên xem "Tháng trước" là có số thật (từ ngày gian bắt
// đầu kéo). Trần 90 ngày là MẶC ĐỊNH TỰ ĐẶT theo ngân sách RAM sau sự cố OOM
// 09/2026: mỗi campaign một dòng/ngày, gian 150 campaign × 90 ngày ≈ 13.500 dòng
// Decimal một lượt mở trang — không phải giới hạn của sàn, nới được khi cần.
export const ADS_RANGE_MAX_DAYS = 90;

export interface AdsDateRange {
  /** "YYYY-MM-DD" ngày đầu (ngày sàn). */
  fromKey: string;
  /** "YYYY-MM-DD" ngày cuối (ngày sàn), không quá hôm nay. */
  toKey: string;
  /** Số ngày trong khoảng, tính cả hai đầu. */
  days: number;
  /** true = ngày đầu bị kéo lên vì vượt trần ADS_RANGE_MAX_DAYS. */
  clamped: boolean;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" hợp lệ (đúng định dạng + ngày tồn tại) → chính nó, sai → null. */
function validDateKey(v: unknown): string | null {
  if (typeof v !== "string" || !DATE_KEY_RE.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  // Chặn 2026-02-31 (JS tự nhảy sang tháng sau).
  return new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

/** Dời "YYYY-MM-DD" đi N ngày (âm = lùi). */
export function shiftDateKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Số ngày từ a tới b tính cả hai đầu (a ≤ b). */
function daysInclusive(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Đọc ?from=&to= của bộ lọc chuẩn (ưu tiên) hoặc ?days= (đường cũ) thành khoảng
 * ngày sàn đã chuẩn hóa: đảo lại nếu chọn ngược, cắt về hôm nay nếu chọn tương
 * lai, kéo ngày đầu lên nếu dài quá trần (báo `clamped` để UI nói rõ).
 */
export function resolveAdsDateRange(
  query: { from?: unknown; to?: unknown; days?: unknown },
  todayKey: string = vnDateKey(0)
): AdsDateRange {
  const from = validDateKey(query.from);
  const to = validDateKey(query.to);
  if (from && to) {
    let [start, end] = from <= to ? [from, to] : [to, from];
    if (end > todayKey) end = todayKey;
    if (start > end) start = end;
    const floor = shiftDateKey(end, -(ADS_RANGE_MAX_DAYS - 1));
    const clamped = start < floor;
    if (clamped) start = floor;
    return { fromKey: start, toKey: end, days: daysInclusive(start, end), clamped };
  }
  const n = Number(query.days);
  const days = Number.isFinite(n) ? Math.min(ADS_RANGE_MAX_DAYS, Math.max(1, Math.trunc(n))) : 7;
  return { fromKey: shiftDateKey(todayKey, -(days - 1)), toKey: todayKey, days, clamped: false };
}

/** "YYYY-MM-DD" (ngày sàn) → Date 00:00 UTC — đúng cách cột @db.Date lưu. */
export function dateKeyToDbDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}
