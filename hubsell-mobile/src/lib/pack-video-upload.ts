// ============================================================
// HÀNG CHỜ TẢI VIDEO ĐÓNG GÓI LÊN HỆ THỐNG (app mobile) — dựng trên nhánh thử 18–24/11/2026, lên bản app thật 26/11/2026.
//
// Anh Trung 18/11/2026: "bỏ hẳn lưu local đi. bắt buộc phải lưu trên hệ thống hết kể cả quay bằng điện thoại hay
// webcam" → clip quay xong là vào hàng chờ, tải lên kho (R2) theo ĐÚNG đường của màn quay webcam trên web
// (frontend/src/lib/pack-video-recorder/session.ts), lên xong thì XÓA tệp trong máy. Tệp chỉ nằm trên máy trong lúc
// chờ / đang tải, không có lựa chọn "lưu trong máy".
//
//   1. xin đường dẫn ký sẵn (ký cả cỡ tệp)
//   2. PUT thẳng lên kho                 (một lượt; tệp > 32 MB thì theo mảnh 8 MiB)
//   3. báo xong → máy chủ hỏi kho cỡ thật rồi mới ghi sổ "đã lưu"
// Hai đường cùng ba bước đó (api/pack-video.ts):
//   · v1 — POST /api/pack-videos · /:id/parts · /:id/complete: máy chủ ghi dòng PENDING ngay bước 1;
//   · v2 (M2.4) — POST /api/pack-videos/v2 · /v2/parts · /v2/complete: bước 1 chỉ trả VÉ TẢI LÊN, máy chủ ghi sổ đúng
//     MỘT lần ở bước 3. App dùng v2 khi máy chủ báo đang mở (câu trả lời xin vé phiên quay); máy chủ tắt thì tự về v1.
//     Vé được giữ trong sổ hàng chờ trên máy: lần thử lại / lần mở app sau báo xong (hoặc gửi nốt mảnh) bằng vé cũ.
// `clientId` giữ nguyên qua mọi lần thử lại → mạng chập chờn không sinh video trùng (rào D1 phía máy chủ).
// Các lượt gọi máy chủ kèm VÉ PHIÊN QUAY (M2.1) và nghe `Retry-After` khi máy chủ bảo chờ (M2.6).
//
// Tải TUẦN TỰ, không khóa việc quay. iOS: phiên tải mặc định kiểu "background" của expo-file-system — app xuống nền
// vẫn tải tiếp.
//
// HÀNG CHỜ BỀN (anh Trung 20/11: "làm hàng chờ"): clip quay xong được DỜI vào thư mục hàng chờ của app
// (Documents/pack-video-queue — thư mục tạm của camera có thể bị máy dọn) kèm một tệp sổ nhỏ
// (`pack-video-queue-record.ts`). App bị tắt hẳn / máy hết pin giữa lúc chờ hay đang gửi → mở lại app là đọc sổ và gửi
// tiếp (`resumeUploads`, gọi từ `components/PackVideoQueueResume` ở gốc app — không cần mở lại màn quay). Lên xong thì
// xóa cả tệp clip lẫn tệp sổ. Clip gắn với TÀI KHOẢN đã quay: đổi tài khoản trên cùng máy thì clip nằm chờ.
// Mọi bước ghi sổ / dời tệp đều có đường lùi: không ghi được thì clip vẫn được gửi trong phiên này như trước.
// ============================================================

import { Directory, File, Paths, UploadType } from "expo-file-system";
import { ApiError } from "@/api/client";
import {
  beginUploadV1,
  beginUploadV2,
  completeUploadV1,
  completeUploadV2,
  noteUploadV2Off,
  signPartsV1,
  signPartsV2,
  uploadV2Enabled,
  type BeginPayload,
  type BeginResponse,
  type UploadPlan,
} from "@/api/pack-video";
import {
  QUEUE_DIR_NAME,
  clipFileName,
  decodeRecord,
  encodeRecord,
  recordFileName,
  recordsToResume,
  type QueueRecord,
} from "@/lib/pack-video-queue-record";

