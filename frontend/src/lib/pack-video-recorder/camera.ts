// ============================================================
// Mở webcam cho màn quay — có THỬ LẠI và câu lỗi nói thẳng việc cần làm.
//
// Thấy thật 16/11/2026 (anh Trung: "Thỉnh thoảng nó hay lỗi mở camera"): webcam USB cắm qua bộ chia tự
// rớt rồi nối lại; Windows đã thấy thiết bị, không ứng dụng nào giữ, nhưng Chrome vẫn trả NotReadableError
// trong vài chục giây. → thử lại vài lần trước khi báo lỗi, và câu lỗi chỉ thẳng "kiểm tra dây USB".
// ============================================================

import { CAMERA_OPEN_ATTEMPTS, CAMERA_OPEN_RETRY_MS, RECORD_FPS, RECORD_HEIGHT, RECORD_WIDTH } from "./config";
import type { RecorderLog } from "./types";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

const RETRYABLE = new Set(["NotReadableError", "AbortError"]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Câu lỗi cho người đóng hàng — nói việc cần làm, không nói tên lỗi của trình duyệt. */
export function cameraErrorText(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Trình duyệt chưa cho phép dùng camera. Bấm biểu tượng ổ khóa cạnh thanh địa chỉ, cho phép Camera rồi bật lại.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Không thấy camera. Kiểm tra webcam đã cắm vào máy chưa.";
    case "NotReadableError":
    case "AbortError":
      return "Không đọc được camera. Kiểm tra dây USB (nên cắm thẳng vào máy, không qua bộ chia) hoặc đóng ứng dụng khác đang dùng camera.";
    default:
      return `Không bật được camera: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function listCameras(): Promise<CameraDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return devices
    .filter((d) => d.kind === "videoinput" && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Lỗi mở camera có đáng thử lại không (camera vừa cắm lại / cổng USB đang bận). */
export function isRetryableCameraError(err: unknown): boolean {
  return RETRYABLE.has((err as { name?: string } | null)?.name ?? "");
}

/**
 * Câu lỗi riêng cho CAMERA CẬN CẢNH (camera thứ hai). Đo 18/11/2026 (mục 18.7): hai webcam cắm chung một ổ chia
 * USB thì con mở sau báo NotReadableError ở mọi cỡ hình → câu báo phải chỉ thẳng "cắm sang cổng khác".
 */
export function closeupErrorText(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Trình duyệt chưa cho phép dùng camera cận cảnh. Bấm biểu tượng ổ khóa cạnh thanh địa chỉ, cho phép Camera rồi bật lại.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Không thấy camera cận cảnh. Kiểm tra webcam thứ hai đã cắm vào máy chưa, rồi chọn lại.";
    case "NotReadableError":
    case "AbortError":
      return "Camera cận cảnh không chạy chung cổng với camera chính — cắm sang một cổng USB khác trên máy (không qua ổ chia).";
    default:
      return `Không bật được camera cận cảnh: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Mở camera; lỗi tạm thời thì thử lại. Ném lỗi gốc của trình duyệt khi hết lượt. Mặc định mở ở khổ hình quay;
 * `opts` cho camera cận cảnh đổi khổ hình và số lượt thử (camera chính không truyền gì).
 */
export async function openCameraStream(
  deviceId: string | null,
  log: RecorderLog,
  opts: { width?: number; height?: number; attempts?: number; name?: string } = {}
): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Trình duyệt này không mở được camera (cần Chrome hoặc Edge, trang chạy qua https)");
  }
  const attempts = opts.attempts ?? CAMERA_OPEN_ATTEMPTS;
  const name = opts.name ?? "Camera";
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: opts.width ?? RECORD_WIDTH },
      height: { ideal: opts.height ?? RECORD_HEIGHT },
      frameRate: { ideal: RECORD_FPS },
    },
  };
  for (let attempt = 1; ; attempt++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (attempt > 1) log("info", `Bật được ${name.toLowerCase()} ở lần thử ${attempt}`);
      return stream;
    } catch (err) {
      if (!isRetryableCameraError(err) || attempt >= attempts) throw err;
      log("warn", `${name} chưa sẵn sàng (lần ${attempt} / ${attempts}) — thử lại sau 1,5 giây`);
      await sleep(CAMERA_OPEN_RETRY_MS);
    }
  }
}
