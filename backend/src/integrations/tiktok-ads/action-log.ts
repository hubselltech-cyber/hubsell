// ============================================================
// TIKTOK ADS — QUY ƯỚC GHI / ĐỌC SỔ THAO TÁC VIDEO (thuần, không đụng DB)
//
// Lệnh loại / khôi phục video dùng chung bảng AdsActionLog với Shopee/Lazada
// (bảng cấp CAMPAIGN, không có cột video) → danh sách video nằm trong cột
// `reasons`, mỗi dòng một ý:
//   "#<videoId> · <ghi chú số liệu lúc thao tác>"   ← một video của lệnh
//   dòng KHÔNG mở đầu bằng "#<số>"                   ← CĂN CỨ của lệnh tự động
// verdict = "manual" là chủ shop tự bấm (kể cả nút "Loại ngay": máy chấm danh sách, người bấm gửi); khác "manual" là Trợ lý tự động.
// Route đọc lại đúng quy ước này để: hiện lịch sử (mã video + lý do) và đánh
// dấu video "đang chờ TikTok áp dụng" (sàn không trả kết quả từng video).
// ============================================================

export const VIDEO_ACTION_EXCLUDE = "exclude_video";
export const VIDEO_ACTION_RESTORE = "restore_video";
export const VIDEO_ACTIONS = [VIDEO_ACTION_EXCLUDE, VIDEO_ACTION_RESTORE];
/**
 * KHÔNG phải lệnh video: NHẬT KÝ ĐỔI THÔNG SỐ của cấu hình tự động loại (anh Trung 18/09 khuya: "khách đổi thông số thì mình
 * cứ lưu lại lịch sử thời gian đổi thông số thôi"). Mỗi lần Lưu mà có gì đổi → một dòng trung tính: giờ + từng ô số cũ → số
 * mới (+ đổi chế độ). Không phán xét, không nhắc chuyện diễn tập. `reasons` chỉ có các dòng đó, không có video.
 */
export const VIDEO_ACTION_CONFIG_CHANGE = "config_change";
/** Những gì tab Lịch sử của trang chiến dịch hiện. */
export const VIDEO_HISTORY_ACTIONS = [...VIDEO_ACTIONS, VIDEO_ACTION_CONFIG_CHANGE];
/** verdict của lệnh do chủ shop tự bấm. */
export const VIDEO_VERDICT_MANUAL = "manual";

const VIDEO_LINE = /^#(\d+)(?: · )?(.*)$/;

export interface VideoActionItem {
  videoId: string;
  /** Số liệu lúc thao tác, vd "chi 90.377đ · 0 đơn". */
  note: string;
}

/** Ghi chú số liệu của một video tại thời điểm ra lệnh. */
export function videoActionNote(cost: number, orders: number): string {
  return `chi ${Math.round(cost).toLocaleString("vi-VN")}đ · ${orders} đơn`;
}

/** Dựng cột reasons: căn cứ (nếu có) đứng trước, rồi mỗi video một dòng. */
export function buildVideoActionReasons(items: VideoActionItem[], grounds: string[] = []): string {
  return [
    ...grounds.map((g) => g.replace(/^#+/, "").trim()).filter(Boolean),
    ...items.map((x) => (x.note ? `#${x.videoId} · ${x.note}` : `#${x.videoId}`)),
  ].join("\n");
}

/** Một dòng sổ như DB trả (chỉ các cột route cần) → mục lịch sử cho FE / mobile. */
export interface VideoActionLogRow {
  id: string;
  action: string;
  mode: string;
  verdict: string;
  status: string;
  error: string | null;
  reasons: string;
  createdAt: Date;
}

/** Hình dạng MỘT mục lịch sử (dùng chung cho `actions` trong payload videos và trang lịch sử chia trang). */
export function serializeVideoActionLog(l: VideoActionLogRow) {
  return {
    id: l.id,
    action: l.action,
    /** dry_run = lệnh DIỄN TẬP (status PLANNED, chưa gọi sàn); live = đã gửi lên TikTok. */
    mode: l.mode,
    status: l.status,
    error: l.error,
    /** manual = chủ shop tự bấm; auto = Trợ lý tự động (căn cứ ở grounds). */
    source: l.verdict === VIDEO_VERDICT_MANUAL ? ("manual" as const) : ("auto" as const),
    ...parseVideoActionReasons(l.reasons),
    createdAt: l.createdAt,
  };
}

/**
 * CHIA TRANG LỊCH SỬ (anh Trung 24/10/2026: trước chỉ 10 lệnh mới nhất, dàn một trang, lệnh cũ mất hẳn). Con trỏ kiểu
 * keyset theo (createdAt DESC, id DESC) — không dùng skip/offset vì máy tự động thêm lệnh mỗi ngày làm trang trôi
 * (xem gotcha cursor+skip 22/10). Con trỏ = base64url("<createdAt ms>|<id>") để FE/mobile cầm như chuỗi mờ.
 */
export const VIDEO_HISTORY_PAGE_SIZE = 20;
export const VIDEO_HISTORY_PAGE_MAX = 50;

export function encodeHistoryCursor(last: { createdAt: Date; id: string }): string {
  return Buffer.from(`${last.createdAt.getTime()}|${last.id}`, "utf8").toString("base64url");
}

/** null = con trỏ rỗng hoặc hỏng → đọc từ đầu (không ném lỗi: khách bấm link cũ vẫn ra trang 1). */
export function decodeHistoryCursor(raw: unknown): { createdAt: Date; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  let text = "";
  try {
    text = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const bar = text.indexOf("|");
  if (bar <= 0) return null;
  const ms = Number(text.slice(0, bar));
  const id = text.slice(bar + 1);
  if (!Number.isFinite(ms) || !id) return null;
  return { createdAt: new Date(ms), id };
}

/** Điều kiện "sau con trỏ" cho Prisma (createdAt DESC, id DESC). */
export function historyCursorWhere(c: { createdAt: Date; id: string }) {
  return { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] };
}

/** Kẹp limit người gọi xin về [1, VIDEO_HISTORY_PAGE_MAX]; thiếu/hỏng → mặc định. */
export function clampHistoryLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return VIDEO_HISTORY_PAGE_SIZE;
  return Math.min(Math.floor(n), VIDEO_HISTORY_PAGE_MAX);
}

/** Đọc ngược cột reasons → video của lệnh + căn cứ. */
export function parseVideoActionReasons(reasons: string): { videos: VideoActionItem[]; grounds: string[] } {
  const videos: VideoActionItem[] = [];
  const grounds: string[] = [];
  for (const raw of reasons.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = VIDEO_LINE.exec(line);
    if (m) videos.push({ videoId: m[1], note: m[2].trim() });
    else grounds.push(line);
  }
  return { videos, grounds };
}
