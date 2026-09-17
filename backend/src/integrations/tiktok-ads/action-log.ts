// ============================================================
// TIKTOK ADS — QUY ƯỚC GHI / ĐỌC SỔ THAO TÁC VIDEO (thuần, không đụng DB)
//
// Lệnh loại / khôi phục video dùng chung bảng AdsActionLog với Shopee/Lazada
// (bảng cấp CAMPAIGN, không có cột video) → danh sách video nằm trong cột
// `reasons`, mỗi dòng một ý:
//   "#<videoId> · <ghi chú số liệu lúc thao tác>"   ← một video của lệnh
//   dòng KHÔNG mở đầu bằng "#<số>"                   ← CĂN CỨ của lệnh tự động
// verdict = "manual" là chủ shop tự bấm; khác "manual" là Trợ lý tự động.
// Route đọc lại đúng quy ước này để: hiện lịch sử (mã video + lý do) và đánh
// dấu video "đang chờ TikTok áp dụng" (sàn không trả kết quả từng video).
// ============================================================

export const VIDEO_ACTION_EXCLUDE = "exclude_video";
export const VIDEO_ACTION_RESTORE = "restore_video";
export const VIDEO_ACTIONS = [VIDEO_ACTION_EXCLUDE, VIDEO_ACTION_RESTORE];
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
