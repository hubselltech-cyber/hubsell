// ============================================================
// ĐƯỜNG GỬI MỘT CLIP LÊN KHO (R2) + phân loại lỗi. Tách khỏi session.ts ở lát M1 (18/11/2026).
//
// Trình duyệt tải THẲNG lên kho bằng đường dẫn ký sẵn; máy chủ Hubsell không chạm byte video nào:
//   1. POST /api/pack-videos   → dòng sổ PENDING + đường dẫn ký sẵn (ký cả cỡ và kiểu tệp)
//   2. PUT thẳng lên kho        (một lượt, hoặc theo mảnh với tệp lớn)
//   3. POST …/complete          → máy chủ tự hỏi kho cỡ thật rồi mới ghi STORED
// Máy chủ bật đường BẢN 2 (M2.4, 26/11/2026) thì bước 1 + 3 đi /api/pack-videos/v2 bằng VÉ TẢI — trình tự ở upload-flow.ts.
// `clientId` giữ nguyên qua mọi lần thử lại — kể cả sau khi tải lại trang — nên không sinh dòng trùng (rào D1).
// Vé (đường dẫn ký sẵn) được xin NGAY TRƯỚC mỗi lượt gửi, không xin sẵn: hàng chờ dài mấy cũng không hết hạn vé (N7).
// ============================================================

import {
  ApiError,
  beginPackVideoUpload,
  beginPackVideoUploadV2,
  completePackVideoUpload,
  completePackVideoUploadV2,
  packVideoUploadV2Enabled,
  signPackVideoParts,
  signPackVideoPartsV2,
  type PackVideoHoursBalance,
} from "@/lib/api";

import { ClipFileBroken } from "./clip-store";
import { StorageError, runUpload, type UploadApi, type UploadRequest } from "./upload-flow";
import type { UploadVerdict } from "./upload-queue";

export { StorageError, type UploadMemo, type UploadRequest } from "./upload-flow";

const API: UploadApi = {
  uploadV2Enabled: packVideoUploadV2Enabled,
  begin: beginPackVideoUpload,
  signParts: signPackVideoParts,
  complete: completePackVideoUpload,
  beginV2: beginPackVideoUploadV2,
  signPartsV2: signPackVideoPartsV2,
  completeV2: completePackVideoUploadV2,
};

/**
 * Gửi trọn một clip — trình tự (bản 1 / bản 2 "vé không ghi", M2.4) nằm ở upload-flow.ts.
 * Trả số giờ máy chủ gửi kèm (M2.2) — null khi máy chủ bản cũ chưa gửi.
 */
export function uploadClip(req: UploadRequest): Promise<PackVideoHoursBalance | null> {
  return runUpload(req, { api: API, put: putToStorage });
}

/** PUT thẳng lên kho bằng XMLHttpRequest để có tiến độ tải lên (fetch không báo tiến độ gửi). */
function putToStorage(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (sentBytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      // Trình duyệt tự đặt Content-Length (đúng cỡ đã ký); đặt tay là bị chặn.
      if (name.toLowerCase() !== "content-length") xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new StorageError(xhr.status, `Kho từ chối tệp (mã ${xhr.status})`));
    };
    // Không có mã trạng thái = trình duyệt chặn trước khi tới kho (CORS) hoặc mất mạng.
    xhr.onerror = () => reject(new StorageError(0, "không tới được kho"));
    xhr.ontimeout = () => reject(new StorageError(0, "quá thời gian chờ kho"));
    xhr.send(body);
  });
}

/** Mã lỗi máy chủ mà thử lại là qua được (lượt tải theo mảnh hết hạn, kho chưa thấy tệp, vé tải bản 2 hết dùng được…). */
const RETRYABLE_CODES = new Set(["UPLOAD_EXPIRED", "NOT_UPLOADED", "PARTS_MISSING", "SIZE_MISMATCH", "TICKET_INVALID"]);

/**
 * Lỗi này thử lại có qua được không + câu cho người đóng hàng đọc.
 * Nguyên tắc: KHÔNG chắc là vô ích thì cứ thử lại (video phải lên hệ thống); chỉ dừng với các ca biết chắc.
 */
export function classifyUploadError(err: unknown, online: boolean): UploadVerdict {
  if (err instanceof ClipFileBroken) return { kind: "fatal", text: err.message };
  if (err instanceof StorageError) {
    if (err.status === 0) {
      return {
        kind: "retry",
        // Gồm cả ca kho chưa bật CORS cho tên miền này (trình duyệt chặn trước khi tới kho) — người đóng hàng không
        // phân biệt được, câu ngắn là đủ; ca CORS chỉ gặp lúc cài đặt bucket (backend/scripts/pack-video-r2-cors.ts).
        text: online ? "chưa tới được kho video" : "mất mạng",
      };
    }
    // 403 = đường dẫn ký sẵn hết hạn giữa chừng; 408 / 429 / 5xx = kho bận.
    if (err.status === 403 || err.status === 408 || err.status === 429 || err.status >= 500) {
      return { kind: "retry", text: `kho video đang bận (mã ${err.status})` };
    }
    return { kind: "fatal", text: err.message };
  }
  if (err instanceof ApiError) {
    if (err.code === "FEATURE_LOCKED") return { kind: "fatal", text: "Tài khoản chưa được mở Video đóng hàng" };
    if (err.code === "OUT_OF_HOURS") return { kind: "fatal", text: "Đã hết giờ quay — mua thêm giờ rồi bấm Thử lại" };
    if (err.status === 401) return { kind: "fatal", text: "Phiên đăng nhập đã hết — đăng nhập lại rồi bấm Thử lại" };
    if (err.status === 0) return { kind: "retry", text: online ? "chưa tới được máy chủ Hubsell" : "mất mạng" };
    if (err.status === 408 || err.status === 429 || err.status >= 500) {
      // Máy chủ bảo chờ bao lâu (Retry-After) thì hàng chờ chờ ít nhất chừng đó (M2.6).
      return { kind: "retry", text: `máy chủ Hubsell đang bận (mã ${err.status})`, retryAfterMs: err.retryAfterMs ?? null };
    }
    if (err.code && RETRYABLE_CODES.has(err.code)) return { kind: "retry", text: err.message };
    return { kind: "fatal", text: err.message };
  }
  return { kind: "retry", text: err instanceof Error ? err.message : String(err) };
}