export type PackVideoKind = "PACK" | "UNBOX";
export type UploadStatus = "queued" | "uploading" | "stored" | "failed";

export interface UploadInput {
  localId: string;
  /** Đường dẫn tệp clip trên máy (có hoặc không có tiền tố file://). */
  path: string;
  trackingCode: string;
  kind: PackVideoKind;
  recordedAt: Date;
  durationSec: number;
  width: number | null;
  height: number | null;
  deviceName: string | null;
}

export interface UploadState {
  status: UploadStatus;
  /** 0–1. */
  progress: number;
  error: string | null;
}

type Plan = UploadPlan;
/** Xin ký (lại) các mảnh — đường v1 theo mã video, đường v2 theo vé. */
type SignParts = (partNumbers: number[]) => Promise<{ partNumber: number; url: string }[]>;

interface Job extends UploadInput {
  clientId: string;
  /** Tài khoản đã quay clip. */
  ownerId: string | null;
  /** Vé tải lên v2 đang giữ cho clip này (null = chưa xin / đi đường v1). */
  ticket: string | null;
  /** Cỡ mảnh của lượt tải theo mảnh gắn với vé (null = tải một lượt). */
  partSize: number | null;
  /** Dòng sổ trên máy của clip (null = không ghi được sổ → vé chỉ sống trong phiên này). */
  record: QueueRecord | null;
  /**
   * Lần gửi gần nhất hỏng vì lý do chờ cũng không tự hết (hết giờ quay, tài khoản chưa mở, chưa đăng nhập) → không
   * nằm trong nhịp tự thử lại; vẫn được gửi lại khi mở app / app trở lại màn hình / bấm "Gửi lại".
   */
  hold: boolean;
}

/** Số lần thử một clip trong MỘT lượt, và khoảng nghỉ — giống màn webcam. */
const UPLOAD_ATTEMPTS = 4;
const UPLOAD_BACKOFF_MS = [2_000, 5_000, 15_000];
/**
 * Hết lượt mà còn clip gửi chưa được (mất mạng lâu, máy vẫn để mở trên giá) → tự gửi lại sau ngần này. Số TỰ CHỌN:
 * đủ thưa để không dội máy chủ lúc mạng chập chờn, đủ gần để mạng về là video lên trong vòng một phút.
 */
const IDLE_RETRY_MS = 60_000;
/** Trần cho số giây máy chủ bảo chờ — không để một tiêu đề lạ treo hàng chờ cả giờ. Số TỰ CHỌN. */
const RETRY_AFTER_CAP_MS = 120_000;

const jobs = new Map<string, Job>();
const queue: string[] = [];
let pumping = false;
/** Clip đang được gửi (để không xếp nó vào hàng lần nữa). */
let active: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Tài khoản đang đăng nhập — `setUploadOwner`. */
let currentOwner: string | null = null;
let listener: ((localId: string, state: UploadState) => void) | null = null;
const countListeners = new Set<() => void>();
/** Số giờ máy chủ gửi kèm câu trả lời xin vé tải / báo xong (M2.2) — màn quay khỏi phải hỏi /hours sau mỗi clip. */
let hoursListener: ((hours: unknown) => void) | null = null;

export function setHoursListener(fn: ((hours: unknown) => void) | null): void {
  hoursListener = fn;
}

