/**
 * HÀM THUẦN của trang Video đóng hàng (docs/VIDEO-DONG-HANG-THIET-KE.md).
 * Không gọi mạng, không nhập gì từ components/ — chỉ định dạng và nhãn.
 */

import type { PackVideoKind, PackVideoStatus, ReturnStatus, ShippingStatus } from "./api";

/** Đường dẫn trang danh sách và trang hồ sơ video của một đơn. */
export const PACK_VIDEOS_PATH = "/orders/videos";
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

/** Loại hoàn cho người đọc: sàn có loại hoàn = khách trả hàng; không có = kiện giao thất bại quay về. */
export function returnTypeLabel(returnType: string | null): string {
  return returnType ? "Khách trả hàng" : "Giao thất bại";
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
