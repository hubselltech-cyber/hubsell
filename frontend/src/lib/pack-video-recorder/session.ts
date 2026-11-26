// ============================================================
// LƯỢT QUAY: danh sách clip của lượt + HÀNG CHỜ TẢI LÊN kho (R2).
//
// Sống ở cấp module, không theo màn hình: người đóng hàng rời màn quay sang trang khác thì clip đang chờ
// vẫn tải tiếp, quay lại màn quay vẫn thấy lượt của mình.
//
// HÀNG CHỜ BỀN (lát M1, 18/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 18.4 + 21):
//   · clip ghi thẳng xuống ổ riêng của trang trong lúc quay (clip-store*.ts), sổ hàng chờ ở IndexedDB →
//     tải lại trang, Chrome sập, máy khởi động lại: mở lại màn Video là các clip chưa gửi tự gửi tiếp;
//   · gửi hỏng thì thử lại KHÔNG giới hạn, nghỉ tăng dần có lệch ngẫu nhiên; mất mạng thì đứng chờ, có mạng
//     lại là chạy ngay (upload-queue.ts, upload-backoff.ts);
//   · lên kho xong là XÓA tệp trên ổ. Không có nút xem / giữ video trên máy — đây không phải "lưu local".
//
// Tải lên TUẦN TỰ và KHÔNG khóa việc quay (bài học Kiểm kê 09/11: không khóa ô quét khi đang xử lý).
// Đường gửi (xin vé → PUT thẳng lên kho → chốt): upload-transport.ts.
// ============================================================

import { getStoredUser, matchPackVideoTem, type PackVideoHoursBalance, type PackVideoTemMatch } from "@/lib/api";

import {
  RECOVERY_HEAD_NAME,
  createPieceReader,
  findDataStart,
  fromBase64,
  isRecoveryIndexName,
  parseRecoveryHead,
  parseRecoveryIndex,
  planRecovery,
  remuxRecoveredClip,
  type RecoveryIndexFile,
  type RecoveryOwnerInfo,
} from "./clip-recovery";
import { ClipFileBroken, type StoredClipMeta } from "./clip-store";
import { WRITE_CHUNK_BYTES } from "./config";
import { openBrowserClipStore, withLock, type BrowserClipStore, type OrphanOutcome } from "./clip-store-opfs";
import { addJournal } from "./journal";
import { playAlarm, playNotice } from "./sound";
import type { ClipKind, ClipOutcome, ClipSinkLike } from "./types";
import { UploadQueue, type UploadJobEvent, type UploadQueueState } from "./upload-queue";
import { RecordRateMeter, UploadSpeedMeter, type DiskState, type QueueSnapshot } from "./upload-speed";
import { classifyUploadError, uploadClip } from "./upload-transport";

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
  /** true = clip quay từ lượt trước (trang đã tải lại / máy mở lại), lấy từ hàng chờ trên ổ. */
  restored: boolean;
  /** Đơn khớp với tem: undefined = chưa hỏi / đang hỏi, null = không khớp đơn nào. */
  order: PackVideoTemMatch | null | undefined;
}

interface Job {
  meta: StoredClipMeta;
  /** Dòng sổ đã nằm trong IndexedDB (clip sống qua tải lại trang). */
  persisted: boolean;
}

/** Ghi thử chừng này để biết ổ còn nhận nổi không — ≈ 10 phút quay của một bàn. Số tự chọn. */
const DISK_PROBE_BYTES = 64 * 1024 * 1024;
/** Khoảng cách tối thiểu giữa hai lần ghi thử (mỗi lần ghi thật 64 MB xuống ổ). Số tự chọn. */
const DISK_PROBE_EVERY_MS = 5 * 60_000;
/** Trình duyệt báo còn dưới mức này thì cảnh báo sớm (chỉ là gợi ý — Chrome báo dư, mục 18.9). Số tự chọn. */
const DISK_LOW_HINT_BYTES = 1024 * 1024 * 1024;

