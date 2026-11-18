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
import { canOpenNewVideo } from "./hours";
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
  objectKey: true,
  uploadId: true,
  status: true,
} satisfies Prisma.PackVideoSelect;

type Row = Prisma.PackVideoGetPayload<{ select: typeof ROW_SELECT }>;

function storageOf(deps: PackVideoDeps): R2Storage {
  return deps.storage ?? getR2Storage();
}

function expiresAt(now: Date): string {
  return new Date(now.getTime() + PACK_VIDEO_PUT_EXPIRES_SEC * 1000).toISOString();
}

function findByClientId(ownerId: string, clientId: string): Promise<Row | null> {
  return prisma.packVideo.findFirst({ where: { ownerId, clientId }, select: ROW_SELECT });
}

function findOwned(ownerId: string, id: string): Promise<Row | null> {
  return prisma.packVideo.findFirst({ where: { ownerId, id }, select: ROW_SELECT });
}

/** Chốt chặn cuối trước mọi lệnh ký / xóa: tệp phải nằm dưới tiền tố của đúng chủ shop. */
function assertOwnedKey(row: Row): void {
  if (!keyBelongsToOwner(row.objectKey, row.ownerId)) {
    throw new PackVideoError(500, "KEY_MISMATCH", "Đường dẫn tệp không khớp chủ shop");
  }
}

async function signParts(storage: R2Storage, row: Row, uploadId: string, partNumbers?: number[]): Promise<SignedPart[]> {
  const plan = planParts(Number(row.sizeBytes));
  const wanted = partNumbers ? plan.filter((p) => partNumbers.includes(p.partNumber)) : plan;
  return Promise.all(
    wanted.slice(0, PACK_VIDEO_MAX_PARTS_PER_REQUEST).map(async (p) => ({
      partNumber: p.partNumber,
      url: await storage.presignPart(row.objectKey, uploadId, p.partNumber, p.size),
    }))
  );
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
function isUploadGone(err: unknown): boolean {
  return err instanceof R2Error && (err.status === 404 || err.code === "NoSuchUpload");
}

function refOf(row: Row): VideoRef {
  return { id: row.id, status: row.status as PackVideoStatus };
}

/**
 * App báo "đã quay xong". Trả dòng sổ + cách tải. Gọi lại cùng `clientId` trả đúng dòng cũ:
 * PENDING → ký lại; STORED → `upload: null` (đã xong, app xóa tệp trên máy được rồi).
 */
export async function beginUpload(
  actor: PackVideoActor,
  input: BeginInput,
  deps: PackVideoDeps = {}
): Promise<{ video: VideoRef; upload: UploadPlan | null }> {
  const now = (deps.now ?? (() => new Date()))();

  let row = await findByClientId(actor.ownerId, input.clientId);
  let resumed = row !== null;

  if (!row) {
    const allowed = await canOpenNewVideo(actor.ownerId, input.recordedAt, now);
    if (!allowed.ok) {
      throw new PackVideoError(402, "OUT_OF_HOURS", "Đã hết giờ quay — mua thêm giờ để quay video mới");
    }
    const match = await matchOrderByTrackingCode(actor.ownerId, input.trackingCode, input.kind);
    const id = randomUUID().replace(/-/g, "");
    const dateKey = toBusinessDateKey(now);
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
      row = await findByClientId(actor.ownerId, input.clientId);
      if (!row) throw err;
      resumed = true;
    }
  }

  if (resumed) {
    // Cùng clientId mà khác tệp = lỗi phía app; không được ghi đè video đã có.
    if (
      Number(row.sizeBytes) !== input.sizeBytes ||
      row.kind !== input.kind ||
      row.trackingCode !== input.trackingCode
    ) {
      throw new PackVideoError(409, "CLIENT_ID_REUSED", "Mã clientId này đã dùng cho một video khác");
    }
  }

  if (row.status === "STORED") return { video: refOf(row), upload: null };
  if (row.status !== "PENDING") {
    throw new PackVideoError(409, "UPLOAD_STATE", "Video này đã bị xóa, không tải lên lại được");
  }
  return { video: refOf(row), upload: await planFor(row, deps, resumed) };
}

