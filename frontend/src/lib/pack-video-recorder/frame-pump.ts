// ============================================================
// Bơm khung hình: lấy từng khung camera đưa cho đường quay.
//
// Hai cách, chọn cách đầu tiên trình duyệt có:
//  - "mstp": MediaStreamTrackProcessor — đọc thẳng VideoFrame từ track, không phụ thuộc việc vẽ màn hình.
//            Đo 16/11/2026: tab bị ẩn 30 giây khung hình VẪN về đủ 29,9 khung/giây.
//  - "rvfc": requestVideoFrameCallback trên thẻ <video> — gắn với việc vẽ màn hình, đứng khi tab bị ẩn.
//            Chỉ là đường lùi cho trình duyệt thiếu cách trên.
// ============================================================

import type { RecorderLog } from "./types";

export type PumpMode = "mstp" | "rvfc";

/** onFrame có thể trả Promise; khung chỉ được đóng sau khi Promise xong. */
export type FrameHandler = (source: VideoFrame | HTMLVideoElement, timestampUs: number) => void | Promise<void>;

export interface FramePump {
  mode: PumpMode;
  stop(): Promise<void>;
}

interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack; maxBufferSize?: number }): { readable: ReadableStream<VideoFrame> };
}

export function trackProcessorCtor(): TrackProcessorCtor | null {
  const ctor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
  return typeof ctor === "function" ? ctor : null;
}

export function resolvePumpMode(): PumpMode | null {
  if (trackProcessorCtor()) return "mstp";
  if (typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    return "rvfc";
  }
  return null;
}

export function startPump(opts: {
  mode: PumpMode;
  track: MediaStreamTrack;
  video: HTMLVideoElement;
  onFrame: FrameHandler;
  log: RecorderLog;
}): FramePump {
  const { mode, track, video, onFrame, log } = opts;
  let running = true;
  let errors = 0;
  const fail = (err: unknown) => {
    errors++;
    if (errors <= 3) log("error", `Lỗi khi xử lý khung hình: ${err instanceof Error ? err.message : String(err)}`);
  };

  if (mode === "mstp") {
    const Ctor = trackProcessorCtor();
    if (!Ctor) throw new Error("Trình duyệt không có MediaStreamTrackProcessor");
    // Nhân bản track để việc đọc khung không ảnh hưởng thẻ <video> xem trước.
    const clone = track.clone();
    const reader = new Ctor({ track: clone, maxBufferSize: 2 }).readable.getReader();
    const loop = (async () => {
      while (running) {
        let result: ReadableStreamReadResult<VideoFrame>;
        try {
          result = await reader.read();
        } catch (err) {
          if (running) fail(err);
          break;
        }
        if (result.done) break;
        const frame = result.value;
        try {
          if (running) await onFrame(frame, frame.timestamp ?? performance.now() * 1000);
        } catch (err) {
          fail(err);
        } finally {
          frame.close();
        }
      }
    })();
    return {
      mode,
      async stop() {
        if (!running) return;
        running = false;
        try {
          await reader.cancel();
        } catch {
          // đã đóng
        }
        await loop.catch(() => {});
        clone.stop();
      },
    };
  }

  let busy = false;
  let handle = 0;
  const tick: VideoFrameRequestCallback = (now) => {
    if (!running) return;
    handle = video.requestVideoFrameCallback(tick);
    if (busy) return;
    busy = true;
    Promise.resolve()
      .then(() => onFrame(video, now * 1000))
      .catch(fail)
      .finally(() => {
        busy = false;
      });
  };
  handle = video.requestVideoFrameCallback(tick);
  return {
    mode,
    async stop() {
      if (!running) return;
      running = false;
      try {
        video.cancelVideoFrameCallback(handle);
      } catch {
        // không sao
      }
    },
  };
}
