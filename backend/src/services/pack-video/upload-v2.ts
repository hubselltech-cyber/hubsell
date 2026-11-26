// ============================================================
// VIDEO ĐÓNG HÀNG — luồng TẢI LÊN BẢN 2: "vé không ghi + ghi gộp lúc xong"
// (M2.4, 26/11/2026 — docs/VIDEO-DONG-HANG-THIET-KE.md mục 29.5)
//
//   app quay xong ──▶ beginUploadV2    : KHÔNG ghi database — ký VÉ TẢI mang sẵn mọi thứ để ghi dòng sổ sau
//   app tải thẳng lên R2 (máy chủ không chạm byte video)
//   app báo xong  ──▶ completeUploadV2 : hỏi R2 cỡ thật → ghi thẳng dòng STORED, GỘP nhiều clip vào một câu INSERT
//
// So với bản 1 (upload.ts): mỗi clip bớt 1 INSERT + 1 UPDATE (+1 UPDATE uploadId nếu tải theo mảnh) → còn 1 lượt đọc
// theo clientId + 1/N câu INSERT. Bản 1 giữ nguyên cho app đã cài; công tắc PACK_UPLOAD_V2 (config/pack-video.ts).
//
// Rào:
//  · Gọi lặp (D1): id video CỐ ĐỊNH theo (chủ shop, clientId) → xin vé lại trong ngày ra cùng đường dẫn tệp. Báo xong
//    lặp: đọc theo clientId trước khi ghi; hai lượt đua nhau thì ràng buộc duy nhất của bảng bắt (ON CONFLICT DO NOTHING),
//    lượt thua đọc lại dòng của lượt thắng. Giờ chỉ cộng vào số dư đã nhớ khi CHÍNH lượt này ghi được dòng.
//  · Đường dẫn tệp KHÔNG nằm trong vé — dựng lại từ (chủ shop, ngày, id) trong vé rồi kiểm tiền tố chủ shop (S1).
//  · Không bao giờ xóa tệp mà một dòng sổ đang trỏ tới: chỉ xóa tệp của vé khi đường dẫn của nó KHÁC đường dẫn dòng đã có.
//  · Đã có dòng do NGƯỜI KHÁC quay với cùng clientId (nhân viên khác của cùng chủ) → từ chối, không cấp vé: id cố định
//    nên cấp vé là cho phép ghi đè tệp của người kia.
//  · Mọi lệnh gọi R2 nằm NGOÀI giao dịch database (tệp này không mở giao dịch nào).
// CHỖ YẾU ĐÃ BIẾT: lượt tải bỏ dở KHÔNG có dòng PENDING nào trong sổ → việc dọn của bản 1 không thấy; tệp / mảnh mồ côi
// trên kho phải dọn bằng luật vòng đời của bucket hoặc một lượt soát riêng.
// ============================================================

import type { Prisma } from "@prisma/client";
import { PACK_STORE_BATCH, PACK_VIDEO_CONTENT_TYPE, PACK_VIDEO_PART_SIZE_BYTES, packUploadV2Enabled } from "../../config/pack-video";
import { toBusinessDateKey } from "../../lib/date-range";
import { createGroupCommit, type GroupCommit } from "../../lib/group-commit";
import { buildPackVideoKey, keyBelongsToOwner } from "../../lib/pack-video-key";
import { durationLooksOff, planParts, uploadModeFor, type BeginInput } from "../../lib/pack-video-rules";
import {
  packUploadIdOf,
  signPackUploadTicket,
  verifyPackUploadTicket,
  type PackUploadClaims,
} from "../../lib/pack-upload-ticket";
import { prisma } from "../../lib/prisma";
import { getHoursBalanceCached, noteUsedSeconds, type HoursBalance } from "./hours";
import { matchOrderByTrackingCode } from "./order-match";
import {
  PackVideoError,
  assertHoursForNewVideo,
  assertPartNumbers,
  continueExisting,
  expiresAt,
  findAnyByClientId,
  refOf,
  signParts,
  signPartsWithHeld,
  storageOf,
  verifyOnStorage,
  type PackVideoActor,
  type PackVideoDeps,
  type Row,
  type SignedPart,
  type UploadPlan,
  type UploadTarget,
  type VideoRef,
} from "./upload";

