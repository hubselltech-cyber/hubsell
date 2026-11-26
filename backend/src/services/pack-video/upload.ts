// ============================================================
// VIDEO ĐÓNG HÀNG — luồng TẢI LÊN (bắt đầu · ký lại mảnh · chốt)
//
//   app quay xong ──▶ beginUpload   : ghi sổ PENDING, trả đường dẫn ký sẵn
//   app tải thẳng lên R2 (máy chủ không chạm byte video)
//   app báo xong  ──▶ completeUpload: hỏi R2 cỡ thật rồi mới ghi STORED
//
// Rào đã cài (số theo sổ rủi ro của docs/VIDEO-DONG-HANG-THIET-KE.md):
//  · D1 gọi lặp: `clientId` do app sinh — gọi lại trả đúng dòng cũ. Tra trước qua mọi mảnh; hai lượt
//    đua nhau cùng lúc thì ràng buộc duy nhất của bảng bắt, lượt thua đọc lại dòng của lượt thắng.
//  · D5 khớp tem: services/pack-video/order-match.ts.
//  · D6 đồng hồ điện thoại: ngày chia mảnh + đường dẫn tệp lấy theo giờ MÁY CHỦ.
//  · S1 / S5: đường dẫn tệp do máy chủ dựng dưới tiền tố chủ shop; ký cả cỡ và kiểu tệp.
//  · I5: mọi lệnh gọi R2 nằm NGOÀI giao dịch database (tệp này không mở giao dịch nào).
//  · HẾT GIỜ THÌ DỪNG (18/11, thiết kế mục 19.3): video MỚI chỉ mở khi còn giờ, hoặc khi clip bắt đầu quay
//    lúc còn giờ (quay nốt) — hours.ts canOpenNewVideo. Gọi lại cùng clientId (dòng đã có) KHÔNG bị chặn:
//    video đã báo xong thì luôn tải lên được.
// Mỗi dòng ghi: INSERT lúc bắt đầu (+1 UPDATE uploadId nếu tải theo mảnh) và 1 UPDATE lúc chốt.
//
// Đây là đường BẢN 1 — giữ nguyên cho app đã cài. Đường bản 2 "vé không ghi + ghi gộp lúc xong" (M2.4, 26/11/2026) nằm ở
// upload-v2.ts và dùng chung các hàm `export` có ghi chú "dùng chung bản 1 + bản 2" dưới đây (kiểm tệp trên kho, ký mảnh,
// xét giờ, đi tiếp một dòng đã có).
// ============================================================

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  PACK_VIDEO_CONTENT_TYPE,
  PACK_VIDEO_MAX_PARTS_PER_REQUEST,
  PACK_VIDEO_PART_SIZE_BYTES,
  PACK_VIDEO_PUT_EXPIRES_SEC,
} from "../../config/pack-video";
import { getR2Storage, R2Error, type R2Storage } from "../../integrations/r2/client";
import { toBusinessDateKey } from "../../lib/date-range";
import { buildPackVideoKey, keyBelongsToOwner } from "../../lib/pack-video-key";
import {
  durationLooksOff,
  planParts,
  uploadModeFor,
  type BeginInput,
  type PackVideoStatus,
} from "../../lib/pack-video-rules";
import { prisma } from "../../lib/prisma";
import { canOpenNewVideo, getHoursBalanceCached, noteUsedSeconds, type HoursBalance } from "./hours";
import { matchOrderByTrackingCode } from "./order-match";

/** Lỗi nghiệp vụ có mã — route đổi thẳng thành phản hồi HTTP. */
export class PackVideoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PackVideoError";
  }
}

export interface PackVideoActor {
  /** Chủ shop — LUÔN lấy từ phiên đăng nhập. */
  ownerId: string;
  /** Người đang đăng nhập trên máy quay. */
  userId: string;
  /**
   * true = NHÂN VIÊN (24/11/2026): chỉ chạm được video do CHÍNH MÌNH quay (ký mảnh / báo tải xong / gọi lại
   * cùng clientId), câu hết giờ nói "báo chủ shop" thay cho "mua thêm giờ". Bỏ trống = chủ shop.
   */
  staff?: boolean;
}

