// ============================================================
// CAMERA CẬN CẢNH — nguồn hình thứ hai cho ô ghép ở góc video (docs/VIDEO-DONG-HANG-THIET-KE.md mục 22).
//
// Anh Trung 19/11/2026: "Cam cận cảnh thì không có chức năng ngắt video, chỉ ngắt khi nó nhận được tín hiệu ngắt từ
// cam toàn cảnh." → lớp này CHỈ giữ khung hình mới nhất của camera cận để bộ ghép hình vẽ vào ô. ⛔ KHÔNG nối vào
// bộ đọc tem (scanner.ts), KHÔNG mở / cắt / dừng clip. Camera toàn cảnh dẫn nhịp: mỗi khung toàn cảnh lấy khung
// cận mới nhất tại lúc đó (lệch tối đa một khung).
//
// Hai cách lấy khung, cùng lý do với frame-pump.ts:
//  - MediaStreamTrackProcessor: đọc thẳng VideoFrame, không đứng khi tab bị ẩn;
//  - thẻ <video> rời (không gắn vào trang) cho trình duyệt thiếu cách trên.
// ============================================================

import { isRetryableCameraError, openCameraStream } from "./camera";
import { trackProcessorCtor } from "./frame-pump";
import type { RecorderLog } from "./types";

/**
 * Thử mở từ khổ lớn xuống nhỏ: khổ lớn để PHÓNG TO vùng mã của tem còn nét; cổng USB không gánh nổi hai camera ở
 * khổ lớn thì lùi dần. Thứ tự là SỐ TỰ CHỌN — mới đo hai camera cùng chạy ở 1280×720 (17/11), chưa đo 1920×1080
 * chạy cùng camera chính.
 */
const CLOSEUP_SIZES: readonly (readonly [number, number])[] = [
  [1920, 1080],
  [1280, 720],
  [640, 480],
];

export interface CloseupFrame {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export class CloseupSource {
  readonly track: MediaStreamTrack;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** Camera cận tự mất (rút dây, rớt USB). Không gọi khi chính mình đóng. */
  onEnded: (() => void) | null = null;

  private latest: VideoFrame | null = null;
  private video: HTMLVideoElement | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private clone: MediaStreamTrack | null = null;
  private closed = false;

  private constructor(readonly stream: MediaStream) {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("Camera cận cảnh không trả luồng hình nào");
    this.track = track;
    const settings = track.getSettings();
    this.label = track.label || "Camera cận cảnh";
    this.width = settings.width ?? 0;
    this.height = settings.height ?? 0;
    track.addEventListener("ended", () => {
      if (!this.closed) this.onEnded?.();
    });
  }

  static async open(deviceId: string, log: RecorderLog): Promise<CloseupSource> {
    let lastError: unknown = null;
    for (const [width, height] of CLOSEUP_SIZES) {
      try {
        const stream = await openCameraStream(deviceId, log, { width, height, attempts: 2, name: "Camera cận cảnh" });
        const source = new CloseupSource(stream);
        source.startReading();
        return source;
      } catch (err) {
        lastError = err;
        // Chỉ lùi khổ hình với lỗi "cổng đang bận / không đọc được"; thiếu quyền, không thấy camera thì dừng luôn.
        if (!isRetryableCameraError(err)) throw err;
      }
    }
    throw lastError;
  }

  private startReading(): void {
    const Ctor = trackProcessorCtor();
    if (Ctor) {
      // Nhân bản track để việc đọc khung không ảnh hưởng thẻ <video> xem trước của ô cận cảnh.
      const clone = this.track.clone();
      this.clone = clone;
      const reader = new Ctor({ track: clone, maxBufferSize: 1 }).readable.getReader();
      this.reader = reader;
      void (async () => {
        while (!this.closed) {
          let result: ReadableStreamReadResult<VideoFrame>;
          try {
            result = await reader.read();
          } catch {
            break;
          }
          if (result.done) break;
          if (this.closed) {
            result.value.close();
            break;
          }
          // Đổi khung trong cùng một nhịp chạy: bộ ghép hình không bao giờ thấy khung đã đóng.
          const previous = this.latest;
          this.latest = result.value;
          previous?.close();
        }
      })();
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    void video.play().catch(() => {});
    this.video = video;
  }

  /** Khung mới nhất để vẽ vào ô; null khi chưa có khung nào. */
  current(): CloseupFrame | null {
    if (this.closed) return null;
    const frame = this.latest;
    if (frame) return { image: frame, width: frame.displayWidth, height: frame.displayHeight };
    const video = this.video;
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      return { image: video, width: video.videoWidth, height: video.videoHeight };
    }
    return null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onEnded = null;
    void this.reader?.cancel().catch(() => {});
    this.reader = null;
    this.clone?.stop();
    this.clone = null;
    this.latest?.close();
    this.latest = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    for (const t of this.stream.getTracks()) t.stop();
  }
}