function emitHours(hours: unknown): void {
  if (hours != null) hoursListener?.(hours);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const toUri = (path: string) => (path.startsWith("file://") ? path : `file://${path}`);

function newClientId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Một màn đăng ký nhận trạng thái tải (chỉ màn quay nghe). */
export function setUploadListener(fn: ((localId: string, state: UploadState) => void) | null): void {
  listener = fn;
}

function emit(localId: string, state: UploadState): void {
  listener?.(localId, state);
}

/** Nghe số clip chưa lên hệ thống đổi (màn quay hiện "Chờ gửi: N"). Trả hàm gỡ. */
export function subscribeUploadCount(fn: () => void): () => void {
  countListeners.add(fn);
  return () => {
    countListeners.delete(fn);
  };
}

function notifyCount(): void {
  for (const fn of countListeners) fn();
}

// ── Sổ hàng chờ trên máy ────────────────────────────────────────────────────

/** Thư mục hàng chờ (tạo nếu chưa có). null = máy không cho ghi → hàng chờ chạy trong bộ nhớ như trước. */
function queueDir(): Directory | null {
  try {
    const dir = new Directory(Paths.document, QUEUE_DIR_NAME);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch {
    return null;
  }
}

/**
 * Ghi clip vào sổ hàng chờ: tệp sổ TRƯỚC, dời tệp clip SAU. App tắt giữa hai bước → sổ trỏ tới tệp chưa có, lần mở
 * sau thấy thiếu tệp thì bỏ dòng sổ đó; thứ tự ngược lại sẽ để lại tệp clip mồ côi không ai gửi.
 */
function persist(job: Job): void {
  const dir = queueDir();
  if (!dir) return;
  try {
    const record: QueueRecord = {
      v: 1,
      clientId: job.clientId,
      ownerId: job.ownerId,
      fileName: clipFileName(job.clientId),
      absPath: null,
      trackingCode: job.trackingCode,
      kind: job.kind,
      recordedAt: job.recordedAt.toISOString(),
      durationSec: job.durationSec,
      width: job.width,
      height: job.height,
      deviceName: job.deviceName,
      ticket: null,
      partSize: null,
    };
    const recordFile = new File(dir, recordFileName(job.clientId));
    recordFile.create({ overwrite: true });
    recordFile.write(encodeRecord(record));
    job.record = record;

    const source = new File(toUri(job.path));
    const target = new File(dir, clipFileName(job.clientId));
    let moved = false;
    try {
      source.moveSync(target);
      moved = target.exists;
    } catch {
      moved = false;
    }
    if (moved) {
      job.path = target.uri;
    } else {
      // Không dời được (khác ổ / máy không cho) → sổ ghi đường dẫn gốc, tệp ở yên chỗ cũ.
      job.record = { ...record, fileName: null, absPath: job.path };
      recordFile.write(encodeRecord(job.record));
    }
  } catch {
    // Không ghi được sổ: clip vẫn nằm trong hàng chờ của phiên này và được gửi như trước.
  }
}

/**
 * Giữ / bỏ vé tải lên của clip — cả trong bộ nhớ lẫn trong sổ trên máy. Không ghi được sổ thì vé vẫn dùng được trong
 * phiên này; lần mở app sau clip bắt đầu lại từ bước xin vé (không mất video).
 */
function keepTicket(job: Job, ticket: string | null, partSize: number | null): void {
  if (job.ticket === ticket && job.partSize === partSize) return;
  job.ticket = ticket;
  job.partSize = ticket ? partSize : null;
  if (!job.record) return;
  try {
    const dir = queueDir();
    if (!dir) return;
    job.record = { ...job.record, ticket: job.ticket, partSize: job.partSize };
    const recordFile = new File(dir, recordFileName(job.clientId));
    recordFile.create({ overwrite: true });
    recordFile.write(encodeRecord(job.record));
  } catch {
    // bỏ qua — xem chú thích hàm
  }
}

/** Clip đã lên hệ thống (hoặc tệp đã mất) → gỡ tệp clip + tệp sổ. */
function forget(job: Job): void {
  try {
    const clip = new File(toUri(job.path));
    if (clip.exists) clip.delete();
  } catch {
    // tệp đã mất / thư mục tạm bị dọn — không ảnh hưởng bản trên hệ thống
  }
  try {
    const dir = queueDir();
    const recordFile = dir ? new File(dir, recordFileName(job.clientId)) : null;
    if (recordFile?.exists) recordFile.delete();
  } catch {
    // còn sót tệp sổ: lần mở sau thấy thiếu tệp clip thì tự gỡ
  }
}

/** Đọc mọi tệp sổ trong thư mục hàng chờ. Tệp hỏng / ghi dở thì bỏ qua, không xóa. */
function readRecords(dir: Directory): QueueRecord[] {
  const out: QueueRecord[] = [];
  let entries: (Directory | File)[] = [];
  try {
    entries = dir.list();
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!(entry instanceof File) || !entry.name.endsWith(".json")) continue;
    try {
      const record = decodeRecord(entry.textSync());
      if (record) out.push(record);
    } catch {
      // không đọc được tệp này — bỏ qua
    }
  }
  return out;
}

// ── Hàng chờ ────────────────────────────────────────────────────────────────

/** Clip vừa quay xong → vào hàng chờ tải lên (ghi sổ trên máy rồi mới gửi). */
export function enqueueUpload(input: UploadInput): void {
  const job: Job = {
    ...input,
    clientId: newClientId(),
    ownerId: currentOwner,
    ticket: null,
    partSize: null,
    record: null,
    hold: false,
  };
  persist(job);
  jobs.set(job.localId, job);
  queue.push(job.localId);
  emit(job.localId, { status: "queued", progress: 0, error: null });
  notifyCount();
  void pump();
}

/** Nút "Thử lại" trên một clip tải lỗi (tệp vẫn còn trên máy). */
export function retryUpload(localId: string): void {
  const job = jobs.get(localId);
  if (!job || localId === active || queue.includes(localId)) return;
  job.hold = false;
  queue.push(localId);
  emit(localId, { status: "queued", progress: 0, error: null });
  void pump();
}

/** Số clip của tài khoản này chưa lên hệ thống (đang chờ / đang tải / lỗi). */
export function pendingUploadCount(): number {
  let n = 0;
  for (const job of jobs.values()) if (job.ownerId === currentOwner) n += 1;
  return n;
}

/**
 * GỬI TIẾP: nạp các clip còn trong sổ trên máy (của tài khoản đang đăng nhập) rồi xếp lại mọi clip chưa lên được.
 * Gọi khi: app mở lên và biết ai đăng nhập, app trở lại màn hình, bấm "Gửi lại", có giờ quay trở lại, và theo nhịp
 * `IDLE_RETRY_MS` khi còn clip gửi chưa được.
 */
export function resumeUploads(): void {
  requeueAll(true);
}

/**
 * `includeHeld` = gửi lại cả clip đang "giữ" (hết giờ quay, tài khoản chưa mở, chưa đăng nhập). Nhịp tự thử lại gọi
 * với false: các clip đó chờ thêm một phút cũng không tự hết, gửi lại mỗi phút chỉ dội máy chủ.
 */
function requeueAll(includeHeld: boolean): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const dir = queueDir();
  if (dir) {
    const loaded = new Set<string>();
    for (const job of jobs.values()) loaded.add(job.clientId);
    for (const record of recordsToResume(readRecords(dir), currentOwner, loaded)) {
      const path = record.fileName ? new File(dir, record.fileName).uri : (record.absPath ?? "");
      // Clip nạp lại không thuộc danh sách của màn quay đang mở → lấy luôn clientId làm mã trong hàng.
      jobs.set(record.clientId, {
        localId: record.clientId,
        path,
        trackingCode: record.trackingCode,
        kind: record.kind,
        recordedAt: new Date(record.recordedAt),
        durationSec: record.durationSec,
        width: record.width,
        height: record.height,
        deviceName: record.deviceName,
        clientId: record.clientId,
        ownerId: record.ownerId,
        ticket: record.ticket ?? null,
        partSize: record.partSize ?? null,
        record,
        hold: false,
      });
    }
  }
  for (const [localId, job] of jobs) {
    if (job.ownerId !== currentOwner || localId === active || queue.includes(localId)) continue;
    if (job.hold && !includeHeld) continue;
    job.hold = false;
    queue.push(localId);
    emit(localId, { status: "queued", progress: 0, error: null });
  }
  notifyCount();
  void pump();
}

