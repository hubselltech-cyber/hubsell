// ============================================================
// TRÌNH TỰ GỬI MỘT CLIP — hàm thuần, mọi lệnh gọi máy chủ / kho đi qua `deps` để test được không cần trình duyệt.
// upload-transport.ts nối hàm này với lib/api.ts + XMLHttpRequest.
//
// Hai đường (máy chủ quyết qua `uploadV2` trong câu trả lời của POST /api/pack-videos/session):
//   BẢN 1 — POST /api/pack-videos → PUT thẳng lên kho → POST …/:id/complete (máy chủ ghi sổ ngay lúc bắt đầu).
//   BẢN 2 (M2.4, 26/11/2026) — POST …/v2 → máy chủ KHÔNG ghi sổ, trả VÉ TẢI → PUT lên kho → POST …/v2/complete { ticket }.
//     · Vé giữ cùng việc gửi của clip trong bộ nhớ (`memo`): lần thử lại dùng lại vé — tải theo mảnh thì xin ký lại bằng
//       vé và chỉ gửi mảnh kho chưa có; tệp đã lên kho mà bước báo xong hỏng thì chỉ báo xong lại, không gửi lại tệp.
//     · 409 V2_OFF (máy chủ vừa tắt bản 2) → clip này đi đường bản 1.
//     · 409 TICKET_INVALID → bỏ vé, bắt đầu lại ngay (cùng clientId). UPLOAD_EXPIRED → bỏ vé, hàng chờ thử lại sau.
//     · Máy chủ trả `ticket: null` = clip này đã có dòng sổ (mở bằng bản 1 từ trước) → đi tiếp đường bản 1 theo id.
// `clientId` giữ nguyên qua mọi lần thử lại — kể cả sau khi tải lại trang — nên không sinh dòng trùng (rào D1).
// ============================================================

import type {
  PackVideoBeginPayload,
  PackVideoBeginResponse,
  PackVideoBeginV2Response,
  PackVideoHoursBalance,
  PackVideoKind,
  PackVideoSignedPart,
  PackVideoUploadPlan,
} from "@/lib/api";

import { ClipFileBroken } from "./clip-store";

/** Vé tải bản 2 của MỘT clip, sống trong bộ nhớ cùng việc gửi (mất khi tải lại trang — khi đó bắt đầu lại là đủ). */
export interface UploadMemo {
  v2?: {
    ticket: string;
    plan: PackVideoUploadPlan | null;
    /** Tệp đã lên kho trọn vẹn ở một lần thử trước — lần này chỉ cần báo xong. */
    sent: boolean;
  } | null;
}

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
  /** Chỗ giữ vé tải giữa các lần thử của cùng một clip. Bỏ trống = mỗi lần thử xin vé mới. */
  memo?: UploadMemo;
}

export class StorageError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type SignedParts = { parts: PackVideoSignedPart[] };
type Completed = { hours?: PackVideoHoursBalance };

export interface UploadApi {
  /** Câu trả lời MỚI NHẤT của /session có bảo dùng đường bản 2 không. */
  uploadV2Enabled(): Promise<boolean>;
  begin(payload: PackVideoBeginPayload): Promise<PackVideoBeginResponse>;
  signParts(videoId: string, partNumbers: number[]): Promise<SignedParts>;
  complete(videoId: string): Promise<Completed>;
  beginV2(payload: PackVideoBeginPayload): Promise<PackVideoBeginV2Response>;
  signPartsV2(
    ticket: string,
    partNumbers: number[]
  ): Promise<SignedParts & { uploadedParts: number[]; expiresAt: string }>;
  completeV2(ticket: string): Promise<Completed>;
}

export type PutToStorage = (
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (sentBytes: number) => void
) => Promise<void>;

export interface UploadFlowDeps {
  api: UploadApi;
  put: PutToStorage;
}

/** Mỗi lượt xin ký tối đa ngần này mảnh — cùng trần với máy chủ (PACK_VIDEO_MAX_PARTS_PER_REQUEST). */
const MAX_PARTS_PER_REQUEST = 50;

/** Mã lỗi nghiệp vụ của máy chủ (ApiError.code) — đọc kiểu vịt để tệp này không kéo theo lib/api.ts. */
function codeOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/** Trả số giờ máy chủ gửi kèm (M2.2) — null khi máy chủ bản cũ chưa gửi. */
export async function runUpload(req: UploadRequest, deps: UploadFlowDeps): Promise<PackVideoHoursBalance | null> {
  const payload: PackVideoBeginPayload = {
    clientId: req.clientId,
    trackingCode: req.code,
    kind: req.kind,
    recordedAt: req.startedAtIso,
    durationSec: Math.max(1, Math.round(req.durationSec)),
    sizeBytes: req.sizeBytes,
    width: req.width,
    height: req.height,
    deviceName: req.deviceName,
  };
  const memo: UploadMemo = req.memo ?? {};
  // Đang giữ vé thì đi tiếp bản 2 dù máy chủ vừa tắt công tắc (vé đã cấp vẫn báo xong được).
  if (!memo.v2 && !(await deps.api.uploadV2Enabled())) return uploadV1(req, payload, deps);

  for (let round = 0; ; round++) {
    try {
      return await uploadV2(req, payload, memo, deps);
    } catch (err) {
      const code = codeOf(err);
      if (code === "V2_OFF") {
        memo.v2 = null;
        return uploadV1(req, payload, deps);
      }
      if (code === "TICKET_INVALID" || code === "UPLOAD_EXPIRED") memo.v2 = null;
      // Vé hỏng → bắt đầu lại NGAY một lần; vẫn hỏng thì để hàng chờ thử lại sau.
      if (code === "TICKET_INVALID" && round === 0) continue;
      throw err;
    }
  }
}