export interface PackVideoDeps {
  storage?: R2Storage;
  now?: () => Date;
}

export interface SignedPart {
  partNumber: number;
  url: string;
}

export type UploadPlan =
  | { mode: "single"; url: string; headers: Record<string, string>; expiresAt: string }
  | {
      mode: "multipart";
      partSize: number;
      parts: SignedPart[];
      /** Mảnh R2 đang giữ (chỉ trả khi gọi lại) — app bỏ qua các mảnh này, không tin sổ trên máy. */
      uploadedParts?: number[];
      expiresAt: string;
    };

export interface VideoRef {
  id: string;
  status: PackVideoStatus;
}

const ROW_SELECT = {
  id: true,
  recordedDate: true,
  ownerId: true,
  clientId: true,
  trackingCode: true,
  kind: true,
  sizeBytes: true,
  durationSec: true,
  objectKey: true,
  uploadId: true,
  status: true,
  recordedById: true,
} satisfies Prisma.PackVideoSelect;

export type Row = Prisma.PackVideoGetPayload<{ select: typeof ROW_SELECT }>;

/** Một tệp trên kho cần ký / kiểm — dòng sổ (bản 1) hoặc nội dung vé tải (bản 2). */
export interface UploadTarget {
  objectKey: string;
  sizeBytes: number;
  uploadId: string | null;
}

export function storageOf(deps: PackVideoDeps): R2Storage {
  return deps.storage ?? getR2Storage();
}

export function expiresAt(now: Date): string {
  return new Date(now.getTime() + PACK_VIDEO_PUT_EXPIRES_SEC * 1000).toISOString();
}

/** Tra theo clientId qua MỌI người quay của chủ shop (bản 2 dùng để không cấp vé đè lên video của người khác). */
export function findAnyByClientId(ownerId: string, clientId: string): Promise<Row | null> {
  return prisma.packVideo.findFirst({ where: { ownerId, clientId }, select: ROW_SELECT });
}

function findByClientId(actor: PackVideoActor, clientId: string): Promise<Row | null> {
  return prisma.packVideo.findFirst({ where: { ownerId: actor.ownerId, clientId, ...ownOnly(actor) }, select: ROW_SELECT });
}

/** Nhân viên chỉ thấy video của chính mình ở các đường GHI. */
function ownOnly(actor: PackVideoActor): { recordedById?: string } {
  return actor.staff ? { recordedById: actor.userId } : {};
}

function findOwned(ownerId: string, id: string, actor?: PackVideoActor): Promise<Row | null> {
  return prisma.packVideo.findFirst({ where: { ownerId, id, ...(actor ? ownOnly(actor) : {}) }, select: ROW_SELECT });
}

/** Chốt chặn cuối trước mọi lệnh ký / xóa: tệp phải nằm dưới tiền tố của đúng chủ shop. */
function assertOwnedKey(row: Row): void {
  if (!keyBelongsToOwner(row.objectKey, row.ownerId)) {
    throw new PackVideoError(500, "KEY_MISMATCH", "Đường dẫn tệp không khớp chủ shop");
  }
}

/** Dùng chung bản 1 + bản 2: ký đường dẫn cho các mảnh (bỏ trống `partNumbers` = mọi mảnh, tối đa một lượt xin). */
export async function signParts(
  storage: R2Storage,
  target: { objectKey: string; sizeBytes: number | bigint },
  uploadId: string,
  partNumbers?: number[]
): Promise<SignedPart[]> {
  const plan = planParts(Number(target.sizeBytes));
  const wanted = partNumbers ? plan.filter((p) => partNumbers.includes(p.partNumber)) : plan;
  return Promise.all(
    wanted.slice(0, PACK_VIDEO_MAX_PARTS_PER_REQUEST).map(async (p) => ({
      partNumber: p.partNumber,
      url: await storage.presignPart(target.objectKey, uploadId, p.partNumber, p.size),
    }))
  );
}

