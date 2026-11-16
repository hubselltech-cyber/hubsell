// ============================================================
// LƯỢT QUAY: danh sách clip của lượt + HÀNG CHỜ TẢI LÊN kho (R2).
//
// Sống ở cấp module, không theo màn hình: người đóng hàng rời màn quay sang trang khác thì clip đang chờ
// vẫn tải tiếp, quay lại màn quay vẫn thấy lượt của mình. (Tải lại / đóng tab thì mất — màn quay hỏi trước.)
//
// Tải lên TUẦN TỰ và KHÔNG khóa việc quay (bài học Kiểm kê 09/11: không khóa ô quét khi đang xử lý).
// Trình duyệt tải THẲNG lên kho bằng đường dẫn ký sẵn; máy chủ Hubsell không chạm byte video nào:
//   1. POST /api/pack-videos   → dòng sổ PENDING + đường dẫn ký sẵn (ký cả cỡ và kiểu tệp)
//   2. PUT thẳng lên kho        (một lượt, hoặc theo mảnh với tệp lớn)
//   3. POST …/complete          → máy chủ tự hỏi kho cỡ thật rồi mới ghi STORED
// `clientId` giữ nguyên qua mọi lần thử lại nên mạng chập chờn không sinh dòng trùng (rào D1).
// ============================================================

import {
  ApiError,
  beginPackVideoUpload,
  completePackVideoUpload,
  matchPackVideoTem,
  signPackVideoParts,
  type PackVideoTemMatch,
  type PackVideoUploadPlan,
} from "@/lib/api";

import { addJournal } from "./journal";
import { playNotice } from "./sound";
import type { ClipKind, ClipOutcome, FinishedClip } from "./types";

export type SessionClipStatus = "recording" | "saving" | "queued" | "uploading" | "stored" | "failed";

export interface SessionClip {
  localId: string;
  code: string;
  manual: boolean;
  /**
   * Loại video: đóng hàng hay khui hàng hoàn. Đây là thứ phân biệt hai video CÙNG mã vận đơn (kiện hoàn về vẫn
   * dán tem cũ). Đổi được cho tới lúc clip bắt đầu tải lên — xem sessionRelabelRecording().
   */
  kind: ClipKind;
  /**
   * true = đang hỏi "Đơn này đang hoàn về. Chuyển sang quay khui hàng?" (clip ĐÓNG HÀNG mà tem thuộc đơn có hoàn).
   * Người dùng gạt đi thì không hỏi lại cho cùng tem trong lượt này.
   */
  returnPrompt: boolean;
  startedAtMs: number;
  durationSec: number | null;
  sizeBytes: number | null;
  status: SessionClipStatus;
  /** 0–1, chỉ có nghĩa khi đang tải lên. */
  progress: number;
  error: string | null;
  /** Đơn khớp với tem: undefined = chưa hỏi / đang hỏi, null = không khớp đơn nào. */
  order: PackVideoTemMatch | null | undefined;
}

interface Job {
  localId: string;
  clientId: string;
  clip: FinishedClip;
  deviceName: string | null;
}

/** Số lần thử một clip trước khi để người dùng tự bấm "Thử lại", và khoảng nghỉ giữa các lần. */
const UPLOAD_ATTEMPTS = 4;
const UPLOAD_BACKOFF_MS = [2_000, 5_000, 15_000];

