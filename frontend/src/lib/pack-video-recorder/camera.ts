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

/** Mở camera ở khổ hình quay; lỗi tạm thời thì thử lại. Ném lỗi gốc của trình duyệt khi hết lượt. */
export async function openCameraStream(deviceId: string | null, log: RecorderLog): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Trình duyệt này không mở được camera (cần Chrome hoặc Edge, trang chạy qua https)");
  }
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: RECORD_WIDTH },
      height: { ideal: RECORD_HEIGHT },
      frameRate: { ideal: RECORD_FPS },
    },
  };
  for (let attempt = 1; ; attempt++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (attempt > 1) log("info", `Bật được camera ở lần thử ${attempt}`);
      return stream;
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? "";
      if (!RETRYABLE.has(name) || attempt >= CAMERA_OPEN_ATTEMPTS) throw err;
      log("warn", `Camera chưa sẵn sàng (lần ${attempt} / ${CAMERA_OPEN_ATTEMPTS}) — thử lại sau 1,5 giây`);
      await sleep(CAMERA_OPEN_RETRY_MS);
    }
  }
}