// ---------- GHI GỘP dòng STORED ----------

type StoredRow = Prisma.PackVideoCreateManyInput;

/** submit(dòng) → true khi CHÍNH dòng này được ghi; false khi đã có dòng trùng (lượt gọi lặp chạy trước). */
export type PackStoreWriter = GroupCommit<StoredRow, boolean>;

const dateKeyOf = (d: Date | string): string => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

/**
 * MỘT câu INSERT nhiều dòng cho cả mẻ. Dòng trùng khóa (cùng ngày + id, hoặc cùng chủ shop + clientId + ngày) bị bỏ
 * qua thay vì làm hỏng cả mẻ. Hai dòng cùng (chủ shop, clientId) trong MỘT mẻ: chỉ dòng đầu được ghi.
 */
async function insertStoredBatch(items: StoredRow[]): Promise<boolean[]> {
  const first = new Map<string, number>();
  items.forEach((it, i) => {
    const k = `${it.ownerId}|${it.clientId}`;
    if (!first.has(k)) first.set(k, i);
  });
  const data = [...first.values()].map((i) => items[i]);
  const written = await prisma.packVideo.createManyAndReturn({
    data,
    skipDuplicates: true,
    select: { id: true, recordedDate: true },
  });
  const done = new Set(written.map((r) => `${dateKeyOf(r.recordedDate)}|${r.id}`));
  return items.map(
    (it, i) => first.get(`${it.ownerId}|${it.clientId}`) === i && done.has(`${dateKeyOf(it.recordedDate)}|${it.id}`)
  );
}

/** Bộ ghi gộp của MỘT tiến trình. `onFlush` nhận số dòng của từng mẻ (test / theo dõi). */
export function createPackStoreWriter(opts: { onFlush?: (rows: number) => void } = {}): PackStoreWriter {
  return createGroupCommit<StoredRow, boolean>({
    maxItems: PACK_STORE_BATCH.maxItems,
    maxWaitMs: PACK_STORE_BATCH.maxWaitMs,
    flush: (items) => {
      opts.onFlush?.(items.length);
      return insertStoredBatch(items);
    },
  });
}

let sharedWriter: PackStoreWriter | null = null;

export interface PackVideoV2Deps extends PackVideoDeps {
  /** Bộ ghi gộp riêng (test); bỏ trống = bộ dùng chung của tiến trình. */
  writer?: PackStoreWriter;
}

function writerOf(deps: PackVideoV2Deps): PackStoreWriter {
  return deps.writer ?? (sharedWriter ??= createPackStoreWriter());
}

// ---------- VÉ ----------

function ticketInvalid(): PackVideoError {
  return new PackVideoError(409, "TICKET_INVALID", "Vé tải lên không còn dùng được — bắt đầu tải lại video này");
}

/** Vé hợp lệ VÀ đúng người: cùng chủ shop với phiên đang gọi; nhân viên chỉ dùng vé của chính mình. */
function ticketOf(actor: PackVideoActor, raw: unknown, now: Date): { t: PackUploadClaims; target: UploadTarget } {
  const t = typeof raw === "string" && raw.length <= 4096 ? verifyPackUploadTicket(raw, now) : null;
  if (!t || t.ownerId !== actor.ownerId || (actor.staff && t.userId !== actor.userId)) throw ticketInvalid();
  // Đường dẫn tệp dựng lại ở máy chủ, không tin gì ngoài (chủ shop, ngày, id) đã ký trong vé.
  const objectKey = buildPackVideoKey({ ownerId: t.ownerId, recordedDate: t.dateKey, id: t.id });
  if (!keyBelongsToOwner(objectKey, actor.ownerId)) {
    throw new PackVideoError(500, "KEY_MISMATCH", "Đường dẫn tệp không khớp chủ shop");
  }
  return { t, target: { objectKey, sizeBytes: t.sizeBytes, uploadId: t.uploadId } };
}

