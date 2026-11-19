// Kiểu dùng chung của bộ quay video đóng hàng bằng webcam (lib thuần, không React).

export type LogLevel = "info" | "warn" | "error";

/**
 * LOẠI VIDEO = chế độ quay: PACK đóng hàng · UNBOX khui hàng hoàn.
 * Anh Trung 16/11/2026: "Chưa có đường quay video khui hàng, và phải làm sao để khi quay video khui hàng không
 * bị trùng mã đơn hàng với video đóng hàng" — kiện hoàn về vẫn dán tem cũ nên camera đọc ra CÙNG một mã;
 * thứ phân biệt hai video là loại này (cột `kind` của sổ video), không phải mã.
 */
export type ClipKind = "PACK" | "UNBOX";

export const CLIP_KIND_LABEL: Record<ClipKind, string> = { PACK: "Đóng hàng", UNBOX: "Khui hàng hoàn" };

/** Một dòng nhật ký bằng tiếng Việt cho NGƯỜI ĐÓNG HÀNG đọc (anh Trung 16/11: "giữ lại cả nhật ký… khá cần"). */
export type RecorderLog = (level: LogLevel, text: string) => void;

/** Một mã đọc được trên khung hình. */
export interface ScannedCode {
  format: string;
  rawValue: string;
  box: { x: number; y: number; w: number; h: number } | null;
  corners: { x: number; y: number }[] | null;
}

/** Một lần ghi của bộ ghép MP4, đã thành một mảnh riêng (xem clip-store.ts). */
export interface ClipPiece {
  position: number;
  length: number;
  /** "disk" = nằm trên ổ của trình duyệt (bền); "ram" = nằm trong bộ nhớ (ổ không ghi được). */
  where: "disk" | "ram";
  name: string;
}

/** Tệp MP4 của một clip đã quay xong, dưới dạng các mảnh chờ gửi. */
export interface ClipFile {
  fileKey: string;
  sizeBytes: number;
  pieces: ClipPiece[];
  /** true = mọi mảnh nằm trên ổ → clip sống qua tải lại trang. */
  durable: boolean;
}

/**
 * Thông tin đường quay đưa cho SỔ CỨU CLIP lúc một clip mở (lát M1b — clip-recovery.ts): đủ để ghép lại tệp MP4
 * nếu trang sập trước khi clip kết thúc.
 */
export interface RecoveryHead {
  code: string;
  manual: boolean;
  /** Lúc khung đầu tiên của clip vào bộ mã hóa. */
  startedAtIso: string;
  width: number;
  height: number;
  /** Chuỗi codec + cấu hình giải mã (avcC) bộ mã hóa đưa ra. */
  codec: string;
  description: Uint8Array | null;
  /** Vài byte đầu của khung đầu tiên — để tìm chỗ bắt đầu dữ liệu khung hình trong tệp dở. */
  firstBytes: Uint8Array;
}

/** Chỗ nhận dữ liệu của một clip đang quay — bộ quay xin một cái cho mỗi clip. */
export interface ClipSinkLike {
  stream(): WritableStream<{ type: "write"; data: Uint8Array; position: number }>;
  finish(): ClipFile;
  /** M1b: báo clip vừa mở (gọi MỘT lần, trước khung đầu). Kho không hỗ trợ thì bỏ trống. */
  recoveryBegin?(head: RecoveryHead): void;
  /** M1b: báo một khung sắp được ghép vào tệp, đúng thứ tự ghép. */
  recoverySample?(sizeBytes: number, timestampUs: number, durationUs: number, key: boolean): void;
}

/** Clip vừa quay xong, chờ tải lên. */
export interface FinishedClip {
  /** Mã tem, hoặc QUAYTAY… / KHUITAY… với clip quay tay. */
  code: string;
  manual: boolean;
  /** Lúc khung đầu tiên của clip vào bộ mã hóa. */
  startedAt: Date;
  durationSec: number;
  width: number;
  height: number;
  frames: number;
  /** Tệp MP4 hoàn chỉnh (`moov` CUỐI tệp), nằm ở kho clip chờ gửi. */
  file: ClipFile;
}

export type ClipOutcome = { ok: true; clip: FinishedClip } | { ok: false; code: string; error: string };