/**
 * Ai đang đăng nhập (`components/PackVideoQueueResume` gọi mỗi khi phiên đăng nhập đổi). Đổi tài khoản → bỏ khỏi bộ
 * nhớ các clip của tài khoản trước (tệp + sổ vẫn nằm trên máy, đăng nhập lại tài khoản đó là gửi tiếp) rồi gửi tiếp
 * clip của tài khoản mới.
 */
export function setUploadOwner(ownerId: string | null): void {
  currentOwner = ownerId;
  for (const [localId, job] of jobs) {
    if (job.ownerId === ownerId || localId === active) continue;
    jobs.delete(localId);
    const at = queue.indexOf(localId);
    if (at >= 0) queue.splice(at, 1);
  }
  resumeUploads();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let localId = queue.shift(); localId; localId = queue.shift()) {
      const job = jobs.get(localId);
      if (!job || job.ownerId !== currentOwner) continue; // clip của tài khoản khác: nằm chờ
      active = localId;
      let offline = false;
      try {
        offline = (await runJob(job)) === "offline";
      } finally {
        active = null;
      }
      // Mất mạng: các clip còn lại cũng sẽ hỏng y như vậy → dừng lượt này, cả hàng chờ nhịp tự gửi lại (mỗi phút chỉ
      // một clip đi dò mạng, không phải cả trăm clip lần lượt thử 4 lần).
      if (offline) {
        queue.length = 0;
        break;
      }
    }
  } finally {
    pumping = false;
  }
  // Còn clip gửi chưa được mà chờ thì có thể được (mất mạng, kho lỗi) → hẹn tự gửi lại.
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  for (const job of jobs.values()) {
    if (job.ownerId === currentOwner && !job.hold) {
      retryTimer = setTimeout(() => requeueAll(false), IDLE_RETRY_MS);
      break;
    }
  }
}