const clientIdReused = (): PackVideoError =>
  new PackVideoError(409, "CLIENT_ID_REUSED", "Mã clientId này đã dùng cho một video khác");

// ---------- BA ĐƯỜNG ----------

/**
 * App báo "đã quay xong" — bản 2. Đã có dòng với `clientId` này → Y HỆT bản 1 cho dòng đó, `ticket: null` (app đi tiếp
 * đường bản 1 /:id/parts + /:id/complete). Chưa có dòng → KHÔNG ghi gì, trả cách tải + vé tải.
 */
export async function beginUploadV2(
  actor: PackVideoActor,
  input: BeginInput,
  deps: PackVideoV2Deps = {}
): Promise<{ video: VideoRef; upload: UploadPlan | null; ticket: string | null; hours: HoursBalance }> {
  // Tắt → app quay về đường bản 1 (POST /). Xét TRƯỚC mọi lượt đọc database.
  if (!packUploadV2Enabled()) {
    throw new PackVideoError(409, "V2_OFF", "Đường tải lên bản 2 đang tắt — dùng đường bản 1");
  }
  const now = (deps.now ?? (() => new Date()))();

  const existing = await findAnyByClientId(actor.ownerId, input.clientId);
  if (existing) {
    if (actor.staff && existing.recordedById !== actor.userId) throw clientIdReused();
    return { ...(await continueExisting(actor, existing, input, deps)), ticket: null };
  }

  const hours = await assertHoursForNewVideo(actor, input.recordedAt, now);
  const match = await matchOrderByTrackingCode(actor.ownerId, input.trackingCode, input.kind);
  const id = packUploadIdOf(actor.ownerId, input.clientId);
  const dateKey = toBusinessDateKey(now);
  const objectKey = buildPackVideoKey({ ownerId: actor.ownerId, recordedDate: dateKey, id });
  const storage = storageOf(deps);

  let uploadId: string | null = null;
  let upload: UploadPlan;
  if (uploadModeFor(input.sizeBytes) === "single") {
    upload = {
      mode: "single",
      url: await storage.presignPut(objectKey, input.sizeBytes),
      headers: { "Content-Type": PACK_VIDEO_CONTENT_TYPE },
      expiresAt: expiresAt(now),
    };
  } else {
    uploadId = await storage.createMultipart(objectKey);
    upload = {
      mode: "multipart",
      partSize: PACK_VIDEO_PART_SIZE_BYTES,
      parts: await signParts(storage, { objectKey, sizeBytes: input.sizeBytes }, uploadId),
      expiresAt: expiresAt(now),
    };
  }

  const { ticket } = signPackUploadTicket(
    {
      id,
      dateKey,
      ownerId: actor.ownerId,
      userId: actor.userId,
      staff: actor.staff === true,
      clientId: input.clientId,
      trackingCode: input.trackingCode,
      kind: input.kind,
      recordedAt: input.recordedAt,
      durationSec: input.durationSec,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      deviceName: input.deviceName,
      channelId: match?.channelId ?? null,
      orderId: match?.orderId ?? null,
      orderCode: match?.orderCode ?? null,
      uploadId,
    },
    { now }
  );
  return { video: { id, status: "PENDING" }, upload, ticket, hours };
}

/** Xin ký lại / ký thêm mảnh bằng vé tải. KHÔNG đọc database. */
export async function signUploadPartsV2(
  actor: PackVideoActor,
  rawTicket: unknown,
  partNumbers: unknown,
  deps: PackVideoV2Deps = {}
): Promise<{ parts: SignedPart[]; uploadedParts: number[]; expiresAt: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const { t, target } = ticketOf(actor, rawTicket, now);
  const uploadId = target.uploadId;
  if (!uploadId) throw new PackVideoError(409, "UPLOAD_STATE", "Video không ở trạng thái tải theo mảnh");
  assertPartNumbers(partNumbers, planParts(t.sizeBytes).length);
  return signPartsWithHeld(storageOf(deps), { ...target, uploadId }, partNumbers, now);
}

