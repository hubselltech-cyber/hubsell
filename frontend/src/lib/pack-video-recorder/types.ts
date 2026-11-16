// Kiểu dùng chung của bộ quay video đóng hàng bằng webcam (lib thuần, không React).

export type LogLevel = "info" | "warn" | "error";

/** Một dòng nhật ký bằng tiếng Việt cho NGƯỜI ĐÓNG HÀNG đọc (anh Trung 16/11: "giữ lại cả nhật ký… khá cần"). */
export type RecorderLog = (level: LogLevel, text: string) => void;

/** Một mã đọc được trên khung hình. */
export interface ScannedCode {
  format: string;
  rawValue: string;
  box: { x: number; y: number; w: number; h: number } | null;
  corners: { x: number; y: number }[] | null;
}

/** Clip vừa quay xong, còn nằm trong bộ nhớ chờ tải lên. */
export interface FinishedClip {
  /** Mã tem, hoặc QUAYTAY… với clip quay tay. */
  code: string;
  manual: boolean;
  /** Lúc khung đầu tiên của clip vào bộ mã hóa. */
  startedAt: Date;
  durationSec: number;
  width: number;
  height: number;
  frames: number;
  /** Tệp MP4 hoàn chỉnh (moov đầu tệp). */
  buffer: ArrayBuffer;
}

export type ClipOutcome = { ok: true; clip: FinishedClip } | { ok: false; code: string; error: string };