/** "offline" = hết lượt thử mà vẫn không tới được máy chủ / kho (mất mạng). */
async function runJob(job: Job): Promise<"stored" | "failed" | "offline"> {
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    emit(job.localId, { status: "uploading", progress: 0, error: null });
    try {
      await uploadOnce(job);
      jobs.delete(job.localId);
      // Đã nằm trên hệ thống → bỏ bản trong máy + dòng sổ (anh Trung: không lưu local).
      forget(job);
      emit(job.localId, { status: "stored", progress: 1, error: null });
      notifyCount();
      return "stored";
    } catch (err) {
      const text = errorText(err);
      if (err instanceof UploadError && err.code === "LOCAL_MISSING") {
        // Tệp clip không còn trên máy → không còn gì để gửi: gỡ khỏi hàng + gỡ sổ, không thử lại.
        jobs.delete(job.localId);
        forget(job);
        emit(job.localId, { status: "failed", progress: 0, error: text });
        notifyCount();
        return "failed";
      }
      if (attempt >= UPLOAD_ATTEMPTS || !isRetryable(err)) {
        job.hold = !isRetryable(err);
        emit(job.localId, { status: "failed", progress: 0, error: text });
        return isNetworkDown(err) ? "offline" : "failed";
      }
      emit(job.localId, { status: "queued", progress: 0, error: `${text} — thử lại lần ${attempt + 1}` });
      // Máy chủ bảo chờ bao lâu (Retry-After của 429 / 503) thì chờ ít nhất chừng đó (M2.6).
      const asked = err instanceof ApiError && err.retryAfterMs ? Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS) : 0;
      await sleep(Math.max(asked, UPLOAD_BACKOFF_MS[Math.min(attempt - 1, UPLOAD_BACKOFF_MS.length - 1)]));
    }
  }
  return "failed";
}

