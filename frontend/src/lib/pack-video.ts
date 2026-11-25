/**
 * HÀM THUẦN của trang Video đóng hàng (docs/VIDEO-DONG-HANG-THIET-KE.md).
 * Không gọi mạng, không nhập gì từ components/ — chỉ định dạng và nhãn.
 */

import type { PackVideoKind, PackVideoStatus, ReturnStatus, ShippingStatus } from "./api";

/** Đường dẫn trang danh sách và trang hồ sơ video của một đơn. */
export const PACK_VIDEOS_PATH = "/orders/videos";
/** Màn quay bằng webcam; `?mode=unbox` mở sẵn chế độ khui hàng hoàn. */
export const PACK_VIDEO_RECORD_PATH = `${PACK_VIDEOS_PATH}/record`;
export const PACK_VIDEO_UNBOX_RECORD_PATH = `${PACK_VIDEO_RECORD_PATH}?mode=unbox`;

export function packVideoOrderPath(orderId: string): string {
  return `${PACK_VIDEOS_PATH}/order/${encodeURIComponent(orderId)}`;
}

/**
 * Mốc tải thẳng lên Shopee: người bán đính kèm trực tiếp được video dưới 1 phút
 * (docs/VIDEO-DONG-HANG-TU-KHIEU-NAI-KHAO-SAT.md mục 55.7); dài hơn phải nộp bằng
 * đường dẫn Drive / YouTube. Đây là MỐC để gắn nhãn, không phải luật cắt video.
 */
export const SHOPEE_DIRECT_UPLOAD_MAX_SEC = 60;

function clampSeconds(sec: number): number {
  return Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0;
}