/** Dùng chung bản 1 + bản 2: danh sách số mảnh app xin ký phải hợp lệ với tệp có `total` mảnh. */
export function assertPartNumbers(partNumbers: unknown, total: number): asserts partNumbers is number[] {
  if (
    !Array.isArray(partNumbers) ||
    partNumbers.length === 0 ||
    partNumbers.length > PACK_VIDEO_MAX_PARTS_PER_REQUEST ||
    partNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > total) ||
    new Set(partNumbers).size !== partNumbers.length
  ) {
    throw new PackVideoError(400, "BAD_PARTS", `Danh sách mảnh không hợp lệ (tệp này có ${total} mảnh)`);
  }
}

/** Dùng chung bản 1 + bản 2: ký các mảnh được xin + hỏi kho đang giữ mảnh nào. Lượt tải đã bị kho hủy → UPLOAD_EXPIRED. */
export async function signPartsWithHeld(
  storage: R2Storage,
  target: UploadTarget & { uploadId: string },
  partNumbers: number[],
  now: Date
): Promise<{ parts: SignedPart[]; uploadedParts: number[]; expiresAt: string }> {
  const [parts, held] = await Promise.all([
    signParts(storage, target, target.uploadId, partNumbers),
    storage.listParts(target.objectKey, target.uploadId).catch((err: unknown) => {
      if (isUploadGone(err)) throw uploadExpired();
      throw err;
    }),
  ]);
  return {
    parts,
    uploadedParts: held.map((p) => p.partNumber).sort((a, b) => a - b),
    expiresAt: expiresAt(now),
  };
}

/** Dựng kế hoạch tải cho một dòng PENDING. `resumed` = dòng đã có từ lượt gọi trước. */
async function planFor(row: Row, deps: PackVideoDeps, resumed: boolean): Promise<UploadPlan> {
  const storage = storageOf(deps);
  const now = (deps.now ?? (() => new Date()))();
  assertOwnedKey(row);
  const size = Number(row.sizeBytes);

  if (uploadModeFor(size) === "single") {
    return {
      mode: "single",
      url: await storage.presignPut(row.objectKey, size),
      headers: { "Content-Type": PACK_VIDEO_CONTENT_TYPE },
      expiresAt: expiresAt(now),
    };
  }

  let uploadId = row.uploadId;
  if (!uploadId) {
    const fresh = await storage.createMultipart(row.objectKey);
    // Chỉ ghi khi chưa ai ghi: hai lượt gọi lặp cùng mở lượt tải thì lượt thua hủy của mình.
    const claimed = await prisma.packVideo.updateMany({
      where: { ownerId: row.ownerId, id: row.id, status: "PENDING", uploadId: null },
      data: { uploadId: fresh },
    });
    if (claimed.count === 1) {
      uploadId = fresh;
    } else {
      await storage.abortMultipart(row.objectKey, fresh).catch(() => {});
      uploadId = (await findOwned(row.ownerId, row.id))?.uploadId ?? null;
      if (!uploadId) throw new PackVideoError(409, "UPLOAD_STATE", "Video không còn ở trạng thái chờ tải");
    }
  }

  let uploadedParts: number[] | undefined;
  if (resumed) {
    try {
      uploadedParts = (await storage.listParts(row.objectKey, uploadId))
        .map((p) => p.partNumber)
        .sort((x, y) => x - y);
    } catch (err) {
      // Kho không còn lượt tải này (kho tự hủy lượt bỏ dở lâu ngày) → mở lượt mới, tải lại từ đầu.
      if (!isUploadGone(err)) throw err;
      const fresh = await storage.createMultipart(row.objectKey);
      const swapped = await prisma.packVideo.updateMany({
        where: { ownerId: row.ownerId, id: row.id, status: "PENDING", uploadId },
        data: { uploadId: fresh },
      });
      if (swapped.count !== 1) {
        await storage.abortMultipart(row.objectKey, fresh).catch(() => {});
        throw new PackVideoError(409, "UPLOAD_STATE", "Video không còn ở trạng thái chờ tải");
      }
      uploadId = fresh;
      uploadedParts = [];
    }
  }
  return {
    mode: "multipart",
    partSize: PACK_VIDEO_PART_SIZE_BYTES,
    parts: await signParts(storage, row, uploadId),
    ...(uploadedParts ? { uploadedParts } : {}),
    expiresAt: expiresAt(now),
  };
}