async function uploadOnce(job: Job): Promise<void> {
  const file = new File(toUri(job.path));
  if (!file.exists) throw new UploadError("LOCAL_MISSING", "Tệp clip không còn trên máy");
  const sizeBytes = file.size;
  const progress = (sent: number) =>
    emit(job.localId, { status: "uploading", progress: sizeBytes ? sent / sizeBytes : 0, error: null });

  // ── Clip đang giữ VÉ từ lượt trước (đường v2): thường là tệp đã nằm trên kho, chỉ bước báo xong hỏng → báo lại
  //    trước, khỏi gửi lại byte nào. Kho chưa đủ tệp thì gửi nốt (theo mảnh) hoặc bắt đầu lại (một lượt).
  if (job.ticket) {
    const ticket = job.ticket;
    try {
      emitHours((await completeUploadV2(ticket)).hours);
      return;
    } catch (err) {
      const code = err instanceof ApiError ? apiCode(err) : undefined;
      if (code === "PARTS_MISSING" && job.partSize) {
        // Tải theo mảnh còn dở: hỏi kho đang giữ mảnh nào rồi gửi nốt bằng chính vé này.
        const first = await signPartsV2(ticket, [1]);
        await sendToStorage(
          file,
          sizeBytes,
          job.clientId,
          {
            mode: "multipart",
            partSize: job.partSize,
            parts: first.parts,
            uploadedParts: first.uploadedParts ?? [],
            expiresAt: "",
          },
          async (n) => (await signPartsV2(ticket, n)).parts,
          progress
        );
        emitHours((await completeUploadV2(ticket)).hours);
        return;
      }
      // Vé hết hạn / không còn hợp lệ, lượt tải theo mảnh bị kho hủy, hoặc kho chưa có tệp → bỏ vé, bắt đầu lại.
      if (code !== "TICKET_INVALID" && code !== "UPLOAD_EXPIRED" && code !== "NOT_UPLOADED" && code !== "PARTS_MISSING") {
        throw err;
      }
      keepTicket(job, null, null);
    }
  }

  const payload: BeginPayload = {
    clientId: job.clientId,
    trackingCode: job.trackingCode,
    kind: job.kind,
    recordedAt: job.recordedAt.toISOString(),
    durationSec: Math.max(1, Math.round(job.durationSec)),
    sizeBytes,
    width: job.width,
    height: job.height,
    deviceName: job.deviceName,
  };
  let begun: BeginResponse | null = null;
  if (await uploadV2Enabled()) {
    try {
      begun = await beginUploadV2(payload);
    } catch (err) {
      // Máy chủ vừa tắt đường v2 → clip này (và các clip sau) đi đường cũ.
      if (!(err instanceof ApiError) || apiCode(err) !== "V2_OFF") throw err;
      noteUploadV2Off();
    }
  }
  begun ??= await beginUploadV1(payload);
  emitHours(begun.hours);

  // Có vé = máy chủ CHƯA ghi sổ → giữ vé trên máy trước khi gửi byte nào (app tắt giữa chừng vẫn báo xong được).
  const ticket = typeof begun.ticket === "string" && begun.ticket ? begun.ticket : null;
  const videoId = begun.video.id;
  keepTicket(job, ticket, ticket && begun.upload?.mode === "multipart" ? begun.upload.partSize : null);

  const sign: SignParts = ticket
    ? async (n) => (await signPartsV2(ticket, n)).parts
    : async (n) => (await signPartsV1(videoId, n)).parts;
  if (begun.upload) await sendToStorage(file, sizeBytes, videoId, begun.upload, sign, progress);
  emitHours((ticket ? await completeUploadV2(ticket) : await completeUploadV1(videoId)).hours);
}

