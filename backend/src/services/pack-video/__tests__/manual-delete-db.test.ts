// ============================================================
// VIDEO ĐÓNG HÀNG — chủ shop TỰ XÓA một video, trên Postgres thật (26/11/2026, lỗ hổng G8).
// Rào kiểm: xóa tệp trên kho rồi mới đánh dấu DELETED + lý do MANUAL · dòng hiện ở Lịch sử xóa, rời danh sách ·
// giờ đã quay KHÔNG cộng lại · video của chủ khác → 404, tệp còn nguyên · video chưa tải xong → 409 ·
// bấm lần hai không gọi kho nữa · kho lỗi thì dòng sổ giữ nguyên STORED.
// Tự tạo dữ liệu rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { R2Error } from "../../../integrations/r2/client";
import { buildPackVideoKey } from "../../../lib/pack-video-key";
import { vnDateKey } from "../../../lib/pack-video-retention";
import { prisma } from "../../../lib/prisma";
import { listDeletedVideos, listVideos } from "../library";
import { MANUAL_DELETE_RULE, deleteVideoByOwner } from "../manual-delete";
import { usedSecondsOf } from "../usage-daily";
import { createFakeStorage } from "./fake-storage";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvm-${Date.now()}`;
const NOW = new Date();
const REC_DATE = vnDateKey(NOW);

describe.skipIf(!dbReady)("Video đóng hàng — chủ shop tự xóa", () => {
  let owner = "";
  let other = "";
  const storage = createFakeStorage();
  let seq = 0;

  async function addVideo(ownerId: string, status: "STORED" | "PENDING", extra: Record<string, unknown> = {}) {
    seq += 1;
    const id = `${TAG.replace(/-/g, "")}v${seq}`;
    const objectKey = buildPackVideoKey({ ownerId, recordedDate: REC_DATE, id });
    await prisma.packVideo.create({
      data: {
        id,
        recordedDate: new Date(`${REC_DATE}T00:00:00.000Z`),
        ownerId,
        clientId: `${TAG}-c${seq}`,
        trackingCode: `${TAG}-T${seq}`,
        kind: "PACK",
        recordedById: ownerId,
        recordedAt: NOW,
        durationSec: 90,
        sizeBytes: BigInt(9_000_000),
        objectKey,
        status,
        uploadedAt: status === "STORED" ? NOW : null,
        ...extra,
      },
    });
    if (status === "STORED") storage.put(objectKey, 9_000_000);
    return { id, objectKey };
  }

  const statusOf = (ownerId: string, id: string) =>
    prisma.packVideo.findFirstOrThrow({
      where: { ownerId, id },
      select: { status: true, deleteRule: true, deletedAt: true, deleteAfter: true, holdReason: true },
    });

  beforeAll(async () => {
    const mk = async (suffix: string) =>
      (
        await prisma.user.create({
          data: { email: `${TAG}-${suffix}@test.local`, passwordHash: "x", fullName: `${TAG} ${suffix}` },
          select: { id: true },
        })
      ).id;
    owner = await mk("a");
    other = await mk("b");
  });

  afterAll(async () => {
    const ids = [owner, other].filter(Boolean);
    if (ids.length === 0) return;
    await prisma.packVideo.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("xóa tệp trên kho, đánh dấu DELETED + MANUAL, hiện ở Lịch sử xóa, giờ đã quay không cộng lại", async () => {
    const v = await addVideo(owner, "STORED", {
      deleteAfter: new Date("2026-12-30T00:00:00.000Z"),
      deleteRule: "L4",
      holdReason: null,
    });
    const usedBefore = await usedSecondsOf(owner);
    expect(usedBefore).toBe(90);

    const res = await deleteVideoByOwner(owner, v.id, { storage, now: () => NOW });
    expect(res).toEqual({ id: v.id, status: "DELETED" });
    expect(storage.objects.has(v.objectKey)).toBe(false);

    const row = await statusOf(owner, v.id);
    expect(row.status).toBe("DELETED");
    expect(row.deleteRule).toBe(MANUAL_DELETE_RULE);
    expect(row.deletedAt?.getTime()).toBe(NOW.getTime());
    expect(row.deleteAfter).toBeNull();

    const scope = { ownerId: owner, allowedChannelIds: null };
    const deleted = await listDeletedVideos(scope, {});
    expect(deleted.items.map((d) => [d.id, d.deleteRule])).toEqual([[v.id, MANUAL_DELETE_RULE]]);
    const live = await listVideos(scope, {}, {});
    expect(live.items.some((x) => x.id === v.id)).toBe(false);

    expect(await usedSecondsOf(owner)).toBe(usedBefore);
  });

  it("bấm lần hai: trả DELETED, không gọi kho nữa", async () => {
    const v = await addVideo(owner, "STORED");
    await deleteVideoByOwner(owner, v.id, { storage });
    const calls = storage.calls.length;
    expect(await deleteVideoByOwner(owner, v.id, { storage })).toEqual({ id: v.id, status: "DELETED" });
    expect(storage.calls.length).toBe(calls);
  });

  it("video của chủ shop khác → 404, tệp và dòng sổ còn nguyên", async () => {
    const v = await addVideo(other, "STORED");
    await expect(deleteVideoByOwner(owner, v.id, { storage })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(storage.objects.has(v.objectKey)).toBe(true);
    expect((await statusOf(other, v.id)).status).toBe("STORED");
  });

  it("video chưa tải lên xong → 409, không gọi lệnh xóa trên kho", async () => {
    const v = await addVideo(owner, "PENDING");
    const removes = storage.calls.filter((c) => c === "remove").length;
    await expect(deleteVideoByOwner(owner, v.id, { storage })).rejects.toMatchObject({ status: 409, code: "NOT_STORED" });
    expect(storage.calls.filter((c) => c === "remove").length).toBe(removes);
    expect((await statusOf(owner, v.id)).status).toBe("PENDING");
  });

  it("kho lỗi lúc xóa tệp → ném lỗi, dòng sổ vẫn STORED để khách bấm lại", async () => {
    const v = await addVideo(owner, "STORED");
    const broken = {
      ...storage,
      remove: async () => {
        throw new R2Error("R2 xóa tệp thất bại (500)", 500, null);
      },
    };
    await expect(deleteVideoByOwner(owner, v.id, { storage: broken })).rejects.toBeInstanceOf(R2Error);
    const row = await statusOf(owner, v.id);
    expect([row.status, row.deleteRule]).toEqual(["STORED", null]);
    expect(storage.objects.has(v.objectKey)).toBe(true);
  });
});
