// ============================================================
// VIDEO ĐÓNG HÀNG — số giờ quay (đã mua · đã quay · còn lại) trên Postgres thật.
// Rào kiểm: ví dụ của anh Trung 16/11 (mua 1.000 giờ, quay 400 → còn 600) · chỉ video ĐÃ LƯU mới
// tính giờ (PENDING / LOST không tính, DELETED vẫn tính) · số dư được ÂM · chủ shop này không
// thấy giờ của chủ shop khác · sổ chỉ chèn, điều chỉnh bằng dòng ngược dấu.
// Tự tạo hai chủ shop rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toBusinessDateKey } from "../../../lib/date-range";
import { prisma } from "../../../lib/prisma";
import { computeBalance, getHoursBalance, getHoursOverview, grantHours } from "../hours";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_hour_grants" LIMIT 1`;
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvh-${Date.now()}`;
const HOUR = 3600;

describe("computeBalance (thuần)", () => {
  it("mua 1.000 giờ, quay 400 giờ → còn 600 giờ", () => {
    expect(computeBalance(1000 * HOUR, 400 * HOUR)).toEqual({
      purchasedSeconds: 1000 * HOUR,
      usedSeconds: 400 * HOUR,
      remainingSeconds: 600 * HOUR,
    });
  });

  it("quay lố thì số dư âm, không bị kẹp về 0", () => {
    expect(computeBalance(10 * HOUR, 10 * HOUR + 90).remainingSeconds).toBe(-90);
  });

  it("chưa mua gì, chưa quay gì → cả ba số bằng 0", () => {
    expect(computeBalance(0, 0)).toEqual({ purchasedSeconds: 0, usedSeconds: 0, remainingSeconds: 0 });
  });
});

describe.skipIf(!dbReady)("Video đóng hàng — số giờ quay", () => {
  let ownerA = "";
  let ownerB = "";
  let seq = 0;

  /** Chèn thẳng một dòng sổ video — test này chỉ quan tâm phép cộng giờ, không đi qua luồng tải lên. */
  async function addVideo(ownerId: string, durationSec: number, status: string): Promise<void> {
    seq += 1;
    const now = new Date();
    await prisma.packVideo.create({
      data: {
        id: `${TAG}-v${seq}`,
        recordedDate: new Date(`${toBusinessDateKey(now)}T00:00:00.000Z`),
        ownerId,
        clientId: `${TAG}-c${seq}`,
        trackingCode: `${TAG}-VD${seq}`,
        kind: "PACK",
        recordedById: ownerId,
        recordedAt: now,
        durationSec,
        sizeBytes: BigInt(1_000_000),
        objectKey: `${ownerId}/thu/${TAG}-v${seq}.mp4`,
        status,
      },
    });
  }

  beforeAll(async () => {
    const [a, b] = await Promise.all(
      ["a", "b"].map((s) =>
        prisma.user.create({
          data: { email: `${TAG}-${s}@test.local`, passwordHash: "x", fullName: `${TAG}-${s}` },
          select: { id: true },
        })
      )
    );
    ownerA = a.id;
    ownerB = b.id;
  });

  afterAll(async () => {
    const owners = [ownerA, ownerB].filter(Boolean);
    if (!owners.length) return;
    await prisma.packVideo.deleteMany({ where: { ownerId: { in: owners } } });
    await prisma.packHourGrant.deleteMany({ where: { ownerId: { in: owners } } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } });
  });

  it("chủ shop mới: chưa mua, chưa quay → 0 / 0 / 0", async () => {
    expect(await getHoursBalance(ownerA)).toEqual({ purchasedSeconds: 0, usedSeconds: 0, remainingSeconds: 0 });
  });

  it("mua 1.000 giờ rồi quay 400 giờ → còn 600 giờ; chỉ video đã lưu mới tính", async () => {
    await grantHours({ ownerId: ownerA, seconds: 1000 * HOUR, kind: "PURCHASE", note: "gói thử" });
    await addVideo(ownerA, 300 * HOUR, "STORED");
    await addVideo(ownerA, 100 * HOUR, "DELETED"); // đã xóa vì hết hạn giữ — giờ đã dùng vẫn tính
    await addVideo(ownerA, 50 * HOUR, "PENDING"); // quay xong chưa tải lên — chưa tính
    await addVideo(ownerA, 25 * HOUR, "LOST"); // mất trước khi lên kho — không tính

    expect(await getHoursBalance(ownerA)).toEqual({
      purchasedSeconds: 1000 * HOUR,
      usedSeconds: 400 * HOUR,
      remainingSeconds: 600 * HOUR,
    });
  });

  it("mua thêm thì cộng dồn; điều chỉnh là một dòng ngược dấu, không sửa dòng cũ", async () => {
    await grantHours({ ownerId: ownerA, seconds: 200 * HOUR, kind: "PURCHASE" });
    await grantHours({ ownerId: ownerA, seconds: -50 * HOUR, kind: "ADJUST", note: "cộng nhầm" });

    const balance = await getHoursBalance(ownerA);
    expect(balance.purchasedSeconds).toBe(1150 * HOUR);
    expect(balance.remainingSeconds).toBe(750 * HOUR);
    expect(await prisma.packHourGrant.count({ where: { ownerId: ownerA } })).toBe(3);
  });

  it("chủ shop khác không dính giờ của nhau; quay khi chưa mua thì số dư âm", async () => {
    await addVideo(ownerB, 90, "STORED");
    expect(await getHoursBalance(ownerB)).toEqual({ purchasedSeconds: 0, usedSeconds: 90, remainingSeconds: -90 });
    // Số của A không đổi vì video của B.
    expect((await getHoursBalance(ownerA)).usedSeconds).toBe(400 * HOUR);
  });

  it("không nhận 0 giây, số lẻ hay loại lạ", async () => {
    await expect(grantHours({ ownerId: ownerA, seconds: 0, kind: "GRANT" })).rejects.toThrow();
    await expect(grantHours({ ownerId: ownerA, seconds: 1.5, kind: "GRANT" })).rejects.toThrow();
    await expect(grantHours({ ownerId: ownerA, seconds: 60, kind: "TANG" as never })).rejects.toThrow();
  });

  it("bản tổng quan kèm các gói giờ; giá chưa chốt thì để trống, không bịa số", async () => {
    const overview = await getHoursOverview(ownerA);
    expect(overview.remainingSeconds).toBe(750 * HOUR);
    expect(overview.packages.map((p) => p.hours)).toEqual([100, 200]);
    expect(overview.packages.every((p) => p.priceVnd === null)).toBe(true);
    expect(overview.salesOpen).toBe(false);
  });
});