let clips: SessionClip[] = [];
/** Tem đã được trả lời "Vẫn là đóng hàng" trong lượt này — bỏ qua là không hiện lại (anh Trung: gạt hộp nhắc = thôi hẳn). */
const returnPromptDismissed = new Set<string>();
const jobs = new Map<string, Job>();
let deviceName: string | null = null;
const listeners = new Set<() => void>();
const storedListeners = new Set<(hours: PackVideoHoursBalance | null) => void>();
/** Số giờ máy chủ trả kèm lượt "báo tải xong" của từng clip (M2.2) — phát cho người nghe rồi bỏ. */
const hoursOfClip = new Map<string, PackVideoHoursBalance>();

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

/**
 * Gọi mỗi khi một video vừa lên kho xong (để màn hình làm mới danh sách video và số giờ). `hours` = số giờ máy chủ
 * gửi kèm câu trả lời; null khi không có (máy chủ bản cũ, clip do tab khác gửi) → người nghe tự hỏi máy chủ.
 */
export function onClipStored(fn: (hours: PackVideoHoursBalance | null) => void): () => void {
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

// ---------- Kho clip chờ gửi + tình trạng hàng chờ ----------

let storePromise: Promise<BrowserClipStore> | null = null;
let disk: DiskState = "ok";
let lastProbeAtMs = 0;
let resumedFor: string | null = null;
const speed = new UploadSpeedMeter();
const recordRate = new RecordRateMeter();
const sentSoFar = new Map<string, number>();
let queueState: UploadQueueState = { pending: 0, failures: 0, lastError: null, nextRetryAtMs: null, waitingOnline: false };
const queueListeners = new Set<() => void>();

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

function buildSnapshot(): QueueSnapshot {
  const waiting = clips.filter((c) => c.status === "queued" || c.status === "uploading");
  return {
    online: isOnline(),
    waiting: waiting.length,
    backlogBytes: waiting.reduce(
      (sum, c) => sum + (c.sizeBytes ?? 0) * (1 - (c.status === "uploading" ? c.progress : 0)),
      0
    ),
    failures: queueState.failures,
    lastError: queueState.lastError,
    nextRetryAtMs: queueState.nextRetryAtMs,
    uploadBytesPerSec: speed.bytesPerSecond(Date.now()),
    recordBytesPerSec: recordRate.bytesPerSecond(),
    disk,
  };
}

let snapshot: QueueSnapshot = buildSnapshot();

function emitQueue(): void {
  snapshot = buildSnapshot();
  for (const fn of queueListeners) fn();
}

export function subscribeQueue(fn: () => void): () => void {
  queueListeners.add(fn);
  return () => queueListeners.delete(fn);
}

/** Tình trạng hàng chờ (mạng, số clip chờ, ổ đĩa) cho dải báo trên màn quay. Đối tượng mới mỗi lần đổi. */
export function getQueueSnapshot(): QueueSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: QueueSnapshot = {
  online: true,
  waiting: 0,
  backlogBytes: 0,
  failures: 0,
  lastError: null,
  nextRetryAtMs: null,
  uploadBytesPerSec: null,
  recordBytesPerSec: null,
  disk: "ok",
};
export function getServerQueueSnapshot(): QueueSnapshot {
  return SERVER_SNAPSHOT;
}

function setDisk(next: DiskState): void {
  if (disk === next) return;
  disk = next;
  emitQueue();
}

/** Một lần ghi video THẬT xuống ổ vừa hỏng (ổ đầy). Clip đang quay vẫn quay nốt — phần còn lại nằm trong bộ nhớ. */
function onDiskSpill(err: unknown): void {
  if (disk === "full") return;
  const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  addJournal("error", `Ổ đĩa máy này không ghi được nữa (${why}) — video đang quay vẫn quay nốt, chưa mở được video mới`);
  playAlarm();
  setDisk("full");
}

/**
 * Sổ cứu clip (M1b) hỏi: clip đang quay có mã `code` thuộc tài khoản nào, loại gì. Chưa đăng nhập → null (không ghi
 * sổ cứu: không biết sau này gửi clip bằng tài khoản nào).
 */
function recoveryInfoFor(code: string): RecoveryOwnerInfo | null {
  const ownerKey = getStoredUser()?.id ?? "";
  if (!ownerKey) return null;
  // `clips` xếp mới nhất trước → dòng đầu khớp mã là clip đang quay hiện tại.
  const live = clips.find((c) => c.code === code && (c.status === "recording" || c.status === "saving"));
  return { ownerKey, deviceName, kind: live?.kind ?? "PACK" };
}

function ensureStore(): Promise<BrowserClipStore> {
  storePromise ??= openBrowserClipStore(onDiskSpill, recoveryInfoFor).then((opened) => {
    if (opened.memoryReason) {
      disk = "memory";
      addJournal(
        "warn",
        `Trình duyệt không cho giữ video chờ gửi trên ổ đĩa (${opened.memoryReason}) — video chờ gửi nằm trong bộ nhớ, đừng tải lại trang khi chưa gửi xong`
      );
      emitQueue();
    } else if (opened.persisted === false) {
      addJournal("info", "Trình duyệt chưa hứa giữ video chờ gửi khi ổ máy chật — nên để mạng luôn thông để video lên ngay");
    }
    return opened;
  });
  return storePromise;
}

/** Bộ quay xin chỗ ghi cho MỘT clip sắp quay. */
export async function openClipSink(): Promise<ClipSinkLike> {
  return (await ensureStore()).store.openSink();
}

/** Bộ quay bỏ một clip hỏng giữa chừng → dọn các mảnh đã ghi. */
export async function discardClipFile(fileKey: string): Promise<void> {
  await (await ensureStore()).store.remove({ fileKey });
}

/**
 * Lý do KHÔNG mở được video mới vì ổ đĩa, hoặc null. Chỉ chặn khi một lần ghi THẬT đã hỏng — hết chỗ thì quay
 * cũng không giữ được. Mạng chậm / mất mạng KHÔNG chặn (cảnh báo, không khóa).
 */
export function diskBlocker(): string | null {
  return disk === "full"
    ? "Ổ đĩa máy này đã đầy — chưa mở được video mới. Chờ video đang chờ gửi lên xong, hoặc dọn bớt ổ đĩa."
    : null;
}

/** Đo lại ổ bằng một lần ghi thử thật. `force` = bỏ qua khoảng nghỉ giữa hai lần ghi thử. */
async function checkDisk(force: boolean): Promise<void> {
  const opened = await ensureStore();
  if (opened.memoryReason) return;
  const now = Date.now();
  if (!force && now - lastProbeAtMs < DISK_PROBE_EVERY_MS) return;
  lastProbeAtMs = now;
  const wasFull = disk === "full";
  if (!(await opened.probe(DISK_PROBE_BYTES))) {
    if (!wasFull) {
      if (disk !== "low") addJournal("warn", "Ổ đĩa máy này sắp đầy — video chờ gửi có thể không còn chỗ giữ");
      setDisk("low");
    }
    return;
  }
  const free = await opened.reportedFreeBytes();
  const next: DiskState = free !== null && free < DISK_LOW_HINT_BYTES ? "low" : "ok";
  if (wasFull) addJournal("info", "Ổ đĩa đã có chỗ lại — mở video mới được rồi");
  setDisk(next);
}

const queue = new UploadQueue({
  upload: uploadJob,
  classify: (err) => classifyUploadError(err, isOnline()),
  isOnline,
  now: () => Date.now(),
  random: () => Math.random(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  onJob: onJobEvent,
  onQueue: (state) => {
    queueState = state;
    emitQueue();
  },
});

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (snapshot.waiting > 0) addJournal("info", "Có mạng lại — gửi tiếp video đang chờ");
    emitQueue();
    queue.kick();
  });
  window.addEventListener("offline", () => {
    addJournal("warn", "Mất mạng — video vẫn được giữ trên máy này, có mạng lại là tự gửi");
    emitQueue();
  });
}