async function uploadV1(
  req: UploadRequest,
  payload: PackVideoBeginPayload,
  deps: UploadFlowDeps
): Promise<PackVideoHoursBalance | null> {
  return finishV1(req, await deps.api.begin(payload), deps);
}

async function finishV1(
  req: UploadRequest,
  begun: PackVideoBeginResponse,
  deps: UploadFlowDeps
): Promise<PackVideoHoursBalance | null> {
  const id = begun.video.id;
  if (begun.upload) await sendToStorage(req, begun.upload, (n) => deps.api.signParts(id, n), deps.put);
  return (await deps.api.complete(id)).hours ?? null;
}

async function uploadV2(
  req: UploadRequest,
  payload: PackVideoBeginPayload,
  memo: UploadMemo,
  deps: UploadFlowDeps
): Promise<PackVideoHoursBalance | null> {
  let held = memo.v2 ?? null;

  if (held && !held.sent) {
    if (held.plan?.mode === "multipart") {
      // Thử lại một lượt tải theo mảnh: xin ký lại bằng vé + hỏi kho đang giữ mảnh nào (không mở lượt tải mới).
      const { ticket, plan } = held;
      const count = Math.ceil(req.sizeBytes / plan.partSize);
      const all = Array.from({ length: Math.min(count, MAX_PARTS_PER_REQUEST) }, (_, i) => i + 1);
      const fresh = await deps.api.signPartsV2(ticket, all);
      held.plan = {
        mode: "multipart",
        partSize: plan.partSize,
        parts: fresh.parts,
        uploadedParts: fresh.uploadedParts,
        expiresAt: fresh.expiresAt,
      };
    } else {
      // Tải một lượt: đường dẫn ký sẵn có hạn ngắn → xin vé mới (cùng clientId ra cùng đường dẫn tệp, máy chủ không ghi gì).
      held = memo.v2 = null;
    }
  }

  if (!held) {
    const begun = await deps.api.beginV2(payload);
    // Không có vé = clip này đã có dòng sổ → đi tiếp đường bản 1 theo id (đã lưu rồi thì chỉ còn bước báo xong).
    if (!begun.ticket) return finishV1(req, begun, deps);
    held = memo.v2 = { ticket: begun.ticket, plan: begun.upload, sent: begun.upload === null };
  }

  const { ticket } = held;
  if (!held.sent && held.plan) {
    await sendToStorage(req, held.plan, (n) => deps.api.signPartsV2(ticket, n), deps.put);
    held.sent = true;
  }
  try {
    const done = await deps.api.completeV2(ticket);
    memo.v2 = null;
    return done.hours ?? null;
  } catch (err) {
    // Máy chủ bảo kho chưa có đủ tệp (hoặc vừa xóa tệp lệch cỡ) → lần thử sau phải gửi lại.
    const code = codeOf(err);
    if (code === "NOT_UPLOADED" || code === "PARTS_MISSING" || code === "SIZE_MISMATCH") held.sent = false;
    throw err;
  }
}

async function sendToStorage(
  req: UploadRequest,
  plan: PackVideoUploadPlan,
  sign: (partNumbers: number[]) => Promise<SignedParts>,
  put: PutToStorage
): Promise<void> {
  const file = await req.blob();
  const total = file.size;
  if (total !== req.sizeBytes) throw new ClipFileBroken("Tệp chờ gửi không đúng cỡ đã ghi sổ");
  if (plan.mode === "single") {
    await put(plan.url, plan.headers, file, req.onProgress);
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
      let url = urlOf.get(n) ?? (await sign([n])).parts[0]?.url;
      if (!url) throw new Error("Máy chủ không cấp đường dẫn cho một mảnh của tệp");
      try {
        await put(url, {}, body, progress);
      } catch (err) {
        // Đường dẫn của mảnh hết hạn (403) → xin ký lại đúng một lần rồi gửi lại.
        if (!(err instanceof StorageError) || err.status !== 403) throw err;
        url = (await sign([n])).parts[0]?.url;
        if (!url) throw err;
        await put(url, {}, body, progress);
      }
    }
    sentBefore = end;
    req.onProgress(sentBefore);
  }
}
