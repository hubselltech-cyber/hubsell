// ============================================================
// ĐƯỜNG GỬI MỘT CLIP LÊN KHO (R2) + phân loại lỗi. Tách khỏi session.ts ở lát M1 (18/11/2026).
//
// Trình duyệt tải THẲNG lên kho bằng đường dẫn ký sẵn; máy chủ Hubsell không chạm byte video nào:
//   1. POST /api/pack-videos   → dòng sổ PENDING + đường dẫn ký sẵn (ký cả cỡ và kiểu tệp)
//   2. PUT thẳng lên kho        (một lượt, hoặc theo mảnh với tệp lớn)
//   3. POST …/complete          → máy chủ tự hỏi kho cỡ thật rồi mới ghi STORED
// `clientId` giữ nguyên qua mọi lần thử lại — kể cả sau khi tải lại trang — nên không sinh dòng trùng (rào D1).
// Vé (đường dẫn ký sẵn) được xin NGAY TRƯỚC mỗi lượt gửi, không xin sẵn: hàng chờ dài mấy cũng không hết hạn vé (N7).
// ============================================================

import {
  ApiError,
  beginPackVideoUpload,
  completePackVideoUpload,
  signPackVideoParts,
  type PackVideoHoursBalance,
  type PackVideoKind,
  type PackVideoUploadPlan,
} from "@/lib/api";

import { ClipFileBroken } from "./clip-store";
import type { UploadVerdict } from "./upload-queue";

export interface UploadRequest {
  clientId: string;
  code: string;
  kind: PackVideoKind;
  startedAtIso: string;
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
  deviceName: string | null;
  /** Chỉ được gọi khi kho thật sự cần tệp (video đã lên từ lượt trước thì không đọc ổ). */
  blob(): Promise<Blob>;
  /** Tổng số byte kho đã nhận của clip này tính tới lúc gọi. */
  onProgress(sentBytes: number): void;
}

export class StorageError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Trả số giờ máy chủ gửi kèm (M2.2) — null khi máy chủ bản cũ chưa gửi. */
export async function uploadClip(req: UploadRequest): Promise<PackVideoHoursBalance | null> {
  const begun = await beginPackVideoUpload({
    clientId: req.clientId,
    trackingCode: req.code,
    kind: req.kind,
    recordedAt: req.startedAtIso,
    durationSec: Math.max(1, Math.round(req.durationSec)),
    sizeBytes: req.sizeBytes,
    width: req.width,
    height: req.height,
    deviceName: req.deviceName,
  });
  const plan = begun.upload;
  if (plan) await sendToStorage(req, begun.video.id, plan);
  const done = await completePackVideoUpload(begun.video.id);
  return done.hours ?? null;
}

async function sendToStorage(req: UploadRequest, videoId: string, plan: PackVideoUploadPlan): Promise<void> {
  const file = await req.blob();
  const total = file.size;
  if (total !== req.sizeBytes) throw new ClipFileBroken("Tệp chờ gửi không đúng cỡ đã ghi sổ");
  if (plan.mode === "single") {
    await putToStorage(plan.url, plan.headers, file, req.onProgress);
    return;
  }
  const held = new Set(plan.uploadedParts ?? []);
  const urlOf = new Map(plan.parts.map((p) => [p.partNumber, p.url]));
  const count = Math.ceil(total / plan.partSize);
  let sentBefore = 0;
  for (let n = 1; n <= count; n++) {
    const start = (n - 1) * plan.partSize;
    const end = Math.min(total, start + plan.partSize);
    if (!held.has(n)) {
      const body = file.slice(start, end);
      const base = sentBefore;
      const progress = (sent: number) => req.onProgress(base + sent);
      let url = urlOf.get(n) ?? (await signPackVideoParts(videoId, [n])).parts[0]?.url;
      if (!url) throw new Error("Máy chủ không cấp đường dẫn cho một mảnh của tệp");
      try {
        await putToStorage(url, {}, body, progress);
      } catch (err) {
        // Đường dẫn của mảnh hết hạn (403) → xin ký lại đúng một lần rồi gửi lại.
        if (!(err instanceof StorageError) || err.status !== 403) throw err;
        url = (await signPackVideoParts(videoId, [n])).parts[0]?.url;
        if (!url) throw err;
        await putToStorage(url, {}, body, progress);
      }
    }
    sentBefore = end;
    req.onProgress(sentBefore);
  }
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

/** Mã lỗi máy chủ mà thử lại là qua được (lượt tải theo mảnh hết hạn, kho chưa thấy tệp…). */
const RETRYABLE_CODES = new Set(["UPLOAD_EXPIRED", "NOT_UPLOADED", "PARTS_MISSING", "SIZE_MISMATCH"]);

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
      return { kind: "retry", text: `máy chủ Hubsell đang bận (mã ${err.status})` };
    }
    if (err.code && RETRYABLE_CODES.has(err.code)) return { kind: "retry", text: err.message };
    return { kind: "fatal", text: err.message };
  }
  return { kind: "retry", text: err instanceof Error ? err.message : String(err) };
}