/** Kho báo lượt tải theo mảnh không còn tồn tại. */
export function isUploadGone(err: unknown): boolean {
  return err instanceof R2Error && (err.status === 404 || err.code === "NoSuchUpload");
}

export function refOf(row: Row): VideoRef {
  return { id: row.id, status: row.status as PackVideoStatus };
}

/**
 * Dùng chung bản 1 + bản 2 — HẾT GIỜ THÌ DỪNG: video MỚI chỉ mở khi còn giờ (hoặc clip bắt đầu quay lúc còn giờ).
 * Qua được thì trả số dư để gửi kèm câu trả lời (M2.2); không qua → 402 OUT_OF_HOURS.
 */
export async function assertHoursForNewVideo(actor: PackVideoActor, recordedAt: Date, now: Date): Promise<HoursBalance> {
  const allowed = await canOpenNewVideo(actor.ownerId, recordedAt, now);
  if (allowed.ok) return allowed.balance;
  throw new PackVideoError(
    402,
    "OUT_OF_HOURS",
    actor.staff ? "Đã hết giờ quay — báo chủ shop mua thêm giờ" : "Đã hết giờ quay — mua thêm giờ để quay video mới"
  );
}

/**
 * Dùng chung bản 1 + bản 2 — app gọi lại bước bắt đầu với một `clientId` ĐÃ CÓ DÒNG:
 * PENDING → ký lại (kèm mảnh kho đang giữ); STORED → `upload: null`; đã xóa → 409; khác tệp → 409.
 */
export async function continueExisting(
  actor: PackVideoActor,
  row: Row,
  input: BeginInput,
  deps: PackVideoDeps
): Promise<{ video: VideoRef; upload: UploadPlan | null; hours: HoursBalance }> {
  // Cùng clientId mà khác tệp = lỗi phía app; không được ghi đè video đã có.
  if (Number(row.sizeBytes) !== input.sizeBytes || row.kind !== input.kind || row.trackingCode !== input.trackingCode) {
    throw new PackVideoError(409, "CLIENT_ID_REUSED", "Mã clientId này đã dùng cho một video khác");
  }
  const hours = await getHoursBalanceCached(actor.ownerId);
  if (row.status === "STORED") return { video: refOf(row), upload: null, hours };
  if (row.status !== "PENDING") {
    throw new PackVideoError(409, "UPLOAD_STATE", "Video này đã bị xóa, không tải lên lại được");
  }
  return { video: refOf(row), upload: await planFor(row, deps, true), hours };
}

/**
 * App báo "đã quay xong". Trả dòng sổ + cách tải. Gọi lại cùng `clientId` trả đúng dòng cũ:
 * PENDING → ký lại; STORED → `upload: null` (đã xong, app xóa tệp trên máy được rồi).
 */