async function sendToStorage(
  file: File,
  total: number,
  /** Chỉ để đặt tên tệp mảnh tạm trên máy. */
  tag: string,
  plan: Plan,
  sign: SignParts,
  onProgress: (sentBytes: number) => void
): Promise<void> {
  if (plan.mode === "single") {
    await putFile(file, plan.url, plan.headers, onProgress);
    return;
  }
  const held = new Set(plan.uploadedParts ?? []);
  const urlOf = new Map(plan.parts.map((p) => [p.partNumber, p.url]));
  const count = Math.ceil(total / plan.partSize);
  for (let n = 1; n <= count; n++) {
    const start = (n - 1) * plan.partSize;
    const end = Math.min(total, start + plan.partSize);
    if (!held.has(n)) {
      // Mảnh = một tệp tạm đúng cỡ (đường dẫn ký sẵn của mảnh đã ký cỡ, gửi cỡ khác là kho từ chối).
      const part = new File(Paths.cache, `pv-${tag}-${n}.part`);
      const handle = file.open();
      try {
        handle.offset = start;
        part.create({ overwrite: true });
        part.write(handle.readBytes(end - start));
      } finally {
        handle.close();
      }
      try {
        let url = urlOf.get(n) ?? (await sign([n]))[0]?.url;
        if (!url) throw new Error("Máy chủ không cấp đường dẫn cho một mảnh của tệp");
        const base = start;
        try {
          await putFile(part, url, {}, (sent) => onProgress(base + sent));
        } catch (err) {
          // Đường dẫn mảnh hết hạn (403) → xin ký lại đúng một lần rồi gửi lại.
          if (!(err instanceof StorageError) || err.status !== 403) throw err;
          url = (await sign([n]))[0]?.url;
          if (!url) throw err;
          await putFile(part, url, {}, (sent) => onProgress(base + sent));
        }
      } finally {
        try {
          part.delete();
        } catch {
          // bỏ qua
        }
      }
    }
    onProgress(end);
  }
}

/** PUT nguyên tệp lên kho. Máy tự đặt Content-Length theo cỡ tệp (đúng cỡ đã ký). */
async function putFile(
  file: File,
  url: string,
  headers: Record<string, string>,
  onProgress: (sentBytes: number) => void
): Promise<void> {
  const clean = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-length"));
  let result;
  try {
    result = await file.upload(url, {
      httpMethod: "PUT",
      uploadType: UploadType.BINARY_CONTENT,
      headers: clean,
      onProgress: (p) => onProgress(p.bytesSent),
    });
  } catch (err) {
    throw new StorageError(0, `không tới được kho (${err instanceof Error ? err.message : String(err)})`);
  }
  if (result.status < 200 || result.status >= 300) {
    throw new StorageError(result.status, `Kho từ chối tệp (mã ${result.status})`);
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

class UploadError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function apiCode(err: ApiError): string | undefined {
  return (err.body as { code?: string } | null)?.code;
}

/** Không tới được máy chủ / kho (mã 0 = lỗi mạng, chưa có câu trả lời nào). */
function isNetworkDown(err: unknown): boolean {
  return (err instanceof StorageError || err instanceof ApiError) && err.status === 0;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof StorageError) return err.status === 0 || err.status >= 500 || err.status === 403;
  if (err instanceof ApiError) {
    // 429 = máy chủ bảo gọi dồn quá, chờ rồi thử lại là qua (M2.6).
    if (err.status === 0 || err.status >= 500 || err.status === 429) return true;
    const code = apiCode(err);
    return (
      code === "UPLOAD_EXPIRED" ||
      code === "NOT_UPLOADED" ||
      code === "PARTS_MISSING" ||
      code === "SIZE_MISMATCH" ||
      code === "TICKET_INVALID"
    );
  }
  return false;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const code = apiCode(err);
    if (code === "FEATURE_LOCKED") return "Tài khoản chưa được mở Video đóng hàng";
    if (code === "CONSENT_REQUIRED") return "Chủ shop chưa bật Video đóng hàng — video này chờ trên máy";
    if (code === "PERMISSION_DENIED") return "Tài khoản này không còn quyền quay kiểu video này";
    if (err.status === 429) return "Máy chủ đang bận — tự gửi lại sau ít giây";
    // Hết giờ quay (402): câu riêng của app, KHÔNG dùng câu của máy chủ ("mua thêm giờ…") — app iPhone không mời mua.
    // Tệp vẫn nằm trên máy; có giờ lại thì bấm "Thử lại" là lên.
    if (code === "OUT_OF_HOURS") return "Đã hết giờ quay — video này chưa lên hệ thống";
    if (err.status === 401) return "Chưa đăng nhập — đăng nhập app rồi quay lại";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
