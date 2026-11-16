// ============================================================
// Lõi đọc mã trên tem — dùng được cả trong Worker lẫn luồng chính.
//
// Chrome trên Windows KHÔNG có sẵn BarcodeDetector (chỉ ChromeOS và macOS) nên phải nhúng thư viện:
// ponyfill `barcode-detector` (zxing-wasm). Tệp .wasm lấy từ `frontend/public`, không gọi mạng ngoài.
// Máy nào có sẵn bộ đọc của trình duyệt đủ hai định dạng thì dùng bộ đó.
// ============================================================

import { SCAN_FORMATS, ZXING_READER_WASM_URL } from "./config";
import type { ScannedCode } from "./types";

type DetectFn = (image: ImageBitmap) => Promise<DetectedLike[]>;

interface DetectedLike {
  format: string;
  rawValue: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  cornerPoints?: { x: number; y: number }[];
}

interface NativeDetectorCtor {
  new (init: { formats: string[] }): { detect(image: ImageBitmap): Promise<DetectedLike[]> };
  getSupportedFormats(): Promise<string[]>;
}

export interface DetectorInfo {
  engine: "native" | "ponyfill";
}

export async function createDetector(): Promise<{ info: DetectorInfo; detect: DetectFn }> {
  const formats = [...SCAN_FORMATS] as string[];
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      if (formats.every((f) => supported.includes(f))) {
        const native = new Native({ formats });
        return { info: { engine: "native" }, detect: (image) => native.detect(image) };
      }
    } catch {
      // rơi xuống ponyfill
    }
  }

  const mod = await import("barcode-detector/ponyfill");
  // Chỉ đường cho zxing-wasm lấy .wasm ngay trên máy chủ của mình (mặc định nó gọi jsDelivr).
  // fireImmediately: nạp wasm ngay để lỗi lộ ra lúc khởi động chứ không phải lúc đọc mã đầu tiên.
  await mod.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? ZXING_READER_WASM_URL : prefix + path),
    },
    fireImmediately: true,
  });
  const detector = new mod.BarcodeDetector({ formats: [...SCAN_FORMATS] });
  return {
    info: { engine: "ponyfill" },
    detect: (image) => detector.detect(image) as unknown as Promise<DetectedLike[]>,
  };
}

/** Đổi kết quả về JSON thuần để gửi qua postMessage. */
export function plainCodes(detected: DetectedLike[] | null | undefined): ScannedCode[] {
  return (detected ?? []).map((d) => ({
    format: d.format,
    rawValue: d.rawValue,
    box: d.boundingBox
      ? {
          x: Math.round(d.boundingBox.x),
          y: Math.round(d.boundingBox.y),
          w: Math.round(d.boundingBox.width),
          h: Math.round(d.boundingBox.height),
        }
      : null,
    corners: Array.isArray(d.cornerPoints)
      ? d.cornerPoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
      : null,
  }));
}