/**
 * App báo "tải xong" bằng vé tải. Kiểm tệp trên kho như bản 1, rồi ghi THẲNG dòng STORED qua bộ ghi gộp và chỉ trả lời
 * sau khi mẻ của mình đã ghi xong. Gọi lại bao nhiêu lần cũng một kết quả. Chạy cả khi công tắc bản 2 đã tắt (vé đã
 * cấp không được kẹt).
 */
export async function completeUploadV2(
  actor: PackVideoActor,
  rawTicket: unknown,
  parts: unknown,
  deps: PackVideoV2Deps = {}
): Promise<{ video: VideoRef; hours: HoursBalance }> {
  const now = (deps.now ?? (() => new Date()))();
  const { t, target } = ticketOf(actor, rawTicket, now);
  const storage = storageOf(deps);

  // Tệp lệch cỡ chỉ bị xóa khi KHÔNG có dòng sổ nào trỏ tới đúng đường dẫn này (một lượt đọc, chỉ ở ca lệch cỡ).
  await verifyOnStorage(storage, target, parts, async () => {
    const held = await findAnyByClientId(t.ownerId, t.clientId);
    return held?.objectKey !== target.objectKey;
  });

  /** Đã có dòng với clientId này → trả theo dòng đó; tệp của vé nằm ở đường dẫn KHÁC thì là bản thừa, xóa đi. */
  const settle = async (row: Row): Promise<{ video: VideoRef; hours: HoursBalance }> => {
    if (row.objectKey !== target.objectKey) await storage.remove(target.objectKey).catch(() => {});
    if (
      (actor.staff && row.recordedById !== actor.userId) ||
      Number(row.sizeBytes) !== t.sizeBytes ||
      row.kind !== t.kind ||
      row.trackingCode !== t.trackingCode
    ) {
      throw clientIdReused();
    }
    if (row.status === "STORED") return { video: refOf(row), hours: await getHoursBalanceCached(actor.ownerId) };
    // Dòng PENDING = app đã mở clip này bằng đường bản 1 → bắt đầu lại, bước bắt đầu sẽ dẫn về đường bản 1.
    if (row.status === "PENDING") throw ticketInvalid();
    throw new PackVideoError(409, "UPLOAD_STATE", "Video này đã bị xóa");
  };

  const existing = await findAnyByClientId(t.ownerId, t.clientId);
  if (existing) return settle(existing);

  const inserted = await writerOf(deps).submit({
    id: t.id,
    recordedDate: new Date(`${t.dateKey}T00:00:00.000Z`),
    ownerId: t.ownerId,
    clientId: t.clientId,
    channelId: t.channelId,
    orderId: t.orderId,
    orderCode: t.orderCode,
    trackingCode: t.trackingCode,
    kind: t.kind,
    recordedById: t.userId,
    deviceName: t.deviceName,
    recordedAt: t.recordedAt,
    durationSec: t.durationSec,
    sizeBytes: BigInt(t.sizeBytes),
    width: t.width,
    height: t.height,
    objectKey: target.objectKey,
    uploadId: null,
    status: "STORED",
    durationFlag: durationLooksOff(t.durationSec, t.sizeBytes),
    uploadedAt: now,
  });
  if (inserted) {
    // Giờ chỉ tính khi video đã nằm trên kho VÀ chính lượt này ghi dòng (M2.3) — lượt gọi lặp không cộng lần hai.
    noteUsedSeconds(t.ownerId, t.durationSec);
    return { video: { id: t.id, status: "STORED" }, hours: await getHoursBalanceCached(actor.ownerId) };
  }
  // Không ghi được vì trùng khóa: lượt gọi lặp chạy song song đã ghi trước → trả dòng của nó.
  const winner = await findAnyByClientId(t.ownerId, t.clientId);
  if (!winner) throw clientIdReused();
  return settle(winner);
}