export async function beginUpload(
  actor: PackVideoActor,
  input: BeginInput,
  deps: PackVideoDeps = {}
): Promise<{ video: VideoRef; upload: UploadPlan | null; hours: HoursBalance }> {
  const now = (deps.now ?? (() => new Date()))();

  const existing = await findByClientId(actor, input.clientId);
  if (existing) return continueExisting(actor, existing, input, deps);

  // Số giờ đi kèm câu trả lời (M2.2) — màn quay không phải gọi /hours riêng sau mỗi clip.
  const hours = await assertHoursForNewVideo(actor, input.recordedAt, now);
  const match = await matchOrderByTrackingCode(actor.ownerId, input.trackingCode, input.kind);
  const id = randomUUID().replace(/-/g, "");
  const dateKey = toBusinessDateKey(now);
  let row: Row;
  try {
    row = await prisma.packVideo.create({
      data: {
        id,
        recordedDate: new Date(`${dateKey}T00:00:00.000Z`),
        ownerId: actor.ownerId,
        clientId: input.clientId,
        channelId: match?.channelId ?? null,
        orderId: match?.orderId ?? null,
        orderCode: match?.orderCode ?? null,
        trackingCode: input.trackingCode,
        kind: input.kind,
        recordedById: actor.userId,
        deviceName: input.deviceName,
        recordedAt: input.recordedAt,
        durationSec: input.durationSec,
        sizeBytes: BigInt(input.sizeBytes),
        width: input.width,
        height: input.height,
        objectKey: buildPackVideoKey({ ownerId: actor.ownerId, recordedDate: dateKey, id }),
        status: "PENDING",
        durationFlag: durationLooksOff(input.durationSec, input.sizeBytes),
      },
      select: ROW_SELECT,
    });
  } catch (err) {
    // Lượt gọi lặp chạy song song đã chèn trước → đọc lại dòng của nó.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const winner = await findByClientId(actor, input.clientId);
    if (!winner) throw err;
    return continueExisting(actor, winner, input, deps);
  }
  return { video: refOf(row), upload: await planFor(row, deps, false), hours };
}

/** Xin ký lại / ký thêm mảnh cho một lượt tải theo mảnh còn dang dở. */
export async function signUploadParts(
  actor: PackVideoActor,
  id: string,
  partNumbers: unknown,
  deps: PackVideoDeps = {}
): Promise<{ parts: SignedPart[]; uploadedParts: number[]; expiresAt: string }> {
  const row = await findOwned(actor.ownerId, id, actor);
  if (!row) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy video");
  if (row.status !== "PENDING" || !row.uploadId) {
    throw new PackVideoError(409, "UPLOAD_STATE", "Video không ở trạng thái tải theo mảnh");
  }
  assertPartNumbers(partNumbers, planParts(Number(row.sizeBytes)).length);
  const storage = storageOf(deps);
  const now = (deps.now ?? (() => new Date()))();
  assertOwnedKey(row);
  return signPartsWithHeld(
    storage,
    { objectKey: row.objectKey, sizeBytes: Number(row.sizeBytes), uploadId: row.uploadId },
    partNumbers,
    now
  );
}

/**
 * Dùng chung bản 1 + bản 2 — KIỂM TỆP TRÊN KHO trước khi ghi STORED. Máy chủ không tin lời app:
 *  · tải theo mảnh mà tệp chưa thành hình → chốt lượt tải (tệp đã có = lượt chốt trước đã chạy, chỉ bước ghi sổ hỏng
 *    → bỏ qua, đi thẳng xuống kiểm cỡ);
 *  · chưa thấy tệp → NOT_UPLOADED; thiếu mảnh → PARTS_MISSING; kho hủy lượt tải → UPLOAD_EXPIRED; kho không ghép
 *    được → COMPLETE_FAILED; cỡ thật khác cỡ đã báo → xóa tệp + SIZE_MISMATCH.
 * `mayRemove` (bản 2): hỏi trước khi xóa tệp lệch cỡ — trả false thì giữ tệp (đang có dòng sổ trỏ vào nó). Bỏ trống = xóa.
 */
export async function verifyOnStorage(
  storage: R2Storage,
  target: UploadTarget,
  parts: unknown,
  mayRemove?: () => Promise<boolean>
): Promise<void> {
  const expected = target.sizeBytes;
  let head = await storage.head(target.objectKey);

  if (!head && target.uploadId) {
    const total = planParts(expected).length;
    const given = parseCompletedParts(parts);
    const uploadId = target.uploadId;
    const list =
      given ??
      (await storage.listParts(target.objectKey, uploadId).catch((err: unknown) => {
        if (isUploadGone(err)) throw uploadExpired();
        throw err;
      }));
    if (list.length !== total) {
      throw new PackVideoError(
        409,
        "PARTS_MISSING",
        `Mới có ${list.length}/${total} mảnh trên kho — tải nốt rồi báo lại`
      );
    }
    try {
      await storage.completeMultipart(target.objectKey, uploadId, list);
    } catch (err) {
      if (isUploadGone(err)) throw uploadExpired();
      if (!(err instanceof R2Error) || err.status >= 500) throw err;
      throw new PackVideoError(409, "COMPLETE_FAILED", "Kho không ghép được tệp từ các mảnh đã báo — kiểm lại rồi báo lại");
    }
    head = await storage.head(target.objectKey);
  }

  if (!head) {
    throw new PackVideoError(409, "NOT_UPLOADED", "Chưa thấy tệp trên kho — tải lên rồi báo lại");
  }
  if (head.size !== expected) {
    if (!mayRemove || (await mayRemove())) await storage.remove(target.objectKey);
    throw new PackVideoError(409, "SIZE_MISMATCH", "Cỡ tệp trên kho khác cỡ đã báo — đã xóa tệp, tải lại");
  }
}