/** Nút "Thử ngay" trên dải báo: bỏ khoảng nghỉ đang chờ; ổ đang báo đầy thì đo lại ổ luôn. */
export function retryQueueNow(): void {
  if (disk === "full" || disk === "low") void checkDisk(true);
  queue.kick();
}

/**
 * Mở lại hàng chờ của tài khoản đang đăng nhập: các clip quay từ lượt trước mà chưa lên kho được đưa lại vào
 * danh sách và gửi tiếp. Gọi khi màn Video mở; gọi nhiều lần không sao.
 */
export async function resumeUploadQueue(): Promise<void> {
  const owner = getStoredUser()?.id ?? null;
  if (!owner || resumedFor === owner) return;
  resumedFor = owner;
  const opened = await ensureStore();
  if (opened.memoryReason) return;
  const { mine, othersCount } = await opened.store.listMeta(owner);
  if (othersCount > 0) {
    addJournal("warn", `Máy này còn ${othersCount} video chờ gửi của tài khoản khác — đăng nhập lại tài khoản đó để gửi`);
  }
  const fresh = mine.filter((m) => !jobs.has(m.localId));
  for (const meta of fresh) {
    jobs.set(meta.localId, { meta, persisted: true });
    clips = [
      ...clips,
      {
        localId: meta.localId,
        code: meta.code,
        manual: meta.manual,
        kind: meta.kind,
        returnPrompt: false,
        startedAtMs: Date.parse(meta.startedAtIso),
        durationSec: meta.durationSec,
        sizeBytes: meta.file.sizeBytes,
        status: "queued",
        progress: 0,
        error: null,
        restored: true,
        order: meta.manual ? null : undefined,
      },
    ];
  }
  if (fresh.length) {
    addJournal("info", `Còn ${fresh.length} video quay từ lượt trước chưa lên hệ thống — đang gửi tiếp`);
    for (const fn of listeners) fn();
    emitQueue();
    for (const meta of fresh) queue.enqueue(meta.localId);
  }
  // Clip ĐANG QUAY DỞ lúc trang bị đóng / sập lần trước (M1b): ghép lại rồi đưa vào hàng chờ. Chạy SAU khi các clip
  // đã hoàn chỉnh vào hàng gửi và KHÔNG chặn chúng — ghép lại một clip dài mất vài giây.
  void opened
    .sweepOrphans(
      () => opened.store.knownFileKeys(),
      (fileKey) => rescueOrphan(opened, fileKey, owner)
    )
    .then(
      (tally) => {
        if (tally.keep > 0) {
          addJournal("warn", `Máy này còn ${tally.keep} video đang quay dở của tài khoản khác — đăng nhập lại tài khoản đó để cứu`);
        }
      },
      () => {}
    );
  void checkDisk(false);
}

