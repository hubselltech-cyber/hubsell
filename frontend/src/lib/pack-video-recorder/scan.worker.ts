// ============================================================
// Worker đọc mã: nhận ImageBitmap của khung hình, trả mã đọc được.
// Chạy ngoài luồng chính để việc đọc mã (trung bình 53 ms, lâu nhất 142 ms — đo 16/11/2026) không làm
// giật đường quay. Thử chạy trên luồng chính ở 1440p: 3 giây chỉ còn 63 khung thay vì ≈ 90.
// ============================================================

import { createDetector, plainCodes } from "./scan-core";
import type { ScannedCode } from "./types";

export type ScanRequest = { type: "init" } | { type: "detect"; id: number; bitmap: ImageBitmap };

export type ScanReply =
  | { type: "ready"; engine: string }
  | { type: "init-error"; error: string }
  | { type: "result"; id: number; codes: ScannedCode[]; error?: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ScanRequest>) => void) | null;
  postMessage(reply: ScanReply): void;
};

let detectorPromise: ReturnType<typeof createDetector> | null = null;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

scope.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    try {
      detectorPromise = createDetector();
      const { info } = await detectorPromise;
      scope.postMessage({ type: "ready", engine: info.engine });
    } catch (err) {
      detectorPromise = null;
      scope.postMessage({ type: "init-error", error: errText(err) });
    }
    return;
  }
  if (msg.type === "detect") {
    const { id, bitmap } = msg;
    try {
      if (!detectorPromise) throw new Error("Bộ đọc mã chưa khởi động");
      const { detect } = await detectorPromise;
      scope.postMessage({ type: "result", id, codes: plainCodes(await detect(bitmap)) });
    } catch (err) {
      scope.postMessage({ type: "result", id, codes: [], error: errText(err) });
    } finally {
      try {
        bitmap.close();
      } catch {
        // đã đóng
      }
    }
  }
};
