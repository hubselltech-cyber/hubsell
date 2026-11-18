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
import {
  canOpenNewVideo,
  computeBalance,
  getHoursBalance,
  getHoursOverview,
  grantHours,
  grantPurchasedHours,
  HourPurchaseError,
} from "../hours";

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
  async function addVideo(ownerId: string, durationSec: number, status: string, uploadedAt?: Date): Promise<void> {
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
        uploadedAt: uploadedAt ?? (status === "STORED" ? now : null),
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
    await grantPurchasedHours({ ownerId: ownerA, hours: 1000, amountVnd: 1_500_000, paymentRef: `${TAG}-pay1`, note: "gói thử" });
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
    await grantPurchasedHours({ ownerId: ownerA, hours: 200, amountVnd: 300_000, paymentRef: `${TAG}-pay2` });
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

  it("cùng một khoản tiền (webhook bắn hai lần / poll đua webhook) chỉ cộng giờ MỘT lần", async () => {
    const before = (await getHoursBalance(ownerA)).purchasedSeconds;
    const input = { ownerId: ownerA, hours: 50, amountVnd: 75_000, paymentRef: `${TAG}-dup` };
    const [a, b] = await Promise.all([grantPurchasedHours(input), grantPurchasedHours(input)]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.id).toBe(b.id);
    const again = await grantPurchasedHours(input);
    expect(again).toEqual({ id: a.id, created: false });
    expect((await getHoursBalance(ownerA)).purchasedSeconds).toBe(before + 50 * HOUR);
  });

  it("mã khoản tiền của chủ shop A không cộng được giờ cho chủ shop B", async () => {
    await expect(
      grantPurchasedHours({ ownerId: ownerB, hours: 50, amountVnd: 75_000, paymentRef: `${TAG}-dup` })
    ).rejects.toBeInstanceOf(HourPurchaseError);
    expect((await getHoursBalance(ownerB)).purchasedSeconds).toBe(0);
  });

  it("số tiền không khớp số giờ × 1.500 đ → KHÔNG cộng giờ", async () => {
    const before = (await getHoursBalance(ownerA)).purchasedSeconds;
    await expect(
      grantPurchasedHours({ ownerId: ownerA, hours: 200, amountVnd: 299_000, paymentRef: `${TAG}-lech` })
    ).rejects.toBeInstanceOf(HourPurchaseError);
    await expect(
      grantPurchasedHours({ ownerId: ownerA, hours: 10, amountVnd: 15_000, paymentRef: `${TAG}-duoi-min` })
    ).rejects.toBeInstanceOf(HourPurchaseError);
    expect((await getHoursBalance(ownerA)).purchasedSeconds).toBe(before);
  });

  it("database cũng chặn dòng PURCHASE thiếu mã khoản tiền (ràng buộc CHECK)", async () => {
    await expect(
      prisma.packHourGrant.create({ data: { id: `${TAG}-x`, ownerId: ownerA, seconds: HOUR, kind: "PURCHASE" } })
    ).rejects.toThrow();
  });

  it("bản tổng quan: đơn giá 1.500 đ, gói sẵn 50 / 200 / 500, tối thiểu 20 giờ, sổ giờ mới nhất trước", async () => {
    const overview = await getHoursOverview(ownerA);
    expect(overview.pricing).toEqual({ priceVnd: 1500, minHours: 20, maxHours: 10_000, presets: [50, 200, 500] });
    expect(overview.salesOpen).toBe(false);
    expect(overview.ledger[0]).toMatchObject({ kind: "PURCHASE", seconds: 50 * HOUR, amountVnd: 75_000 });
    expect(overview.ledger.some((r) => r.kind === "ADJUST" && r.seconds === -50 * HOUR)).toBe(true);
  });

  describe("hết giờ thì dừng — canOpenNewVideo", () => {
    it("còn giờ → được mở video mới", async () => {
      expect(await canOpenNewVideo(ownerA, new Date())).toEqual({ ok: true });
    });

    it("số dư ≤ 0 → không mở được video mới (B đang âm 90 giây)", async () => {
      const r = await canOpenNewVideo(ownerB, new Date());
      expect(r).toEqual({ ok: false, remainingSeconds: -90 });
    });

    it("clip BẮT ĐẦU lúc còn giờ, kết thúc sau khi hết → vẫn được tải lên (quay nốt)", async () => {
      // C được tặng 60 giây; clip bắt đầu lúc còn 60 giây, trong lúc đó một clip 100 giây khác lên làm hết giờ.
      const ownerC = (
        await prisma.user.create({
          data: { email: `${TAG}-c@test.local`, passwordHash: "x", fullName: `${TAG}-c` },
          select: { id: true },
        })
      ).id;
      try {
        const g = await grantHours({ ownerId: ownerC, seconds: 60, kind: "GRANT" });
        // Giờ được cộng từ hôm qua — trước lúc clip bắt đầu.
        await prisma.packHourGrant.update({ where: { id: g.id }, data: { createdAt: new Date(Date.now() - 24 * 3600_000) } });
        const clipStart = new Date(Date.now() - 5 * 60_000);
        await addVideo(ownerC, 100, "STORED", new Date()); // tải lên SAU lúc clip kia bắt đầu
        expect((await getHoursBalance(ownerC)).remainingSeconds).toBe(-40);
        expect(await canOpenNewVideo(ownerC, clipStart)).toEqual({ ok: true });
        // Clip bắt đầu SAU lúc hết giờ → chặn.
        expect((await canOpenNewVideo(ownerC, new Date())).ok).toBe(false);
        // Giờ bắt đầu lùi quá xa (khai man) → không được coi là đang quay dở.
        expect((await canOpenNewVideo(ownerC, new Date(Date.now() - 3 * 24 * 3600_000))).ok).toBe(false);
      } finally {
        await prisma.packVideo.deleteMany({ where: { ownerId: ownerC } });
        await prisma.packHourGrant.deleteMany({ where: { ownerId: ownerC } });
        await prisma.user.delete({ where: { id: ownerC } });
      }
    });
  });
});