/**
 * App báo "tải xong". Máy chủ KHÔNG tin lời app: hỏi R2 cỡ thật của tệp rồi mới ghi STORED.
 * Gọi lại bao nhiêu lần cũng một kết quả. Cỡ lệch với lúc báo → xóa tệp, giữ PENDING, trả 409.
 */
export async function completeUpload(
  actor: PackVideoActor,
  id: string,
  parts: unknown,
  deps: PackVideoDeps = {}
): Promise<{ video: VideoRef; hours: HoursBalance }> {
  const row = await findOwned(actor.ownerId, id, actor);
  if (!row) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy video");
  if (row.status === "STORED") return { video: refOf(row), hours: await getHoursBalanceCached(actor.ownerId) };
  if (row.status !== "PENDING") {
    throw new PackVideoError(409, "UPLOAD_STATE", "Video này đã bị xóa");
  }
  const storage = storageOf(deps);
  const now = (deps.now ?? (() => new Date()))();
  assertOwnedKey(row);
  await verifyOnStorage(
    storage,
    { objectKey: row.objectKey, sizeBytes: Number(row.sizeBytes), uploadId: row.uploadId },
    parts
  );

  // Chỉ dòng còn PENDING mới chuyển; lượt gọi lặp chạy trước đã chuyển rồi thì count = 0, vẫn là STORED.
  const moved = await prisma.packVideo.updateMany({
    where: { ownerId: actor.ownerId, id, status: "PENDING" },
    data: { status: "STORED", uploadedAt: now, uploadId: null },
  });
  // Giờ chỉ tính khi video đã nằm trên kho: CHÍNH lượt này chuyển dòng thì cộng thời lượng vào số dư đã nhớ (M2.3).
  if (moved.count === 1) noteUsedSeconds(actor.ownerId, row.durationSec);
  return { video: { id, status: "STORED" }, hours: await getHoursBalanceCached(actor.ownerId) };
}

/** Lượt tải theo mảnh đã bị kho hủy — app gọi lại bước bắt đầu (cùng clientId) để mở lượt mới. */
export function uploadExpired(): PackVideoError {
  return new PackVideoError(409, "UPLOAD_EXPIRED", "Lượt tải lên đã hết hạn trên kho — bắt đầu tải lại video này");
}

function parseCompletedParts(parts: unknown): { partNumber: number; etag: string }[] | null {
  if (parts == null) return null;
  if (!Array.isArray(parts)) throw new PackVideoError(400, "BAD_PARTS", "Danh sách mảnh không hợp lệ");
  const out: { partNumber: number; etag: string }[] = [];
  for (const p of parts as { partNumber?: unknown; etag?: unknown }[]) {
    if (!Number.isInteger(p?.partNumber) || typeof p?.etag !== "string" || !p.etag || p.etag.length > 100) {
      throw new PackVideoError(400, "BAD_PARTS", "Danh sách mảnh không hợp lệ");
    }
    out.push({ partNumber: p.partNumber as number, etag: p.etag });
  }
  if (new Set(out.map((p) => p.partNumber)).size !== out.length) {
    throw new PackVideoError(400, "BAD_PARTS", "Danh sách mảnh bị trùng số");
  }
  return out;
}