let clips: SessionClip[] = [];
/** Tem đã được trả lời "Vẫn là đóng hàng" trong lượt này — bỏ qua là không hiện lại (anh Trung: gạt hộp nhắc = thôi hẳn). */
const returnPromptDismissed = new Set<string>();
const jobs = new Map<string, Job>();
const queue: string[] = [];
let pumping = false;
let deviceName: string | null = null;
const listeners = new Set<() => void>();
const storedListeners = new Set<() => void>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function update(localId: string, patch: Partial<SessionClip>): void {
  clips = clips.map((c) => (c.localId === localId ? { ...c, ...patch } : c));
  for (const fn of listeners) fn();
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Mảng mới mỗi lần đổi — dùng được với useSyncExternalStore. Clip mới nhất đứng đầu. */
export function getSessionClips(): SessionClip[] {
  return clips;
}

const EMPTY: SessionClip[] = [];
export function getServerSessionClips(): SessionClip[] {
  return EMPTY;
}

/** Gọi mỗi khi một video vừa lên kho xong (để màn hình làm mới danh sách video và số giờ). */
export function onClipStored(fn: () => void): () => void {
  storedListeners.add(fn);
  return () => storedListeners.delete(fn);
}

/** Còn clip nào chưa lên kho không (đang quay / đang ghép / đang chờ / đang tải / lỗi). */
export function hasUnsavedClips(): boolean {
  return clips.some((c) => c.status !== "stored");
}

export function setSessionDeviceName(label: string | null): void {
  deviceName = label;
}

/** Một clip vừa bắt đầu quay. */
export function sessionClipStarted(info: { code: string; manual: boolean; startedAtMs: number; kind: ClipKind }): void {
  // Clip trước đó (nếu còn "đang quay") vừa bị cắt → đang ghép tệp.
  clips = clips.map((c) => (c.status === "recording" ? { ...c, status: "saving" as const, returnPrompt: false } : c));
  const localId = newId();
  clips = [
    {
      localId,
      code: info.code,
      manual: info.manual,
      kind: info.kind,
      returnPrompt: false,
      startedAtMs: info.startedAtMs,
      durationSec: null,
      sizeBytes: null,
      status: "recording",
      progress: 0,
      error: null,
      order: info.manual ? null : undefined,
    },
    ...clips,
  ];
  for (const fn of listeners) fn();
  if (!info.manual) {
    matchPackVideoTem(info.code, info.kind).then(
      (res) => {
        update(localId, { order: res.order });
        maybeAskReturn(localId);
      },
      () => update(localId, { order: null })
    );
  }
}

/**
 * RÀO CHỐNG CHỌN NHẦM CHẾ ĐỘ (anh Trung 16/11/2026: "phải làm sao để khi quay video khui hàng không bị trùng mã
 * đơn hàng với video đóng hàng"): clip đang quay ở chế độ ĐÓNG HÀNG mà tem lại thuộc đơn có hoàn → nhiều khả
 * năng đây là kiện hoàn về. Hỏi (cảnh báo, không khóa) kèm một tiếng báo riêng; chỉ hỏi khi clip còn đang quay.
 */
function maybeAskReturn(localId: string): void {
  const clip = clips.find((c) => c.localId === localId);
  if (!clip || clip.status !== "recording" || clip.kind !== "PACK") return;
  if (!clip.order?.hasReturn || returnPromptDismissed.has(clip.code)) return;
  update(localId, { returnPrompt: true });
  playNotice();
  addJournal("warn", `Tem ${clip.code} thuộc đơn đang hoàn về — kiểm tra có phải đang khui hàng không`);
}

/** "Vẫn là đóng hàng": gạt câu hỏi, không hỏi lại cho cùng tem trong lượt này. */
export function dismissReturnPrompt(localId: string): void {
  const clip = clips.find((c) => c.localId === localId);
  if (!clip) return;
  returnPromptDismissed.add(clip.code);
  update(localId, { returnPrompt: false });
  addJournal("info", `Giữ clip ${clip.code} là video đóng hàng (đã bỏ qua cảnh báo đơn đang hoàn)`);
}

/** Bộ quay vừa đổi loại của clip ĐANG QUAY → ghi lại để lúc tải lên gửi đúng loại. */
export function sessionRelabelRecording(kind: ClipKind): void {
  const clip = clips.find((c) => c.status === "recording");
  if (!clip) return;
  update(clip.localId, { kind, returnPrompt: false });
}

/** Nút Dừng vừa được bấm: clip đang quay chuyển sang "đang ghép tệp". */
export function sessionClipStopping(): void {
  if (!clips.some((c) => c.status === "recording")) return;
  clips = clips.map((c) => (c.status === "recording" ? { ...c, status: "saving" as const, returnPrompt: false } : c));
  for (const fn of listeners) fn();
}

/** Đường quay vừa trả một clip (đã ghép xong tệp MP4, hoặc hỏng). */
export function sessionClipDone(outcome: ClipOutcome): void {
  const code = outcome.ok ? outcome.clip.code : outcome.code;
  // Clip cũ nhất còn chưa có tệp của đúng mã này.
  const target = [...clips].reverse().find((c) => c.code === code && (c.status === "recording" || c.status === "saving"));
  if (!target) return;
  if (!outcome.ok) {
    addJournal("error", `Clip ${code} hỏng: ${outcome.error}`);
    update(target.localId, { status: "failed", error: outcome.error });
    return;
  }
  const clip = outcome.clip;
  jobs.set(target.localId, { localId: target.localId, clientId: newId(), clip, deviceName });
  update(target.localId, {
    status: "queued",
    durationSec: clip.durationSec,
    sizeBytes: clip.buffer.byteLength,
    error: null,
  });
  addJournal("info", `Đã lưu clip ${kindTag(target.kind)}${code} (${formatSeconds(clip.durationSec)}) — chờ tải lên`);
  queue.push(target.localId);
  void pump();
}

/** Nút "Thử lại" trên một clip tải lỗi. */
export function retrySessionClip(localId: string): void {
  if (!jobs.has(localId) || queue.includes(localId)) return;
  update(localId, { status: "queued", error: null, progress: 0 });
  queue.push(localId);
  void pump();
}

/** Tiền tố "KHUI " trong nhật ký cho clip khui hàng — để đọc nhật ký là biết clip nào thuộc loại nào. */
function kindTag(kind: ClipKind): string {
  return kind === "UNBOX" ? "KHUI " : "";
}

/** Loại HIỆN TẠI của clip (có thể vừa được đổi theo cảnh báo đơn đang hoàn). */
function kindOf(localId: string): ClipKind {
  return clips.find((c) => c.localId === localId)?.kind ?? "PACK";
}

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let localId = queue.shift(); localId; localId = queue.shift()) {
      const job = jobs.get(localId);
      if (job) await runJob(job);
    }
  } finally {
    pumping = false;
  }
}