/** Thời lượng MỘT video: "0:48", "14:52", "1:02:07". */
export function formatClipDuration(sec: number): string {
  const s = clampSeconds(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** TỔNG giờ quay cho ô số và bảng thống kê: "45 giây", "37 phút", "12 giờ 05 phút". */
export function formatHoursMinutes(sec: number): string {
  const s = clampSeconds(sec);
  if (s < 60) return `${s} giây`;
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} giờ ${String(m).padStart(2, "0")} phút` : `${m} phút`;
}

/**
 * SỐ DƯ / TỔNG giờ quay cỡ lớn: "1.000 giờ", "999 giờ 44 phút", "16 phút", "45 giây".
 * Khác formatHoursMinutes: có dấu chấm hàng nghìn và bỏ "00 phút" khi tròn giờ. Số âm trả theo trị
 * tuyệt đối — chỗ gọi tự thêm chữ "quay lố".
 */
export function formatHoursBalance(sec: number): string {
  const s = Math.round(Math.abs(Number.isFinite(sec) ? sec : 0));
  if (s < 60) return `${s} giây`;
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} phút`;
  const hours = `${h.toLocaleString("vi-VN")} giờ`;
  return m === 0 ? hours : `${hours} ${String(m).padStart(2, "0")} phút`;
}

export type HoursLevel = "none" | "ok" | "low" | "out";

/**
 * Mức của số giờ còn lại — cùng mốc với thanh hạn mức ở trang Gói dịch vụ (UsageBar: vàng từ
 * 80 % đã dùng, đỏ từ 100 %). "none" = chưa từng mua giờ.
 */
export function hoursLevel(purchasedSeconds: number, usedSeconds: number): HoursLevel {
  if (purchasedSeconds <= 0) return usedSeconds > 0 ? "out" : "none";
  const usedRatio = usedSeconds / purchasedSeconds;
  if (usedRatio >= 1) return "out";
  return usedRatio >= 0.8 ? "low" : "ok";
}

/** Số giờ thập phân cho trục biểu đồ (2 chữ số lẻ). */
export function secondsToHours(sec: number): number {
  return Math.round((clampSeconds(sec) / 3600) * 100) / 100;
}

/** Cỡ tệp: "6,5 MB", "920 KB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("vi-VN")} KB`;
}

/** "yyyy-mm-dd" (ngày máy chủ trả) → "dd/mm" cho trục biểu đồ. */
export function formatDayShort(day: string): string {
  const [, m, d] = day.split("-");
  return d && m ? `${d}/${m}` : day;
}

export const PACK_VIDEO_KIND_LABEL: Record<PackVideoKind, string> = {
  PACK: "Video đóng",
  UNBOX: "Video khui",
};

type BadgeMeta = { label: string; className: string };

/** Trạng thái của chính tệp video. STORED là bình thường nên không có nhãn. */
export const PACK_VIDEO_STATUS_META: Partial<Record<PackVideoStatus, BadgeMeta>> = {
  PENDING: { label: "Chờ tải lên", className: "bg-amber-50 text-amber-700 border-amber-200" },
  DELETED: { label: "Đã xóa", className: "bg-zinc-50 text-zinc-600 border-zinc-200" },
  LOST: { label: "Mất tệp", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

/** Chỉ video đã nằm trên kho mới xem / tải được. */
export function isPackVideoPlayable(status: PackVideoStatus): boolean {
  return status === "STORED";
}

/** Nhãn trạng thái đơn — cùng câu chữ và màu với trang Đơn hàng. */
export const PACK_VIDEO_ORDER_STATUS_META: Record<ShippingStatus, BadgeMeta> = {
  PENDING: { label: "Chờ xử lý", className: "bg-zinc-50 text-zinc-600 border-zinc-200" },
  PROCESSED: { label: "Đã xử lý", className: "bg-violet-50 text-violet-700 border-violet-200" },
  SHIPPING: { label: "Đang giao", className: "bg-sky-50 text-sky-700 border-sky-200" },
  DELIVERED: { label: "Đã giao", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Đã hủy", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

/** Tình trạng kho của đơn hoàn — cùng câu chữ với trang Đối soát đơn hoàn. */
export const PACK_VIDEO_RETURN_STATUS_META: Partial<Record<ReturnStatus, BadgeMeta>> = {
  AWAITING: { label: "Chờ hàng về", className: "bg-amber-50 text-amber-700 border-amber-200" },
  RECEIVED: { label: "Đã nhận · chờ nhập kho", className: "bg-blue-50 text-blue-700 border-blue-200" },
  RECEIVED_INTACT: { label: "Đã nhập kho", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  DAMAGED: { label: "Hàng hỏng · chờ khiếu nại sàn", className: "bg-rose-50 text-rose-700 border-rose-200" },
  CLAIM_SETTLED: { label: "Đã được đền bù", className: "bg-sky-50 text-sky-700 border-sky-200" },
  WRITTEN_OFF: { label: "Hao hụt / xóa sổ", className: "bg-zinc-200 text-zinc-700 border-zinc-300" },
};

/** Loại hoàn cho người đọc. (Trước 25/11 hàm đọc `returnType` như cờ có / không → máy chủ luôn gửi chuỗi
 *  nên kiện giao thất bại cũng hiện "Khách trả hàng".) */
export function returnTypeLabel(returnType: "FAILED_DELIVERY" | "BUYER_RETURN"): string {
  return returnType === "FAILED_DELIVERY" ? "Giao thất bại" : "Khách trả hàng";
}

/** Nhãn nộp bằng chứng theo mốc Shopee. */
export function evidenceUploadHint(durationSec: number): { direct: boolean; label: string } {
  const direct = clampSeconds(durationSec) <= SHOPEE_DIRECT_UPLOAD_MAX_SEC;
  return {
    direct,
    label: direct
      ? "≤ 1 phút: tải thẳng lên Shopee được"
      : "Dài hơn 1 phút: nộp bằng đường dẫn Drive / YouTube",
  };
}

// ---------- Mua giờ quay (docs/VIDEO-DONG-HANG-THIET-KE.md mục 19) ----------

/** Báo giá HIỂN THỊ cho ô "Số giờ khác" — cùng luật với máy chủ (lib/pack-video-hour-pricing.ts). Máy chủ
 * vẫn là nơi tính tiền thật lúc thanh toán; số ở đây chỉ để khách thấy phép tính. */
export function quoteHoursForDisplay(
  raw: string,
  pricing: { priceVnd: number; minHours: number; maxHours: number }
): { ok: true; hours: number; amountVnd: number } | { ok: false; error: string | null } {
  const t = raw.trim().replace(/\./g, "");
  if (t === "") return { ok: false, error: null };
  if (!/^\d+$/.test(t)) return { ok: false, error: "Nhập số giờ là số nguyên" };
  const hours = Number(t);
  if (hours < pricing.minHours) return { ok: false, error: `Mua tối thiểu ${pricing.minHours.toLocaleString("vi-VN")} giờ` };
  if (hours > pricing.maxHours) return { ok: false, error: `Mỗi lần mua tối đa ${pricing.maxHours.toLocaleString("vi-VN")} giờ` };
  return { ok: true, hours, amountVnd: hours * pricing.priceVnd };
}

/** "≈ 3.000 video 1 phút" — đổi giờ ra số đơn cho khách dễ hình dung. */
export function approxOneMinuteClips(hours: number): string {
  return `≈ ${(hours * 60).toLocaleString("vi-VN")} video 1 phút`;
}

// ---------- Hạn giữ video (luật tự xóa W5) ----------

/** Chip / nhãn "Sắp tự xóa": hạn giữ trong 3 ngày tới — CÙNG số với máy chủ (library.ts PACK_VIDEO_EXPIRING_DAYS). */
export const PACK_VIDEO_EXPIRING_DAYS = 3;

export type PackVideoHoldReasonKey = "RETURN_OPEN" | "RETURN_DAMAGED" | "UNBOX_UNMATCHED" | "PARCEL_RETURNING";

export const HOLD_REASON_LABEL: Record<PackVideoHoldReasonKey, string> = {
  RETURN_OPEN: "Đơn có hoàn — giữ tới qua hạn khiếu nại",
  RETURN_DAMAGED: "Kiện hoàn hỏng / thiếu — giữ để khiếu nại",
  UNBOX_UNMATCHED: "Video khui chưa khớp đơn — giữ lại",
  PARCEL_RETURNING: "Đơn hủy, kiện đang quay về — giữ tới khi nhận",
};

/**
 * LÝ DO XÓA cho tab Lịch sử xóa — đổi mã luật máy chủ ghi ở cột deleteRule (backend lib/pack-video-retention.ts)
 * ra câu khách đọc được. Luật anh Trung chốt 25/11/2026: xóa sau khi HẾT HẠN 3 ngày, lưu tối đa 60 ngày.
 */
const DELETE_REASON_LABEL: Record<string, string> = {
  L1: "Không khớp được đơn nào sau 7 ngày",
  L2: "Đơn đã hủy trước khi giao cho đơn vị vận chuyển",
  L3: "Đơn hủy, kiện đã về kho nguyên vẹn",
  L4: "Đơn giao thành công, đã qua hạn người mua trả hàng 3 ngày",
  L5: "Đơn hoàn đã xử lý xong",
  L6: "Đã lưu đủ 60 ngày",
  L7: "Đơn hoàn đã qua hạn khiếu nại 3 ngày",
  ACCOUNT: "Tài khoản đã xóa",
};

export function deleteReasonLabel(rule: string | null, kind: "PACK" | "UNBOX"): string {
  const reason = (rule && DELETE_REASON_LABEL[rule]) || "Hệ thống tự xóa theo trạng thái đơn";
  return kind === "UNBOX" ? `Video khui hàng · ${reason}` : reason;
}

/** "25/11/2026" theo giờ Việt Nam từ một mốc ISO. */
export function formatVnDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Số ngày từ hôm nay (giờ máy) tới một ngày "YYYY-MM-DD"; âm = đã qua. */
export function daysUntil(dateKey: string, now: Date = new Date()): number {
  const target = Date.parse(`${dateKey}T00:00:00+07:00`);
  const today = Date.parse(`${new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+07:00`);
  return Math.round((target - today) / 86_400_000);
}

/** "03/12/2026" từ "2026-12-03". */
export function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}
