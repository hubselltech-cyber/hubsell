// ============================================================
// CỨU CLIP ĐANG QUAY DỞ (lát M1b, 19/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 18.10 C3 + mục 24).
//
// Lỗ còn lại của hàng chờ bền M1: tệp MP4 viết `moov` ở CUỐI, nên clip ĐANG quay lúc trang sập / bị đóng / máy
// mất điện chỉ là một dãy mảnh không phát được → trước đây bị dọn bỏ. Đơn đóng 15 phút mà Chrome sập ở phút 14
// là mất cả 14 phút.
//
// Cách cứu: trong lúc quay, cạnh các mảnh video ghi thêm một SỔ KHUNG HÌNH nhỏ:
//   · `rec-head`     — một lần lúc clip mở: mã tem, tài khoản, khổ hình, cấu hình giải mã, vài byte đầu của khung đầu;
//   · `rec-000001…`  — sau MỖI mảnh video nằm chắc trên ổ: mảnh đó ở đâu + cỡ / mốc giờ của các khung vừa quay.
// Mở lại trang thấy thư mục clip không có dòng sổ hàng chờ nhưng có `rec-head` → đọc lại các khung nằm trọn trong
// phần đã ghi xuống ổ, ghép thành một tệp MP4 MỚI hoàn chỉnh rồi đưa vào hàng chờ gửi như clip thường.
//
// Mất gì: phần đang nằm trong bộ nhớ lúc sập — tối đa một mảnh (1 MiB ≈ 8–10 giây cuối ở 800 kbps).
//
// KHÔNG tin cách bộ ghép MP4 xếp byte: chỗ bắt đầu dữ liệu khung hình được TÌM bằng vài byte đầu của khung đầu
// (không đoán cỡ phần đầu tệp), và TỪNG khung được soát cấu trúc H.264 trước khi dùng; lệch là dừng ở đó.
//
// Tệp này: phần THUẦN (đọc / ghi sổ, dựng kế hoạch) + hàm ghép lại nhận mọi thứ chạm trình duyệt qua tham số.
// ============================================================

import type * as Mediabunny from "mediabunny";

import { planOverlay } from "./byte-overlay";
import type { ClipFile, ClipKind, ClipSinkLike, RecoveryHead } from "./types";

export const RECOVERY_HEAD_NAME = "rec-head";
const INDEX_PREFIX = "rec-";

export const recoveryIndexName = (n: number) => `${INDEX_PREFIX}${String(n).padStart(6, "0")}`;
export const isRecoveryIndexName = (name: string) => /^rec-\d{6}$/.test(name);

/** Clip cứu được ngắn hơn mức này thì bỏ (chưa kịp có gì để làm bằng chứng). Số tự chọn. */
export const MIN_RECOVERED_SECONDS = 1;
/** Chỉ tìm chỗ bắt đầu dữ liệu trong ngần này byte đầu tệp (phần đầu tệp MP4 chỉ vài chục byte). */
const DATA_START_SEARCH_BYTES = 4096;

/** Thông tin của tài khoản / lượt quay mà đường quay không biết — sổ hàng chờ cần để gửi lại clip. */
export interface RecoveryOwnerInfo {
  ownerKey: string;
  deviceName: string | null;
  kind: ClipKind;
}

/** Nội dung tệp `rec-head`. */
export interface RecoveryHeadFile {
  v: 1;
  ownerKey: string;
  deviceName: string | null;
  kind: ClipKind;
  code: string;
  manual: boolean;
  startedAtIso: string;
  width: number;
  height: number;
  codec: string;
  descriptionB64: string | null;
  firstBytesB64: string;
}

/** [cỡ byte, mốc giờ µs tính từ đầu clip, độ dài µs, 1 = khung khóa]. */
export type RecoverySample = [number, number, number, 0 | 1];

