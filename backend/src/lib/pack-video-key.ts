// ============================================================
// VIDEO ĐÓNG HÀNG — đường dẫn tệp trên kho (hàm thuần)
//
// Khuôn: {ownerId}/{ngày tạo dòng, giờ VN, yyyy-mm-dd}/{id}.mp4
//  · CHỦ SHOP đứng đầu: mọi tệp của một shop nằm dưới một tiền tố — dọn khi shop rời, và
//    máy chủ kiểm được "tệp này của ai" chỉ bằng chuỗi (rào S1 của bản thiết kế).
//  · NGÀY đứng thứ hai: lệnh liệt kê không phải đi qua cả kho; khớp khóa chia mảnh của sổ.
// Đường dẫn LUÔN do máy chủ dựng — không bao giờ nhận từ app / web.
// ============================================================

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface PackVideoKeyParts {
  ownerId: string;
  /** yyyy-mm-dd */
  recordedDate: string;
  id: string;
}

export function buildPackVideoKey(p: PackVideoKeyParts): string {
  if (!ID_RE.test(p.ownerId)) throw new Error("ownerId không hợp lệ để dựng đường dẫn tệp");
  if (!ID_RE.test(p.id)) throw new Error("id video không hợp lệ để dựng đường dẫn tệp");
  if (!DATE_RE.test(p.recordedDate)) throw new Error("recordedDate phải có dạng yyyy-mm-dd");
  return `${p.ownerId}/${p.recordedDate}/${p.id}.mp4`;
}

/** Đọc ngược đường dẫn. Sai khuôn → null (không ném lỗi: dùng để soát tệp lạ). */
export function parsePackVideoKey(key: string): PackVideoKeyParts | null {
  const m = /^([A-Za-z0-9_-]{1,64})\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]{1,64})\.mp4$/.exec(key);
  if (!m) return null;
  return { ownerId: m[1], recordedDate: m[2], id: m[3] };
}

/** Tệp này có nằm dưới tiền tố của chủ shop không — chốt chặn cuối trước khi ký / xóa. */
export function keyBelongsToOwner(key: string, ownerId: string): boolean {
  return parsePackVideoKey(key)?.ownerId === ownerId;
}

/**
 * Tên tệp khi khách bấm "Tải về": mã vận đơn (thứ khách dán vào khiếu nại), video khui thêm "-khui".
 * Chỉ giữ chữ, số, gạch — tên tệp đi vào tiêu đề Content-Disposition.
 */
export function packVideoDownloadName(trackingCode: string, kind: "PACK" | "UNBOX"): string {
  const safe = trackingCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "video";
  return `${safe}${kind === "UNBOX" ? "-khui" : ""}.mp4`;
}