/**
 * Xử lý MỘT thư mục clip không có dòng sổ hàng chờ (đang giữ khóa của thư mục — xem sweepOrphans):
 *   · không có `rec-head` → rác (clip đã gửi xong mà chưa kịp xóa tệp, hoặc bản cũ trước M1b) → dọn, không báo;
 *   · `rec-head` của tài khoản khác → để nguyên, tài khoản đó đăng nhập sẽ tự cứu;
 *   · còn lại → ghép các khung đã nằm trên ổ thành tệp MP4 mới, ghi sổ hàng chờ, đưa vào hàng gửi.
 * Mã chống gửi lặp (`clientId`) lấy theo TÊN THƯ MỤC gốc: lỡ trang sập giữa lúc đã ghi sổ mà chưa dọn thư mục gốc,
 * lần sau cứu lại vẫn ra đúng một video trên hệ thống.
 */
async function rescueOrphan(opened: BrowserClipStore, fileKey: string, owner: string): Promise<OrphanOutcome> {
  const { store } = opened;
  const names = await store.listFiles(fileKey);
  if (!names.includes(RECOVERY_HEAD_NAME)) return "garbage";
  const head = parseRecoveryHead(new TextDecoder().decode(await store.readFile(fileKey, RECOVERY_HEAD_NAME)));
  if (!head) return "garbage";
  if (head.ownerKey !== owner) return "keep";
  const label = head.manual ? "quay tay" : head.code;
  const sink = store.openSink({ recoverable: false });
  try {
    const indexes: RecoveryIndexFile[] = [];
    for (const name of names.filter(isRecoveryIndexName).sort()) {
      const index = parseRecoveryIndex(new TextDecoder().decode(await store.readFile(fileKey, name)));
      if (!index) break; // bản ghi sổ ghi dở lúc sập → dùng tới bản liền trước
      indexes.push(index);
    }
    if (!indexes.length) throw new Error("chưa kịp ghi phần nào xuống ổ (clip mới quay vài giây)");
    const first = await store.readFile(fileKey, indexes[0].piece.name);
    const dataStart = findDataStart(first, fromBase64(head.firstBytesB64));
    if (dataStart < 0) throw new Error("không tìm thấy khung hình đầu trong tệp dở");
    const plan = planRecovery(indexes, dataStart);
    const mb = await import("mediabunny");
    const recovered = await remuxRecoveredClip({
      mb,
      head,
      samples: plan.samples,
      read: createPieceReader(plan.pieces, (name) => store.readFile(fileKey, name)),
      sink,
      chunkBytes: WRITE_CHUNK_BYTES,
    });
    const meta: StoredClipMeta = {
      localId: fileKey,
      clientId: fileKey,
      ownerKey: head.ownerKey,
      code: head.code,
      manual: head.manual,
      kind: plan.kind ?? head.kind,
      startedAtIso: head.startedAtIso,
      durationSec: recovered.durationSec,
      width: head.width,
      height: head.height,
      deviceName: head.deviceName,
      queuedAtMs: Date.now(),
      file: recovered.file,
    };
    if (!(await store.saveMeta(meta))) throw new Error("không ghi được sổ hàng chờ");
    if (!jobs.has(meta.localId)) {
      jobs.set(meta.localId, { meta, persisted: true });
      clips = [
        ...clips,
        {
          localId: meta.localId,
          code: meta.code,
          manual: meta.manual,
          kind: meta.kind,
          returnPrompt: false,
          startedAtMs: Date.parse(meta.startedAtIso),
          durationSec: meta.durationSec,
          sizeBytes: meta.file.sizeBytes,
          status: "queued",
          progress: 0,
          error: null,
          restored: true,
          order: meta.manual ? null : undefined,
        },
      ];
      for (const fn of listeners) fn();
      queue.enqueue(meta.localId);
      emitQueue();
    }
    addJournal(
      "warn",
      `Cứu được video ${kindTag(meta.kind)}${label} đang quay dở lúc trang bị đóng lần trước (${formatSeconds(recovered.durationSec)}, thiếu vài giây cuối) — đang gửi`
    );
    return "recovered";
  } catch (err) {
    await store.remove({ fileKey: sink.fileKey });
    addJournal(
      "warn",
      `Video ${label} đang quay dở lúc trang bị đóng lần trước không cứu được: ${err instanceof Error ? err.message : String(err)} — đã dọn`
    );
    return "lost";
  }
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
      restored: false,
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

/** Các dòng "quay tay" đã bị một tem cắt ngang: tệp ghép xong thì BỎ, không vào hàng tải lên. */
const droppedLeadIns = new Set<string>();

/**
 * Tem vừa cắt ngang clip QUAY TAY đang quay → đánh dấu bỏ đoạn quay tay đó (anh Trung 18/11/2026: "không cần lưu và
 * đẩy đoạn quay tay đó lên" — nó làm rối danh sách và trừ giờ của khách). Gọi trước khi clip của tem được mở.
 */
export function sessionDropLeadIn(): void {
  const live = clips.find((c) => c.status === "recording" && c.manual);
  if (live) droppedLeadIns.add(live.localId);
}

/** Đường quay vừa trả một clip (đã ghép xong tệp MP4, hoặc hỏng). */
export function sessionClipDone(outcome: ClipOutcome): void {
  const code = outcome.ok ? outcome.clip.code : outcome.code;
  // Clip cũ nhất còn chưa có tệp của đúng mã này.
  const target = [...clips].reverse().find((c) => c.code === code && (c.status === "recording" || c.status === "saving"));
  if (!target) {
    // Không còn dòng nào nhận clip này (hiếm) → bỏ tệp để khỏi chiếm ổ.
    if (outcome.ok) void discardClipFile(outcome.clip.file.fileKey);
    return;
  }
  if (droppedLeadIns.delete(target.localId)) {
    // Đoạn quay tay bị tem cắt ngang: gỡ khỏi lượt quay, không lưu, không tải lên (nên không trừ giờ).
    if (outcome.ok) void discardClipFile(outcome.clip.file.fileKey);
    clips = clips.filter((c) => c.localId !== target.localId);
    for (const fn of listeners) fn();
    addJournal(
      "info",
      `Bỏ đoạn quay tay trước tem${outcome.ok ? ` (${formatSeconds(outcome.clip.durationSec)})` : ""} — không lưu, không tải lên`
    );
    return;
  }
  if (!outcome.ok) {
    addJournal("error", `Clip ${code} hỏng: ${outcome.error}`);
    update(target.localId, { status: "failed", error: outcome.error });
    return;
  }
  const clip = outcome.clip;
  const meta: StoredClipMeta = {
    localId: target.localId,
    clientId: newId(),
    ownerKey: getStoredUser()?.id ?? "",
    code: clip.code,
    manual: clip.manual,
    kind: target.kind,
    startedAtIso: clip.startedAt.toISOString(),
    durationSec: clip.durationSec,
    width: clip.width,
    height: clip.height,
    deviceName,
    queuedAtMs: Date.now(),
    file: clip.file,
  };
  const job: Job = { meta, persisted: false };
  jobs.set(target.localId, job);
  recordRate.addClip(clip.file.sizeBytes, clip.durationSec);
  update(target.localId, {
    status: "queued",
    durationSec: clip.durationSec,
    sizeBytes: clip.file.sizeBytes,
    error: null,
  });
  addJournal("info", `Đã lưu clip ${kindTag(target.kind)}${code} (${formatSeconds(clip.durationSec)}) — chờ tải lên`);
  // Ghi sổ TRƯỚC khi cho vào hàng gửi: gửi xong là xóa sổ, không được để lệnh ghi sổ tới sau lệnh xóa.
  void (async () => {
    const opened = await ensureStore();
    job.persisted = meta.ownerKey ? await opened.store.saveMeta(meta) : false;
    if (!job.persisted && !opened.memoryReason) {
      addJournal("warn", `Clip ${code} đang giữ trong bộ nhớ (chưa ghi được xuống ổ) — đừng tải lại trang tới khi gửi xong`);
    }
    queue.enqueue(target.localId);
    emitQueue();
    void checkDisk(false);
  })();
}

/** Nút "Thử lại" trên một clip tải lỗi. */
export function retrySessionClip(localId: string): void {
  if (!jobs.has(localId) || queue.has(localId)) return;
  update(localId, { status: "queued", error: null, progress: 0 });
  queue.enqueue(localId);
  queue.kick();
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

/** Gửi trọn một clip. Khóa theo clip: hai tab cùng mở không gửi trùng một clip. */
async function uploadJob(localId: string): Promise<void> {
  const job = jobs.get(localId);
  if (!job) return;
  const opened = await ensureStore();
  await withLock(`up-${localId}`, async () => {
    // Dòng sổ đã mất = tab khác vừa gửi xong clip này trong lúc mình chờ khóa.
    if (job.persisted && !(await opened.store.hasMeta(localId))) return;
    const { meta } = job;
    sentSoFar.set(localId, 0);
    const hours = await uploadClip({
      clientId: meta.clientId,
      code: meta.code,
      kind: kindOf(localId),
      startedAtIso: meta.startedAtIso,
      durationSec: meta.durationSec,
      sizeBytes: meta.file.sizeBytes,
      width: meta.width,
      height: meta.height,
      deviceName: meta.deviceName,
      blob: () => opened.store.blobOf(meta.file),
      onProgress: (sent) => onUploadProgress(localId, sent, meta.file.sizeBytes),
    });
    if (hours) hoursOfClip.set(localId, hours);
    // Xóa SỔ trước, TỆP sau: đứt giữa chừng thì còn lại một thư mục không có sổ = rác, lần sau tự dọn.
    await opened.store.deleteMeta(localId);
    await opened.store.remove(meta.file);
  });
}

let lastProgressEmitMs = 0;
function onUploadProgress(localId: string, sent: number, total: number): void {
  const now = Date.now();
  const before = sentSoFar.get(localId) ?? 0;
  if (sent > before) {
    speed.add(sent - before, now);
    sentSoFar.set(localId, sent);
  }
  update(localId, { progress: total ? Math.min(1, sent / total) : 0 });
  if (now - lastProgressEmitMs >= 1000) {
    lastProgressEmitMs = now;
    emitQueue();
  }
}

function onJobEvent(localId: string, event: UploadJobEvent): void {
  const job = jobs.get(localId);
  const code = job?.meta.code ?? "";
  switch (event.type) {
    case "uploading":
      update(localId, { status: "uploading", progress: 0, error: null });
      break;
    case "stored":
      jobs.delete(localId);
      sentSoFar.delete(localId);
      update(localId, { status: "stored", progress: 1, error: null });
      addJournal("info", `Tải lên xong clip ${kindTag(kindOf(localId))}${code}`);
      {
        const hours = hoursOfClip.get(localId) ?? null;
        hoursOfClip.delete(localId);
        for (const fn of storedListeners) fn(hours);
      }
      // Ổ vừa trống thêm → nếu đang báo đầy / sắp đầy thì đo lại ngay.
      if (disk === "full" || disk === "low") void checkDisk(true);
      break;
    case "retry":
      update(localId, { status: "queued", progress: 0, error: event.text });
      addJournal(
        "warn",
        `Tải lên clip ${code} chưa được (lần ${event.attempt}): ${event.text} — tự thử lại sau ${Math.ceil(event.waitMs / 1000)} giây`
      );
      break;
    case "failed":
      update(localId, { status: "failed", error: event.text });
      addJournal("error", `Tải lên clip ${code} dừng: ${event.text}`);
      void dropIfBroken(localId);
      break;
  }
  emitQueue();
}

/** Tệp chờ gửi đã mất khỏi ổ (người dùng xóa dữ liệu trình duyệt…) → không còn gì để gửi, bỏ dòng sổ cho khỏi báo lỗi mãi. */
async function dropIfBroken(localId: string): Promise<void> {
  const job = jobs.get(localId);
  if (!job) return;
  const opened = await ensureStore();
  try {
    await opened.store.blobOf(job.meta.file);
  } catch (err) {
    if (!(err instanceof ClipFileBroken)) return;
    jobs.delete(localId);
    playNotice();
    await opened.store.deleteMeta(localId);
    await opened.store.remove(job.meta.file);
  }
}