async function runJob(job: Job): Promise<void> {
  const code = job.clip.code;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    update(job.localId, { status: "uploading", progress: 0, error: null });
    try {
      await uploadOnce(job);
      jobs.delete(job.localId); // nhả bộ nhớ của tệp
      update(job.localId, { status: "stored", progress: 1, error: null });
      addJournal("info", `Tải lên xong clip ${kindTag(kindOf(job.localId))}${code}`);
      for (const fn of storedListeners) fn();
      return;
    } catch (err) {
      const text = uploadErrorText(err);
      const final = attempt >= UPLOAD_ATTEMPTS || !isRetryable(err);
      if (final) {
        update(job.localId, { status: "failed", error: text });
        addJournal("error", `Tải lên clip ${code} lỗi: ${text}`);
        return;
      }
      addJournal("warn", `Tải lên clip ${code} chưa được (lần ${attempt}): ${text} — sẽ thử lại`);
      update(job.localId, { status: "queued", error: text });
      await sleep(UPLOAD_BACKOFF_MS[Math.min(attempt - 1, UPLOAD_BACKOFF_MS.length - 1)]);
    }
  }
}

async function uploadOnce(job: Job): Promise<void> {
  const { clip } = job;
  const sizeBytes = clip.buffer.byteLength;
  const begun = await beginPackVideoUpload({
    clientId: job.clientId,
    trackingCode: clip.code,
    kind: kindOf(job.localId),
    recordedAt: clip.startedAt.toISOString(),
    durationSec: Math.max(1, Math.round(clip.durationSec)),
    sizeBytes,
    width: clip.width,
    height: clip.height,
    deviceName: job.deviceName,
  });
  const plan = begun.upload;
  if (plan) await sendToStorage(job, begun.video.id, plan);
  await completePackVideoUpload(begun.video.id);
}

async function sendToStorage(job: Job, videoId: string, plan: PackVideoUploadPlan): Promise<void> {
  const buffer = job.clip.buffer;
  const total = buffer.byteLength;
  if (plan.mode === "single") {
    await putToStorage(plan.url, plan.headers, new Blob([buffer]), (sent) =>
      update(job.localId, { progress: total ? sent / total : 0 })
    );
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
      const body = new Blob([buffer.slice(start, end)]);
      const base = sentBefore;
      const progress = (sent: number) => update(job.localId, { progress: (base + sent) / total });
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
    update(job.localId, { progress: sentBefore / total });
  }
}

class StorageError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
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

function isRetryable(err: unknown): boolean {
  if (err instanceof StorageError) return err.status === 0 || err.status >= 500 || err.status === 403;
  if (err instanceof ApiError) {
    // Lỗi mạng tới máy chủ, kho không phản hồi, lượt tải theo mảnh hết hạn → thử lại được.
    if (err.status === 0 || err.status >= 500) return true;
    return err.code === "UPLOAD_EXPIRED" || err.code === "NOT_UPLOADED" || err.code === "PARTS_MISSING" || err.code === "SIZE_MISMATCH";
  }
  return false;
}

/** Câu lỗi tải lên cho người đóng hàng. */
function uploadErrorText(err: unknown): string {
  if (err instanceof StorageError && err.status === 0) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "Mất mạng";
    return "Kho chưa cho trình duyệt tải lên — cần bật CORS cho bucket (hoặc mạng chập chờn)";
  }
  if (err instanceof ApiError && err.code === "FEATURE_LOCKED") return "Tài khoản chưa được mở Video đóng hàng";
  return err instanceof Error ? err.message : String(err);
}
