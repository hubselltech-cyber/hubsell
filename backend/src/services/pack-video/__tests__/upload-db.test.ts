// ============================================================
// VIDEO ĐÓNG HÀNG — luồng tải lên trên Postgres thật, kho R2 GIẢ (không gọi mạng).
// Rào kiểm ở đây (sổ rủi ro docs/VIDEO-DONG-HANG-THIET-KE.md):
//   D1 gửi lặp clientId không sinh dòng trùng · D5 tem ra hơn một đơn thì không khớp ·
//   D6 ngày chia mảnh theo giờ máy chủ · chốt khi cỡ tệp lệch → xóa tệp, giữ PENDING ·
//   tải theo mảnh: nối lại, thiếu mảnh thì chưa chốt · I1 mỗi dòng ghi đúng số lượt đã hứa.
// Tự tạo chủ shop + gian + đơn riêng rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { PACK_VIDEO_PART_SIZE_BYTES } from "../../../config/pack-video";
import { toBusinessDateKey } from "../../../lib/date-range";
import { planParts, type BeginInput } from "../../../lib/pack-video-rules";
import { prisma } from "../../../lib/prisma";
import { PackVideoError, beginUpload, completeUpload, signUploadParts } from "../upload";
import { createFakeStorage } from "./fake-storage";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvu-${Date.now()}`;
const NOW = new Date("2026-11-16T18:30:00.000Z"); // 01:30 ngày 17/11 giờ VN
const SMALL = 6_500_000;
const BIG = 90_291_111; // clip 15 phút đã thử thật — 11 mảnh

function input(patch: Partial<BeginInput> = {}): BeginInput {
  return {
    clientId: `${TAG}-c1`,
    trackingCode: `${TAG}-VD1`,
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

describe.skipIf(!dbReady)("Video đóng hàng — tải lên", () => {
  let ownerId = "";
  let channelId = "";
  let orderId = "";
  const actor = () => ({ ownerId, userId: ownerId });
  const rowsOf = (clientId: string) => prisma.packVideo.findMany({ where: { ownerId, clientId } });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
      select: { id: true },
    });
    ownerId = user.id;
    const channel = await prisma.channel.create({
      data: { userId: ownerId, channelName: ChannelName.SHOPEE, shopName: TAG },
      select: { id: true },
    });
    channelId = channel.id;
    await prisma.order.createMany({
      data: [
        { channelId, orderCode: `${TAG}-D1`, customerName: "Khách thử", trackingCode: `${TAG}-VD1` },
        // Hai đơn CÙNG mã vận đơn → không được khớp (D5).
        { channelId, orderCode: `${TAG}-D2`, customerName: "Khách thử", trackingCode: `${TAG}-TRUNG` },
        { channelId, orderCode: `${TAG}-D3`, customerName: "Khách thử", trackingCode: `${TAG}-TRUNG` },
        // Đơn hoàn có mã vận đơn chiều hoàn riêng.
        {
          channelId,
          orderCode: `${TAG}-D4`,
          customerName: "Khách thử",
          trackingCode: `${TAG}-VD4`,
          returnTrackingCode: `${TAG}-HOAN4`,
        },
      ],
    });
    orderId = (await prisma.order.findFirstOrThrow({ where: { channelId, orderCode: `${TAG}-D1` } })).id;
  });

  afterAll(async () => {
    if (!ownerId) return;
    await prisma.packVideo.deleteMany({ where: { ownerId } });
    await prisma.order.deleteMany({ where: { channelId } });
    await prisma.channel.deleteMany({ where: { id: channelId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("tải một lần: PENDING → app tải → chốt → STORED; khớp đúng đơn; ngày chia mảnh theo giờ VN của máy chủ", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const begun = await beginUpload(actor(), input(), deps);

    expect(begun.video.status).toBe("PENDING");
    expect(begun.upload?.mode).toBe("single");
    if (begun.upload?.mode !== "single") return;
    expect(begun.upload.headers).toEqual({ "Content-Type": "video/mp4" });
    expect(begun.upload.url).toContain(`len=${SMALL}`);

    const [row] = await rowsOf(input().clientId);
    expect(row.orderId).toBe(orderId);
    expect(row.channelId).toBe(channelId);
    expect(row.orderCode).toBe(`${TAG}-D1`);
    expect(row.recordedById).toBe(ownerId);
    // 18:30 UTC ngày 16 = 01:30 ngày 17 giờ VN.
    expect(toBusinessDateKey(NOW)).toBe("2026-11-17");
    expect(row.recordedDate.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(row.objectKey).toBe(`${ownerId}/2026-11-17/${row.id}.mp4`);
    expect(row.durationFlag).toBe(false);

    // Chưa tải mà báo xong → chưa được ghi STORED.
    await expectError(completeUpload(actor(), row.id, undefined, deps), 409, "NOT_UPLOADED");

    storage.put(row.objectKey, SMALL);
    const done = await completeUpload(actor(), row.id, undefined, deps);
    expect(done.video).toEqual({ id: row.id, status: "STORED" });
    const stored = (await rowsOf(input().clientId))[0];
    expect(stored.status).toBe("STORED");
    expect(stored.uploadedAt?.getTime()).toBe(NOW.getTime());

    // Báo xong lần nữa: vẫn một kết quả, không gọi kho thêm lượt nào.
    const before = storage.calls.length;
    expect((await completeUpload(actor(), row.id, undefined, deps)).video.status).toBe("STORED");
    expect(storage.calls.length).toBe(before);
  });

  it("D1 — gọi lại cùng clientId: KHÔNG sinh dòng thứ hai; đã STORED thì trả upload = null", async () => {
    const storage = createFakeStorage();
    const again = await beginUpload(actor(), input(), { storage, now: () => NOW });
    expect(again.video.status).toBe("STORED");
    expect(again.upload).toBeNull();
    expect(await rowsOf(input().clientId)).toHaveLength(1);
  });

  it("D1 — hai lượt gọi CÙNG LÚC với một clientId mới: vẫn đúng một dòng, cùng một id", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const inp = input({ clientId: `${TAG}-dua`, trackingCode: `${TAG}-KHONGCO` });
    const results = await Promise.all([1, 2, 3, 4].map(() => beginUpload(actor(), inp, deps)));
    expect(new Set(results.map((r) => r.video.id)).size).toBe(1);
    expect(await rowsOf(inp.clientId)).toHaveLength(1);
  });

  it("D1 — gọi lại vắt qua nửa đêm (ngày máy chủ đã sang hôm sau) vẫn ra dòng cũ", async () => {
    const storage = createFakeStorage();
    const inp = input({ clientId: `${TAG}-dem`, trackingCode: `${TAG}-KHONGCO` });
    const first = await beginUpload(actor(), inp, { storage, now: () => new Date("2026-11-17T16:59:00.000Z") });
    const second = await beginUpload(actor(), inp, { storage, now: () => new Date("2026-11-17T17:01:00.000Z") });
    expect(second.video.id).toBe(first.video.id);
    expect(await rowsOf(inp.clientId)).toHaveLength(1);
  });

  it("cùng clientId mà khác tệp → 409, không ghi đè video đã có", async () => {
    const storage = createFakeStorage();
    await expectError(
      beginUpload(actor(), input({ sizeBytes: SMALL + 1 }), { storage, now: () => NOW }),
      409,
      "CLIENT_ID_REUSED"
    );
  });

  it("D5 — mã vận đơn ra HAI đơn → không khớp đơn nào; mã lạ → cũng không khớp", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    await beginUpload(actor(), input({ clientId: `${TAG}-trung`, trackingCode: `${TAG}-TRUNG` }), deps);
    await beginUpload(actor(), input({ clientId: `${TAG}-la`, trackingCode: `${TAG}-MALA` }), deps);
    for (const c of [`${TAG}-trung`, `${TAG}-la`]) {
      const [row] = await rowsOf(c);
      expect([row.orderId, row.channelId, row.orderCode]).toEqual([null, null, null]);
    }
  });

  it("video KHUI: khớp được bằng mã vận đơn chiều hoàn; video ĐÓNG thì không", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const code = `${TAG}-HOAN4`;
    await beginUpload(actor(), input({ clientId: `${TAG}-khui`, trackingCode: code, kind: "UNBOX" }), deps);
    await beginUpload(actor(), input({ clientId: `${TAG}-dong`, trackingCode: code, kind: "PACK" }), deps);
    expect((await rowsOf(`${TAG}-khui`))[0].orderCode).toBe(`${TAG}-D4`);
    expect((await rowsOf(`${TAG}-dong`))[0].orderId).toBeNull();
  });

  it("chốt khi cỡ tệp trên kho LỆCH cỡ đã báo → xóa tệp, dòng vẫn PENDING, trả 409", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const inp = input({ clientId: `${TAG}-lech`, trackingCode: `${TAG}-KHONGCO` });
    const begun = await beginUpload(actor(), inp, deps);
    const [row] = await rowsOf(inp.clientId);
    storage.put(row.objectKey, SMALL + 4096);

    await expectError(completeUpload(actor(), begun.video.id, undefined, deps), 409, "SIZE_MISMATCH");
    expect(storage.objects.has(row.objectKey)).toBe(false);
    expect((await rowsOf(inp.clientId))[0].status).toBe("PENDING");

    // Tải lại đúng cỡ thì chốt được.
    storage.put(row.objectKey, SMALL);
    expect((await completeUpload(actor(), begun.video.id, undefined, deps)).video.status).toBe("STORED");
  });

  it("thời lượng báo lệch cỡ tệp → gắn cờ durationFlag, không từ chối", async () => {
    const storage = createFakeStorage();
    const inp = input({ clientId: `${TAG}-co`, trackingCode: `${TAG}-KHONGCO`, durationSec: 900 });
    await beginUpload(actor(), inp, { storage, now: () => NOW });
    expect((await rowsOf(inp.clientId))[0].durationFlag).toBe(true);
  });

  it("tải theo mảnh: ký đủ mảnh, tắt giữa chừng rồi gọi lại thì biết mảnh nào đã có, đủ mảnh mới chốt", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const inp = input({ clientId: `${TAG}-manh`, trackingCode: `${TAG}-KHONGCO`, sizeBytes: BIG, durationSec: 900 });
    const plan = planParts(BIG);

    const begun = await beginUpload(actor(), inp, deps);
    expect(begun.upload?.mode).toBe("multipart");
    if (begun.upload?.mode !== "multipart") return;
    expect(begun.upload.partSize).toBe(PACK_VIDEO_PART_SIZE_BYTES);
    expect(begun.upload.parts.map((p) => p.partNumber)).toEqual(plan.map((p) => p.partNumber));
    // Mỗi mảnh được ký đúng cỡ của nó (mảnh cuối là phần dư).
    expect(begun.upload.parts[10].url).toContain(`len=${plan[10].size}`);
    expect(begun.upload.uploadedParts).toBeUndefined();

    const [row] = await rowsOf(inp.clientId);
    const uploadId = row.uploadId!;
    expect(uploadId).toBeTruthy();
    for (const p of plan.slice(0, 5)) storage.putPart(row.objectKey, uploadId, p.partNumber, p.size);

    // Thiếu mảnh mà báo xong → chưa chốt.
    await expectError(completeUpload(actor(), row.id, undefined, deps), 409, "PARTS_MISSING");

    // "Tắt app, mở lại": gọi lại cùng clientId → cùng lượt tải, biết 5 mảnh đã có.
    const resumed = await beginUpload(actor(), inp, deps);
    expect(resumed.video.id).toBe(row.id);
    expect(resumed.upload?.mode === "multipart" && resumed.upload.uploadedParts).toEqual([1, 2, 3, 4, 5]);
    expect(storage.uploads.size).toBe(1); // không mở lượt tải thứ hai
    expect((await rowsOf(inp.clientId))[0].uploadId).toBe(uploadId);

    // Xin ký lại riêng mảnh 6, 7.
    const signed = await signUploadParts(actor(), row.id, [6, 7], deps);
    expect(signed.parts.map((p) => p.partNumber)).toEqual([6, 7]);
    expect(signed.uploadedParts).toEqual([1, 2, 3, 4, 5]);
    await expectError(signUploadParts(actor(), row.id, [0], deps), 400, "BAD_PARTS");
    await expectError(signUploadParts(actor(), row.id, [12], deps), 400, "BAD_PARTS");
    await expectError(signUploadParts(actor(), row.id, [6, 6], deps), 400, "BAD_PARTS");

    for (const p of plan.slice(5)) storage.putPart(row.objectKey, uploadId, p.partNumber, p.size);
    const done = await completeUpload(actor(), row.id, undefined, deps);
    expect(done.video.status).toBe("STORED");
    expect(storage.objects.get(row.objectKey)).toBe(BIG);
    const stored = (await rowsOf(inp.clientId))[0];
    expect([stored.status, stored.uploadId]).toEqual(["STORED", null]);
  });

  it("chốt lượt tải theo mảnh đã ghép xong nhưng sổ chưa ghi (lần trước hỏng giữa chừng) → vẫn ra STORED", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const inp = input({ clientId: `${TAG}-ghep`, trackingCode: `${TAG}-KHONGCO`, sizeBytes: BIG, durationSec: 900 });
    await beginUpload(actor(), inp, deps);
    const [row] = await rowsOf(inp.clientId);
    // Kho đã có tệp ghép xong, lượt tải đã biến mất — đúng trạng thái sau một lần chốt hỏng ở bước ghi sổ.
    storage.uploads.clear();
    storage.put(row.objectKey, BIG);
    expect((await completeUpload(actor(), row.id, undefined, deps)).video.status).toBe("STORED");
    expect(storage.calls).not.toContain("completeMultipart");
  });

  it("kho đã hủy lượt tải theo mảnh bỏ dở: chốt / ký lại báo UPLOAD_EXPIRED, gọi lại bước bắt đầu thì mở lượt mới", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const inp = input({ clientId: `${TAG}-hethan`, trackingCode: `${TAG}-KHONGCO`, sizeBytes: BIG, durationSec: 900 });
    const begun = await beginUpload(actor(), inp, deps);
    const old = (await rowsOf(inp.clientId))[0].uploadId!;
    storage.uploads.clear(); // kho tự hủy lượt bỏ dở

    await expectError(completeUpload(actor(), begun.video.id, undefined, deps), 409, "UPLOAD_EXPIRED");
    await expectError(signUploadParts(actor(), begun.video.id, [1], deps), 409, "UPLOAD_EXPIRED");

    const again = await beginUpload(actor(), inp, deps);
    expect(again.video.id).toBe(begun.video.id);
    expect(again.upload?.mode === "multipart" && again.upload.uploadedParts).toEqual([]);
    const fresh = (await rowsOf(inp.clientId))[0].uploadId!;
    expect(fresh).not.toBe(old);
    expect(storage.uploads.has(fresh)).toBe(true);
    expect(await rowsOf(inp.clientId)).toHaveLength(1);
  });

  it("app báo danh sách mảnh sai (mảnh kho không có) → 409 COMPLETE_FAILED, dòng vẫn PENDING", async () => {
    const storage = createFakeStorage();
    const deps = { storage, now: () => NOW };
    const inp = input({ clientId: `${TAG}-saimanh`, trackingCode: `${TAG}-KHONGCO`, sizeBytes: BIG, durationSec: 900 });
    const begun = await beginUpload(actor(), inp, deps);
    const fake = planParts(BIG).map((p) => ({ partNumber: p.partNumber, etag: "etag-bia" }));
    await expectError(completeUpload(actor(), begun.video.id, fake, deps), 409, "COMPLETE_FAILED");
    await expectError(completeUpload(actor(), begun.video.id, [{ partNumber: 1 }], deps), 400, "BAD_PARTS");
    await expectError(completeUpload(actor(), begun.video.id, "rac", deps), 400, "BAD_PARTS");
    expect((await rowsOf(inp.clientId))[0].status).toBe("PENDING");
  });

  it("id không tồn tại → 404", async () => {
    const storage = createFakeStorage();
    await expectError(completeUpload(actor(), "khong-co", undefined, { storage }), 404, "NOT_FOUND");
    await expectError(signUploadParts(actor(), "khong-co", [1], { storage }), 404, "NOT_FOUND");
  });
});