/** Xin ký lại / ký thêm mảnh cho một lượt tải theo mảnh còn dang dở. */
export async function signUploadParts(
  actor: PackVideoActor,
  id: string,
  partNumbers: unknown,
  deps: PackVideoDeps = {}
): Promise<{ parts: SignedPart[]; uploadedParts: number[]; expiresAt: string }> {
  const row = await findOwned(actor.ownerId, id);
  if (!row) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy video");
  if (row.status !== "PENDING" || !row.uploadId) {
    throw new PackVideoError(409, "UPLOAD_STATE", "Video không ở trạng thái tải theo mảnh");
  }
  const total = planParts(Number(row.sizeBytes)).length;
  if (
    !Array.isArray(partNumbers) ||
    partNumbers.length === 0 ||
    partNumbers.length > PACK_VIDEO_MAX_PARTS_PER_REQUEST ||
    partNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > total) ||
    new Set(partNumbers).size !== partNumbers.length
  ) {
    throw new PackVideoError(400, "BAD_PARTS", `Danh sách mảnh không hợp lệ (tệp này có ${total} mảnh)`);
  }
  const storage = storageOf(deps);
  const now = (deps.now ?? (() => new Date()))();
  assertOwnedKey(row);
  const [parts, held] = await Promise.all([
    signParts(storage, row, row.uploadId, partNumbers as number[]),
    storage.listParts(row.objectKey, row.uploadId).catch((err: unknown) => {
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

/**
 * App báo "tải xong". Máy chủ KHÔNG tin lời app: hỏi R2 cỡ thật của tệp rồi mới ghi STORED.
 * Gọi lại bao nhiêu lần cũng một kết quả. Cỡ lệch với lúc báo → xóa tệp, giữ PENDING, trả 409.
 */
export async function completeUpload(
  actor: PackVideoActor,
  id: string,
  parts: unknown,
  deps: PackVideoDeps = {}
): Promise<{ video: VideoRef }> {
  const row = await findOwned(actor.ownerId, id);
  if (!row) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy video");
  if (row.status === "STORED") return { video: refOf(row) };
  if (row.status !== "PENDING") {
    throw new PackVideoError(409, "UPLOAD_STATE", "Video này đã bị xóa");
  }
  const storage = storageOf(deps);
  const now = (deps.now ?? (() => new Date()))();
  assertOwnedKey(row);
  const expected = Number(row.sizeBytes);

  let head = await storage.head(row.objectKey);

  // Tải theo mảnh mà tệp chưa thành hình → chốt lượt tải. (Tệp đã có = lượt chốt trước đã chạy,
  // chỉ bước ghi sổ hỏng → bỏ qua, đi thẳng xuống kiểm cỡ.)
  if (!head && row.uploadId) {
    const total = planParts(expected).length;
    const given = parseCompletedParts(parts);
    const uploadId = row.uploadId;
    const list =
      given ??
      (await storage.listParts(row.objectKey, uploadId).catch((err: unknown) => {
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
      await storage.completeMultipart(row.objectKey, uploadId, list);
    } catch (err) {
      if (isUploadGone(err)) throw uploadExpired();
      if (!(err instanceof R2Error) || err.status >= 500) throw err;
      throw new PackVideoError(409, "COMPLETE_FAILED", "Kho không ghép được tệp từ các mảnh đã báo — kiểm lại rồi báo lại");
    }
    head = await storage.head(row.objectKey);
  }

  if (!head) {
    throw new PackVideoError(409, "NOT_UPLOADED", "Chưa thấy tệp trên kho — tải lên rồi báo lại");
  }
  if (head.size !== expected) {
    await storage.remove(row.objectKey);
    throw new PackVideoError(409, "SIZE_MISMATCH", "Cỡ tệp trên kho khác cỡ đã báo — đã xóa tệp, tải lại");
  }

  // Chỉ dòng còn PENDING mới chuyển; lượt gọi lặp chạy trước đã chuyển rồi thì count = 0, vẫn là STORED.
  await prisma.packVideo.updateMany({
    where: { ownerId: actor.ownerId, id, status: "PENDING" },
    data: { status: "STORED", uploadedAt: now, uploadId: null },
  });
  return { video: { id, status: "STORED" } };
}

/** Lượt tải theo mảnh đã bị kho hủy — app gọi lại bước bắt đầu (cùng clientId) để mở lượt mới. */
function uploadExpired(): PackVideoError {
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