/** Nội dung một tệp `rec-NNNNNN`: mảnh video vừa nằm chắc trên ổ + các khung quay từ lần ghi sổ trước. */
export interface RecoveryIndexFile {
  v: 1;
  /** Loại video LÚC ghi (có thể vừa được đổi theo rào "đơn này đang hoàn về") — bản ghi sau cùng thắng. */
  kind: ClipKind;
  piece: { name: string; position: number; length: number };
  samples: RecoverySample[];
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();

export function encodeRecoveryHead(head: RecoveryHead, info: RecoveryOwnerInfo): Uint8Array {
  const file: RecoveryHeadFile = {
    v: 1,
    ownerKey: info.ownerKey,
    deviceName: info.deviceName,
    kind: info.kind,
    code: head.code,
    manual: head.manual,
    startedAtIso: head.startedAtIso,
    width: head.width,
    height: head.height,
    codec: head.codec,
    descriptionB64: head.description ? toBase64(head.description) : null,
    firstBytesB64: toBase64(head.firstBytes),
  };
  return encoder.encode(JSON.stringify(file));
}

export function encodeRecoveryIndex(index: RecoveryIndexFile): Uint8Array {
  return encoder.encode(JSON.stringify(index));
}

const isKind = (v: unknown): v is ClipKind => v === "PACK" || v === "UNBOX";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Đọc `rec-head`; null nếu tệp hỏng / thiếu trường (ghi dở lúc sập) — khi đó không cứu. */
export function parseRecoveryHead(text: string): RecoveryHeadFile | null {
  try {
    const v = JSON.parse(text) as Partial<RecoveryHeadFile> | null;
    if (!v || v.v !== 1) return null;
    if (typeof v.ownerKey !== "string" || !v.ownerKey || typeof v.code !== "string" || !v.code) return null;
    if (!isKind(v.kind) || typeof v.manual !== "boolean" || typeof v.codec !== "string" || !v.codec) return null;
    if (typeof v.startedAtIso !== "string" || Number.isNaN(Date.parse(v.startedAtIso))) return null;
    if (!isCount(v.width) || !isCount(v.height) || !v.width || !v.height) return null;
    if (typeof v.firstBytesB64 !== "string" || !v.firstBytesB64) return null;
    return {
      v: 1,
      ownerKey: v.ownerKey,
      deviceName: typeof v.deviceName === "string" ? v.deviceName : null,
      kind: v.kind,
      code: v.code,
      manual: v.manual,
      startedAtIso: v.startedAtIso,
      width: v.width,
      height: v.height,
      codec: v.codec,
      descriptionB64: typeof v.descriptionB64 === "string" ? v.descriptionB64 : null,
      firstBytesB64: v.firstBytesB64,
    };
  } catch {
    return null;
  }
}

/** Đọc một tệp `rec-NNNNNN`; null nếu hỏng (bản ghi cuối có thể đang ghi dở lúc sập → bỏ qua, không sao). */
export function parseRecoveryIndex(text: string): RecoveryIndexFile | null {
  try {
    const v = JSON.parse(text) as Partial<RecoveryIndexFile> | null;
    if (!v || v.v !== 1 || !isKind(v.kind) || !v.piece || !Array.isArray(v.samples)) return null;
    const { name, position, length } = v.piece;
    if (typeof name !== "string" || !isCount(position) || !isCount(length) || !length) return null;
    const samples: RecoverySample[] = [];
    for (const s of v.samples) {
      if (!Array.isArray(s) || s.length !== 4 || !isCount(s[0]) || !s[0] || !isCount(s[1]) || !isCount(s[2])) return null;
      samples.push([s[0], s[1], s[2], s[3] ? 1 : 0]);
    }
    return { v: 1, kind: v.kind, piece: { name, position, length }, samples };
  } catch {
    return null;
  }
}

/** Vị trí đầu tiên của `needle` trong `haystack` (chỉ tìm trong phần đầu tệp); -1 nếu không thấy. */
export function findDataStart(haystack: Uint8Array, needle: Uint8Array): number {
  if (!needle.length) return -1;
  const last = Math.min(haystack.length, DATA_START_SEARCH_BYTES) - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Một khung H.264 dạng AVCC = các khối nối nhau, mỗi khối mở đầu bằng 4 byte ghi cỡ của nó. Khung đúng thì đi hết
 * các khối là vừa khít cỡ khung, và byte đầu mỗi khối có bit cấm = 0. Đọc lệch chỗ thì gần như chắc chắn trượt.
 */
export function isValidAvccSample(data: Uint8Array): boolean {
  let at = 0;
  let units = 0;
  while (at + 4 <= data.length) {
    const size = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
    if (size === 0 || at + 4 + size > data.length) return false;
    if (data[at + 4] & 0x80) return false;
    at += 4 + size;
    units++;
  }
  return units > 0 && at === data.length;
}

export interface PlannedSample {
  offset: number;
  size: number;
  timestampUs: number;
  durationUs: number;
  key: boolean;
}

export interface RecoveryPlan {
  /** Các mảnh video theo thứ tự ghi (để dựng lại tệp chưa hoàn chỉnh). */
  pieces: { name: string; position: number; length: number }[];
  /** Số byte liền nhau tính từ đầu tệp đã nằm trên ổ. */
  coveredBytes: number;
  /** Các khung nằm TRỌN trong phần đã ghi, theo thứ tự, bắt đầu bằng một khung khóa. */
  samples: PlannedSample[];
  kind: ClipKind | null;
}

/**
 * Dựng kế hoạch cứu từ các bản ghi sổ (đã xếp theo tên tệp = thứ tự ghi) và chỗ bắt đầu dữ liệu khung hình.
 * Khung đầu phải là khung khóa; mốc giờ phải tăng dần; khung nào thò ra ngoài phần đã ghi thì dừng ở đó.
 */
export function planRecovery(indexes: readonly RecoveryIndexFile[], dataStart: number): RecoveryPlan {
  const pieces = indexes.map((i) => i.piece);
  const overlay = planOverlay(pieces);
  const coveredBytes = overlay.gaps.length ? overlay.gaps[0].from : overlay.totalBytes;
  const samples: PlannedSample[] = [];
  let offset = dataStart;
  let lastTs = -1;
  scan: for (const index of indexes) {
    for (const [size, timestampUs, durationUs, key] of index.samples) {
      if (offset + size > coveredBytes) break scan;
      if (!samples.length && !key) break scan;
      if (timestampUs <= lastTs) break scan;
      samples.push({ offset, size, timestampUs, durationUs, key: key === 1 });
      offset += size;
      lastTs = timestampUs;
    }
  }
  return { pieces, coveredBytes, samples, kind: indexes.length ? indexes[indexes.length - 1].kind : null };
}

/** Đọc `length` byte từ byte thứ `offset` của tệp chưa hoàn chỉnh (ghép từ các mảnh trên ổ). */
export type RecoveryReader = (offset: number, length: number) => Promise<Uint8Array>;

/**
 * Trình đọc tuần tự trên các mảnh: mỗi lúc chỉ giữ MỘT mảnh trong bộ nhớ (≈ 1 MiB), khung vắt qua hai mảnh thì nối.
 * `readPiece` trả trọn nội dung một mảnh theo tên.
 */
export function createPieceReader(
  pieces: readonly { name: string; position: number; length: number }[],
  readPiece: (name: string) => Promise<Uint8Array>
): RecoveryReader {
  const segments = planOverlay(pieces).segments;
  // Vị trí bắt đầu trong tệp của từng đoạn (các đoạn phủ liền từ 0 tới lỗ hổng đầu tiên).
  const starts: number[] = [];
  let cursor = 0;
  for (const seg of segments) {
    starts.push(cursor);
    cursor += seg.length;
  }
  let cached: { name: string; data: Uint8Array } | null = null;
  const load = async (name: string) => {
    if (cached?.name !== name) cached = { name, data: await readPiece(name) };
    return cached.data;
  };
  return async (offset, length) => {
    const out = new Uint8Array(length);
    let done = 0;
    for (let i = 0; i < segments.length && done < length; i++) {
      const seg = segments[i];
      const from = starts[i];
      const to = from + seg.length;
      const want = offset + done;
      if (want < from || want >= to) continue;
      const take = Math.min(length - done, to - want);
      const data = await load(pieces[seg.piece].name);
      const at = seg.offset + (want - from);
      if (at + take > data.length) throw new Error("Mảnh video trên ổ bị cụt");
      out.set(data.subarray(at, at + take), done);
      done += take;
    }
    if (done < length) throw new Error("Phần video đã ghi không đủ dữ liệu");
    return out;
  };
}

export interface RecoveredClip {
  file: ClipFile;
  durationSec: number;
  frames: number;
}

/**
 * Ghép các khung cứu được thành một tệp MP4 MỚI hoàn chỉnh (cùng cách đường quay ghép: `moov` cuối tệp, ghi dần
 * xuống kho clip chờ gửi). Khung nào không đúng cấu trúc H.264 thì dừng ở khung liền trước. Ném lỗi khi không
 * cứu được gì đáng kể.
 */
export async function remuxRecoveredClip(opts: {
  mb: typeof Mediabunny;
  head: RecoveryHeadFile;
  samples: readonly PlannedSample[];
  read: RecoveryReader;
  sink: ClipSinkLike;
  chunkBytes: number;
}): Promise<RecoveredClip> {
  const { mb, head, samples, read, sink } = opts;
  if (!samples.length) throw new Error("Chưa có khung hình nào kịp ghi xuống ổ");
  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: false }),
    target: new mb.StreamTarget(sink.stream() as WritableStream<Mediabunny.StreamTargetChunk>, {
      chunked: true,
      chunkSize: opts.chunkBytes,
    }),
  });
  const source = new mb.EncodedVideoPacketSource("avc");
  output.addVideoTrack(source); // ⛔ không khai frameRate (xem đầu clip-pipeline.ts)
  await output.start();
  const decoderConfig: VideoDecoderConfig = {
    codec: head.codec,
    codedWidth: head.width,
    codedHeight: head.height,
    ...(head.descriptionB64 ? { description: fromBase64(head.descriptionB64) } : {}),
  };
  let frames = 0;
  let endUs = 0;
  try {
    for (const s of samples) {
      const data = await read(s.offset, s.size);
      if (!isValidAvccSample(data)) break; // lệch chỗ → dùng tới khung liền trước
      const packet = new mb.EncodedPacket(data, s.key ? "key" : "delta", s.timestampUs / 1e6, s.durationUs / 1e6);
      await source.add(packet, frames === 0 ? { decoderConfig } : undefined);
      frames++;
      endUs = s.timestampUs + s.durationUs;
    }
    const durationSec = (endUs - samples[0].timestampUs) / 1e6;
    if (!frames || durationSec < MIN_RECOVERED_SECONDS) throw new Error("Phần cứu được quá ngắn");
    await output.finalize();
    const file = sink.finish();
    if (!file.sizeBytes) throw new Error("Ghép lại xong nhưng không có dữ liệu");
    return { file, durationSec, frames };
  } catch (err) {
    await output.cancel().catch(() => {});
    throw err;
  }
}
