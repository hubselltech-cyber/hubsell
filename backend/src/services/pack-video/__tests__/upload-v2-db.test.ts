// ============================================================
// VIDEO ĐÓNG HÀNG — luồng tải lên BẢN 2 "vé không ghi + ghi gộp lúc xong" (M2.4) trên Postgres thật, kho R2 GIẢ.
// Rào kiểm ở đây:
//   xin vé KHÔNG ghi dòng nào · báo xong ghi đúng MỘT dòng STORED và cộng giờ đúng một lần · báo xong lặp vẫn một kết quả ·
//   đã lưu rồi xin vé lại → upload = null · đã có dòng PENDING của bản 1 → ticket = null, đi tiếp bản 1 ·
//   nhân viên không dùng được vé của người khác · vé của chủ shop khác bị từ chối · lệch cỡ → xóa tệp, không ghi gì ·
//   20 clip báo xong cùng lúc → 20 dòng bằng rất ít câu INSERT (đếm số mẻ qua móc onFlush, không dựa vào đồng hồ).
// Tự tạo chủ shop + gian + đơn riêng rồi xóa (kể cả dòng order_ledger sinh theo đơn); không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { PACK_VIDEO_PART_SIZE_BYTES } from "../../../config/pack-video";
import { signPackSessionTicket } from "../../../lib/pack-session-ticket";
import { planParts, type BeginInput } from "../../../lib/pack-video-rules";
import { packUploadIdOf, verifyPackUploadTicket } from "../../../lib/pack-upload-ticket";
import { prisma } from "../../../lib/prisma";
import { getHoursBalance, getHoursBalanceCached, grantHours } from "../hours";
import { PackVideoError, beginUpload, completeUpload } from "../upload";
import { beginUploadV2, completeUploadV2, createPackStoreWriter, signUploadPartsV2 } from "../upload-v2";
import { createFakeStorage } from "./fake-storage";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pv2-${Date.now()}`;
const NOW = new Date("2026-11-16T18:30:00.000Z"); // 01:30 ngày 17/11 giờ VN
const NEXT_DAY = new Date("2026-11-17T18:30:00.000Z"); // 01:30 ngày 18/11 giờ VN
const SMALL = 6_500_000;
const BIG = 90_291_111; // 11 mảnh

function input(patch: Partial<BeginInput> = {}): BeginInput {
  return {
    clientId: `${TAG}-c1`,
    trackingCode: `${TAG}-KHONGCO`,
    kind: "PACK",
    recordedAt: new Date("2026-11-16T18:20:00.000Z"),
    durationSec: 60,
    sizeBytes: SMALL,
    width: 768,
    height: 1024,
    deviceName: "Máy thử",
    ...patch,
  };
}

async function expectError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(PackVideoError);
  expect([(err as PackVideoError).status, (err as PackVideoError).code]).toEqual([status, code]);
}

describe.skipIf(!dbReady)("Video đóng hàng — tải lên bản 2 (vé không ghi + ghi gộp)", () => {
  let ownerId = "";
  let channelId = "";
  let orderId = "";
  const envBefore = process.env.PACK_UPLOAD_V2;
  const actor = () => ({ ownerId, userId: ownerId });
  const staff = (userId: string) => ({ ownerId, userId, staff: true });
  const rowsOf = (clientId: string) => prisma.packVideo.findMany({ where: { ownerId, clientId } });
  const keyOf = (dateKey: string, clientId: string) => `${ownerId}/${dateKey}/${packUploadIdOf(ownerId, clientId)}.mp4`;

  beforeAll(async () => {
    process.env.PACK_UPLOAD_V2 = "on";
    const user = await prisma.user.create({
      data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
      select: { id: true },
    });
    ownerId = user.id;
    await grantHours({ ownerId, seconds: 100 * 3600, kind: "GRANT", note: TAG });
    const channel = await prisma.channel.create({
      data: { userId: ownerId, channelName: ChannelName.SHOPEE, shopName: TAG },
      select: { id: true },
    });
    channelId = channel.id;
    const order = await prisma.order.create({
      data: { channelId, orderCode: `${TAG}-D1`, customerName: "Khách thử", trackingCode: `${TAG}-VD1` },
      select: { id: true },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    if (envBefore === undefined) delete process.env.PACK_UPLOAD_V2;
    else process.env.PACK_UPLOAD_V2 = envBefore;
    if (!ownerId) return;
    await prisma.packVideo.deleteMany({ where: { ownerId } });
    await prisma.packHourGrant.deleteMany({ where: { ownerId } });
    if (channelId) {
      await prisma.orderLedger.deleteMany({ where: { channelId } }).catch(() => {});
      await prisma.order.deleteMany({ where: { channelId } });
      await prisma.channel.deleteMany({ where: { id: channelId } });
    }
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("xin vé KHÔNG ghi dòng nào; báo xong ghi đúng MỘT dòng STORED (khớp đơn, ngày theo giờ VN) và cộng giờ đúng một lần", async () => {
    const storage = createFakeStorage();
    const flushes: number[] = [];
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter({ onFlush: (n) => flushes.push(n) }) };
    const inp = input({ trackingCode: `${TAG}-VD1` });

    const begun = await beginUploadV2(actor(), inp, deps);
    expect(begun.video).toEqual({ id: packUploadIdOf(ownerId, inp.clientId), status: "PENDING" });
    expect(begun.ticket).toBeTruthy();
    expect(begun.upload?.mode).toBe("single");
    if (begun.upload?.mode !== "single") return;
    expect(begun.upload.headers).toEqual({ "Content-Type": "video/mp4" });
    expect(begun.upload.url).toContain(`${keyOf("2026-11-17", inp.clientId)}?len=${SMALL}`);
    expect(begun.hours.remainingSeconds).toBeGreaterThan(0);
    expect(await rowsOf(inp.clientId)).toHaveLength(0);

    // Xin vé lại trong ngày (app tắt giữa chừng): vẫn không ghi gì, cùng id → cùng đường dẫn tệp.
    const again = await beginUploadV2(actor(), inp, deps);
    expect(again.video.id).toBe(begun.video.id);
    expect(again.upload?.mode === "single" && again.upload.url).toBe(begun.upload.url);
    expect(await rowsOf(inp.clientId)).toHaveLength(0);

    // Vé mang đủ thứ để ghi dòng sổ, kể cả đơn đã khớp.
    const claims = verifyPackUploadTicket(begun.ticket!, NOW)!;
    expect([claims.orderId, claims.channelId, claims.orderCode]).toEqual([orderId, channelId, `${TAG}-D1`]);
    expect([claims.dateKey, claims.uploadId, claims.staff]).toEqual(["2026-11-17", null, false]);

    // Chưa tải mà báo xong → không ghi.
    await expectError(completeUploadV2(actor(), begun.ticket, undefined, deps), 409, "NOT_UPLOADED");
    expect(await rowsOf(inp.clientId)).toHaveLength(0);
    expect(flushes).toEqual([]);

    const usedBefore = (await getHoursBalance(ownerId)).usedSeconds; // đọc tươi → đệm số dư đang nhớ số này
    storage.put(keyOf("2026-11-17", inp.clientId), SMALL);
    const done = await completeUploadV2(actor(), begun.ticket, undefined, deps);
    expect(done.video).toEqual({ id: begun.video.id, status: "STORED" });
    expect(done.hours.usedSeconds).toBe(usedBefore + 60);
    expect(flushes).toEqual([1]);

    const rows = await rowsOf(inp.clientId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect([row.id, row.status, row.uploadId]).toEqual([begun.video.id, "STORED", null]);
    expect(row.recordedDate.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(row.objectKey).toBe(keyOf("2026-11-17", inp.clientId));
    expect(row.uploadedAt?.getTime()).toBe(NOW.getTime());
    expect([row.orderId, row.channelId, row.orderCode]).toEqual([orderId, channelId, `${TAG}-D1`]);
    expect([row.recordedById, row.trackingCode, row.kind, row.deviceName]).toEqual([ownerId, `${TAG}-VD1`, "PACK", "Máy thử"]);
    expect(row.recordedAt.getTime()).toBe(inp.recordedAt.getTime());
    expect([row.durationSec, Number(row.sizeBytes), row.width, row.height, row.durationFlag]).toEqual([60, SMALL, 768, 1024, false]);

    // Báo xong LẶP: vẫn một kết quả, không ghi thêm, không cộng giờ lần hai.
    const repeat = await completeUploadV2(actor(), begun.ticket, undefined, deps);
    expect(repeat.video).toEqual(done.video);
    expect(repeat.hours.usedSeconds).toBe(usedBefore + 60);
    expect(flushes).toEqual([1]);
    expect(await rowsOf(inp.clientId)).toHaveLength(1);
    // (Không so với số đọc tươi từ database: NOW của test là ngày cố định, khi mốc gộp giờ theo ngày của DB dev vượt
    // qua ngày đó thì phần "chưa gộp" không còn đếm dòng test — số trong đệm mới là thứ lượt này cần kiểm.)

    // Đã lưu rồi mà xin vé lại → upload = null, không cấp vé (bản 1 cũng trả đúng dòng này).
    const after = await beginUploadV2(actor(), inp, deps);
    expect(after).toMatchObject({ video: { id: begun.video.id, status: "STORED" }, upload: null, ticket: null });
    expect((await beginUpload(actor(), inp, deps)).video).toEqual({ id: begun.video.id, status: "STORED" });
    // Cùng clientId mà khác tệp → 409, như bản 1.
    await expectError(beginUploadV2(actor(), { ...inp, sizeBytes: SMALL + 1 }, deps), 409, "CLIENT_ID_REUSED");
  });

  it("hai lượt báo xong CÙNG LÚC bằng một vé: đúng một dòng, giờ cộng đúng một lần", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter() };
    const inp = input({ clientId: `${TAG}-dua` });
    const begun = await beginUploadV2(actor(), inp, deps);
    storage.put(keyOf("2026-11-17", inp.clientId), SMALL);
    const usedBefore = (await getHoursBalance(ownerId)).usedSeconds;
    const results = await Promise.all([1, 2, 3, 4].map(() => completeUploadV2(actor(), begun.ticket, undefined, deps)));
    expect(results.map((r) => r.video)).toEqual(Array(4).fill({ id: begun.video.id, status: "STORED" }));
    expect(await rowsOf(inp.clientId)).toHaveLength(1);
    expect(storage.objects.has(keyOf("2026-11-17", inp.clientId))).toBe(true);
    expect((await completeUploadV2(actor(), begun.ticket, undefined, deps)).hours.usedSeconds).toBe(usedBefore + 60);
  });

  it("đã có dòng PENDING của BẢN 1 → bản 2 trả đúng dòng đó, ticket = null; app chốt bằng đường bản 1", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const inp = input({ clientId: `${TAG}-ban1` });
    const v1 = await beginUpload(actor(), inp, deps);
    const v2 = await beginUploadV2(actor(), inp, deps);
    expect(v2.ticket).toBeNull();
    expect(v2.video).toEqual({ id: v1.video.id, status: "PENDING" });
    expect(v2.upload?.mode).toBe("single");
    const [row] = await rowsOf(inp.clientId);
    storage.put(row.objectKey, SMALL);
    expect((await completeUpload(actor(), v2.video.id, undefined, deps)).video.status).toBe("STORED");
    expect(await rowsOf(inp.clientId)).toHaveLength(1);
  });

  it("vé bản 2 đã cấp, sau đó clip được mở bằng bản 1 (dòng PENDING) → báo xong bằng vé bị từ chối, tệp thừa bị xóa, dòng bản 1 nguyên vẹn", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter() };
    const inp = input({ clientId: `${TAG}-lan` });
    const v2 = await beginUploadV2(actor(), inp, deps);
    const v1 = await beginUpload(actor(), inp, deps);
    const [row] = await rowsOf(inp.clientId);
    storage.put(keyOf("2026-11-17", inp.clientId), SMALL);
    storage.put(row.objectKey, SMALL);
    await expectError(completeUploadV2(actor(), v2.ticket, undefined, deps), 409, "TICKET_INVALID");
    expect(storage.objects.has(keyOf("2026-11-17", inp.clientId))).toBe(false);
    expect(storage.objects.has(row.objectKey)).toBe(true);
    expect((await rowsOf(inp.clientId)).map((r) => [r.id, r.status])).toEqual([[v1.video.id, "PENDING"]]);
  });

  it("nhân viên KHÔNG dùng được vé của người khác; chủ shop chốt hộ vé của nhân viên thì được, dòng ghi tên người quay", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter() };
    const inp = input({ clientId: `${TAG}-nv` });
    const a = staff(`${TAG}-nv-a`);
    const b = staff(`${TAG}-nv-b`);
    const begun = await beginUploadV2(a, inp, deps);
    expect(verifyPackUploadTicket(begun.ticket!, NOW)).toMatchObject({ userId: a.userId, staff: true });
    storage.put(keyOf("2026-11-17", inp.clientId), SMALL);

    await expectError(completeUploadV2(b, begun.ticket, undefined, deps), 409, "TICKET_INVALID");
    expect(await rowsOf(inp.clientId)).toHaveLength(0);
    expect(storage.objects.has(keyOf("2026-11-17", inp.clientId))).toBe(true);

    expect((await completeUploadV2(actor(), begun.ticket, undefined, deps)).video.status).toBe("STORED");
    expect((await rowsOf(inp.clientId)).map((r) => r.recordedById)).toEqual([a.userId]);

    // Nhân viên khác gọi lại cùng clientId: KHÔNG được cấp vé (id cố định → cấp vé là cho ghi đè tệp của người kia).
    await expectError(beginUploadV2(b, inp, deps), 409, "CLIENT_ID_REUSED");
    // Chính người quay gọi lại → đã lưu.
    expect(await beginUploadV2(a, inp, deps)).toMatchObject({ upload: null, ticket: null });
  });

  it("vé của CHỦ SHOP KHÁC / vé rác / vé phiên quay / vé hết hạn → 409 TICKET_INVALID, không ghi gì, không đụng tệp", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter() };
    const inp = input({ clientId: `${TAG}-chukhac` });
    const begun = await beginUploadV2(actor(), inp, deps);
    const key = keyOf("2026-11-17", inp.clientId);
    storage.put(key, SMALL);
    const calls = storage.calls.length;

    const stranger = { ownerId: `${TAG}-chu-khac`, userId: `${TAG}-chu-khac` };
    await expectError(completeUploadV2(stranger, begun.ticket, undefined, deps), 409, "TICKET_INVALID");
    await expectError(signUploadPartsV2(stranger, begun.ticket, [1], deps), 409, "TICKET_INVALID");
    await expectError(completeUploadV2(actor(), "khong-phai-ve", undefined, deps), 409, "TICKET_INVALID");
    await expectError(completeUploadV2(actor(), undefined, undefined, deps), 409, "TICKET_INVALID");
    await expectError(completeUploadV2(actor(), { ticket: begun.ticket }, undefined, deps), 409, "TICKET_INVALID");
    const session = signPackSessionTicket(
      { userId: ownerId, ownerId, staff: false, pack: true, unbox: true, pilot: false, allowedChannelIds: null },
      { now: NOW }
    );
    await expectError(completeUploadV2(actor(), session.ticket, undefined, deps), 409, "TICKET_INVALID");
    // Vé hết hạn sau 7 ngày.
    const late = { ...deps, now: () => new Date(NOW.getTime() + 8 * 24 * 3600 * 1000) };
    await expectError(completeUploadV2(actor(), begun.ticket, undefined, late), 409, "TICKET_INVALID");

    expect(storage.calls.length).toBe(calls); // chưa lượt nào chạm kho
    expect(storage.objects.has(key)).toBe(true);
    expect(await rowsOf(inp.clientId)).toHaveLength(0);
    // Vé còn hạn (ngày thứ 6) vẫn chốt được — hàng chờ trên điện thoại báo xong muộn.
    const day6 = { ...deps, now: () => new Date(NOW.getTime() + 6 * 24 * 3600 * 1000) };
    expect((await completeUploadV2(actor(), begun.ticket, undefined, day6)).video.status).toBe("STORED");
    // Ngày chia mảnh + đường dẫn theo NGÀY XIN VÉ, không theo ngày báo xong.
    expect((await rowsOf(inp.clientId)).map((r) => r.objectKey)).toEqual([key]);
  });

  it("cỡ tệp trên kho LỆCH cỡ đã báo → xóa tệp, KHÔNG ghi dòng nào; tải lại đúng cỡ thì chốt được", async () => {
    const storage = createFakeStorage();
    const flushes: number[] = [];
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter({ onFlush: (n) => flushes.push(n) }) };
    const inp = input({ clientId: `${TAG}-lech` });
    const begun = await beginUploadV2(actor(), inp, deps);
    const key = keyOf("2026-11-17", inp.clientId);
    storage.put(key, SMALL + 4096);

    await expectError(completeUploadV2(actor(), begun.ticket, undefined, deps), 409, "SIZE_MISMATCH");
    expect(storage.objects.has(key)).toBe(false);
    expect(await rowsOf(inp.clientId)).toHaveLength(0);
    expect(flushes).toEqual([]);

    storage.put(key, SMALL);
    expect((await completeUploadV2(actor(), begun.ticket, undefined, deps)).video.status).toBe("STORED");
    expect(await rowsOf(inp.clientId)).toHaveLength(1);

    // Đã có dòng trỏ vào tệp này mà tệp bị đổi cỡ: báo lỗi nhưng KHÔNG xóa tệp của dòng đã lưu.
    storage.put(key, SMALL + 1);
    await expectError(completeUploadV2(actor(), begun.ticket, undefined, deps), 409, "SIZE_MISMATCH");
    expect(storage.objects.has(key)).toBe(true);
  });

  it("hai vé của cùng một clip xin ở HAI NGÀY: vé thứ hai báo xong → trả dòng đã có, xóa tệp thừa, không xóa tệp của dòng", async () => {
    const storage = createFakeStorage();
    const writer = createPackStoreWriter();
    const inp = input({ clientId: `${TAG}-haingay` });
    const day1 = await beginUploadV2(actor(), inp, { storage, now: () => NOW, writer });
    const day2 = await beginUploadV2(actor(), inp, { storage, now: () => NEXT_DAY, writer });
    expect(day2.video.id).toBe(day1.video.id);
    const k1 = keyOf("2026-11-17", inp.clientId);
    const k2 = keyOf("2026-11-18", inp.clientId);
    storage.put(k1, SMALL);
    storage.put(k2, SMALL);
    expect((await completeUploadV2(actor(), day1.ticket, undefined, { storage, now: () => NEXT_DAY, writer })).video.status).toBe("STORED");
    const second = await completeUploadV2(actor(), day2.ticket, undefined, { storage, now: () => NEXT_DAY, writer });
    expect(second.video).toEqual({ id: day1.video.id, status: "STORED" });
    expect((await rowsOf(inp.clientId)).map((r) => r.objectKey)).toEqual([k1]);
    expect([storage.objects.has(k1), storage.objects.has(k2)]).toEqual([true, false]);
  });

  it("tải theo mảnh bằng vé: ký lại mảnh không đọc database, thiếu mảnh chưa chốt, đủ mảnh thì ghi STORED", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter() };
    const inp = input({ clientId: `${TAG}-manh`, sizeBytes: BIG, durationSec: 900 });
    const plan = planParts(BIG);
    const key = keyOf("2026-11-17", inp.clientId);

    const begun = await beginUploadV2(actor(), inp, deps);
    expect(begun.upload?.mode).toBe("multipart");
    if (begun.upload?.mode !== "multipart") return;
    expect(begun.upload.partSize).toBe(PACK_VIDEO_PART_SIZE_BYTES);
    expect(begun.upload.parts.map((p) => p.partNumber)).toEqual(plan.map((p) => p.partNumber));
    expect(begun.upload.parts[10].url).toContain(`len=${plan[10].size}`);
    const uploadId = verifyPackUploadTicket(begun.ticket!, NOW)!.uploadId!;
    expect(storage.uploads.get(uploadId)?.key).toBe(key);
    expect(await rowsOf(inp.clientId)).toHaveLength(0);

    for (const p of plan.slice(0, 5)) storage.putPart(key, uploadId, p.partNumber, p.size);
    await expectError(completeUploadV2(actor(), begun.ticket, undefined, deps), 409, "PARTS_MISSING");

    const signed = await signUploadPartsV2(actor(), begun.ticket, [6, 7], deps);
    expect(signed.parts.map((p) => p.partNumber)).toEqual([6, 7]);
    expect(signed.parts[0].url).toContain(`uploadId=${uploadId}&partNumber=6`);
    expect(signed.uploadedParts).toEqual([1, 2, 3, 4, 5]);
    expect(signed.expiresAt).toBe(new Date(NOW.getTime() + 15 * 60 * 1000).toISOString());
    await expectError(signUploadPartsV2(actor(), begun.ticket, [0], deps), 400, "BAD_PARTS");
    await expectError(signUploadPartsV2(actor(), begun.ticket, [12], deps), 400, "BAD_PARTS");
    await expectError(signUploadPartsV2(actor(), begun.ticket, [6, 6], deps), 400, "BAD_PARTS");
    await expectError(signUploadPartsV2(actor(), begun.ticket, undefined, deps), 400, "BAD_PARTS");

    // App báo danh sách mảnh sai → kho không ghép được.
    const fake = plan.map((p) => ({ partNumber: p.partNumber, etag: "etag-bia" }));
    await expectError(completeUploadV2(actor(), begun.ticket, fake, deps), 409, "COMPLETE_FAILED");
    await expectError(completeUploadV2(actor(), begun.ticket, "rac", deps), 400, "BAD_PARTS");
    expect(await rowsOf(inp.clientId)).toHaveLength(0);

    for (const p of plan.slice(5)) storage.putPart(key, uploadId, p.partNumber, p.size);
    expect((await completeUploadV2(actor(), begun.ticket, undefined, deps)).video.status).toBe("STORED");
    expect(storage.objects.get(key)).toBe(BIG);
    const [row] = await rowsOf(inp.clientId);
    expect([row.status, row.uploadId, row.durationFlag]).toEqual(["STORED", null, false]);
    // Báo xong lặp sau khi lượt tải theo mảnh đã đóng: tệp đã có → không chốt lại, vẫn STORED.
    expect((await completeUploadV2(actor(), begun.ticket, undefined, deps)).video.status).toBe("STORED");
    expect(storage.calls.filter((c) => c === "completeMultipart")).toHaveLength(2); // 1 lượt hỏng (mảnh bịa) + 1 lượt thật
  });

  it("vé tải một lần không ký mảnh được; kho đã hủy lượt tải theo mảnh → UPLOAD_EXPIRED (app bắt đầu lại)", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter() };
    const one = await beginUploadV2(actor(), input({ clientId: `${TAG}-motlan` }), deps);
    await expectError(signUploadPartsV2(actor(), one.ticket, [1], deps), 409, "UPLOAD_STATE");

    const inp = input({ clientId: `${TAG}-hethan`, sizeBytes: BIG, durationSec: 900 });
    const begun = await beginUploadV2(actor(), inp, deps);
    storage.uploads.clear();
    await expectError(completeUploadV2(actor(), begun.ticket, undefined, deps), 409, "UPLOAD_EXPIRED");
    await expectError(signUploadPartsV2(actor(), begun.ticket, [1], deps), 409, "UPLOAD_EXPIRED");
    // Bắt đầu lại: lượt tải mới, vé mới, vẫn cùng id.
    const fresh = await beginUploadV2(actor(), inp, deps);
    expect(fresh.video.id).toBe(begun.video.id);
    expect(storage.uploads.has(verifyPackUploadTicket(fresh.ticket!, NOW)!.uploadId!)).toBe(true);
    expect(await rowsOf(inp.clientId)).toHaveLength(0);
  });

  it("GHI GỘP: 20 clip báo xong cùng lúc → 20 dòng STORED bằng rất ít câu INSERT, giờ cộng đủ 20 clip", async () => {
    const storage = createFakeStorage();
    const flushes: number[] = [];
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter({ onFlush: (n) => flushes.push(n) }) };
    const inputs = Array.from({ length: 20 }, (_, i) => input({ clientId: `${TAG}-gop-${i}`, durationSec: 30 + i }));
    const begun = await Promise.all(inputs.map((inp) => beginUploadV2(actor(), inp, deps)));
    for (const inp of inputs) storage.put(keyOf("2026-11-17", inp.clientId), SMALL);
    expect(await prisma.packVideo.count({ where: { ownerId, clientId: { startsWith: `${TAG}-gop-` } } })).toBe(0);

    const usedBefore = (await getHoursBalance(ownerId)).usedSeconds;
    const done = await Promise.all(begun.map((b) => completeUploadV2(actor(), b.ticket, undefined, deps)));
    expect(done.map((d) => d.video.status)).toEqual(Array(20).fill("STORED"));
    expect(done.map((d) => d.video.id)).toEqual(begun.map((b) => b.video.id));

    const rows = await prisma.packVideo.findMany({ where: { ownerId, clientId: { startsWith: `${TAG}-gop-` } } });
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.status === "STORED" && r.uploadId === null)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(20);
    // Mỗi dòng mang đúng thời lượng của clip mình (kết quả mẻ ghi về đúng người gọi).
    expect(new Map(rows.map((r) => [r.clientId, r.durationSec]))).toEqual(new Map(inputs.map((i) => [i.clientId, i.durationSec])));

    expect(flushes.reduce((a, b) => a + b, 0)).toBe(20);
    expect(flushes.length).toBeLessThanOrEqual(5); // 20 câu INSERT riêng lẻ ở bản 1
    const total = inputs.reduce((a, i) => a + i.durationSec, 0);
    expect((await getHoursBalanceCached(ownerId)).usedSeconds).toBe(usedBefore + total); // mỗi dòng ghi được cộng đúng một lần
  });

  it("công tắc TẮT: xin vé → 409 V2_OFF (app về bản 1), nhưng vé ĐÃ cấp vẫn ký mảnh / báo xong được", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW, writer: createPackStoreWriter() };
    const inp = input({ clientId: `${TAG}-tat` });
    const begun = await beginUploadV2(actor(), inp, deps);
    process.env.PACK_UPLOAD_V2 = "off";
    try {
      await expectError(beginUploadV2(actor(), input({ clientId: `${TAG}-tat-moi` }), deps), 409, "V2_OFF");
      await expectError(beginUploadV2(actor(), inp, deps), 409, "V2_OFF");
      storage.put(keyOf("2026-11-17", inp.clientId), SMALL);
      expect((await completeUploadV2(actor(), begun.ticket, undefined, deps)).video.status).toBe("STORED");
      // Bản 1 thấy đúng dòng bản 2 vừa ghi.
      expect(await beginUpload(actor(), inp, deps)).toMatchObject({ video: { id: begun.video.id, status: "STORED" }, upload: null });
    } finally {
      process.env.PACK_UPLOAD_V2 = "on";
    }
  });
});
