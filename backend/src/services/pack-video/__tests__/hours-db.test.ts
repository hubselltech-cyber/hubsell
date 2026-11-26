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
import { PACK_VIDEO_WELCOME_HOURS } from "../../../config/pack-video";
import {
  canOpenNewVideo,
  computeBalance,
  ensureWelcomeHours,
  forgetHoursBalance,
  forgetWelcomeAsked,
  getHoursBalance,
  getHoursBalanceCached,
  noteUsedSeconds,
  getHoursOverview,
  grantHours,
  grantPurchasedHours,
  HourPurchaseError,
  welcomeRefOf,
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
    await grantPurchasedHours({ ownerId: ownerA, hours: 1000, amountVnd: 2_000_000, paymentRef: `${TAG}-pay1`, note: "gói thử" });
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
    await grantPurchasedHours({ ownerId: ownerA, hours: 200, amountVnd: 400_000, paymentRef: `${TAG}-pay2` });
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
    const input = { ownerId: ownerA, hours: 50, amountVnd: 100_000, paymentRef: `${TAG}-dup` };
    const [a, b] = await Promise.all([grantPurchasedHours(input), grantPurchasedHours(input)]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.id).toBe(b.id);
    const again = await grantPurchasedHours(input);
    expect(again).toEqual({ id: a.id, created: false });
    expect((await getHoursBalance(ownerA)).purchasedSeconds).toBe(before + 50 * HOUR);
  });

  it("mã khoản tiền của chủ shop A không cộng được giờ cho chủ shop B", async () => {
    await expect(
      grantPurchasedHours({ ownerId: ownerB, hours: 50, amountVnd: 100_000, paymentRef: `${TAG}-dup` })
    ).rejects.toBeInstanceOf(HourPurchaseError);
    expect((await getHoursBalance(ownerB)).purchasedSeconds).toBe(0);
  });

  it("số tiền không khớp số giờ × 2.000 đ → KHÔNG cộng giờ (kể cả tiền theo giá cũ 1.500 đ)", async () => {
    const before = (await getHoursBalance(ownerA)).purchasedSeconds;
    await expect(
      grantPurchasedHours({ ownerId: ownerA, hours: 200, amountVnd: 399_000, paymentRef: `${TAG}-lech` })
    ).rejects.toBeInstanceOf(HourPurchaseError);
    await expect(
      grantPurchasedHours({ ownerId: ownerA, hours: 200, amountVnd: 300_000, paymentRef: `${TAG}-gia-cu` })
    ).rejects.toBeInstanceOf(HourPurchaseError);
    await expect(
      grantPurchasedHours({ ownerId: ownerA, hours: 10, amountVnd: 20_000, paymentRef: `${TAG}-duoi-min` })
    ).rejects.toBeInstanceOf(HourPurchaseError);
    expect((await getHoursBalance(ownerA)).purchasedSeconds).toBe(before);
  });

  it("database cũng chặn dòng PURCHASE thiếu mã khoản tiền (ràng buộc CHECK)", async () => {
    await expect(
      prisma.packHourGrant.create({ data: { id: `${TAG}-x`, ownerId: ownerA, seconds: HOUR, kind: "PURCHASE" } })
    ).rejects.toThrow();
  });

  it("bản tổng quan: đơn giá 2.000 đ, gói sẵn 50 / 200 / 500, tối thiểu 20 giờ, sổ giờ mới nhất trước", async () => {
    const overview = await getHoursOverview(ownerA);
    expect(overview.pricing).toEqual({ priceVnd: 2000, minHours: 20, maxHours: 10_000, presets: [50, 200, 500] });
    expect(overview.salesOpen).toBe(false);
    expect(overview.ledger[0]).toMatchObject({ kind: "PURCHASE", seconds: 50 * HOUR, amountVnd: 100_000 });
    expect(overview.ledger.some((r) => r.kind === "ADJUST" && r.seconds === -50 * HOUR)).toBe(true);
  });

  describe("tặng mỗi chủ shop 2 giờ quay miễn phí, MỘT lần — ensureWelcomeHours", () => {
    let ownerW = "";
    beforeAll(async () => {
      ownerW = (
        await prisma.user.create({
          data: { email: `${TAG}-w@test.local`, passwordHash: "x", fullName: `${TAG}-w` },
          select: { id: true },
        })
      ).id;
    });
    afterAll(async () => {
      if (!ownerW) return;
      await prisma.packHourGrant.deleteMany({ where: { ownerId: ownerW } });
      await prisma.user.delete({ where: { id: ownerW } });
    });

    it("anh Trung chốt 21/11: tặng 2 giờ", () => {
      expect(PACK_VIDEO_WELCOME_HOURS).toBe(2);
    });

    it("chủ shop mới chạm vào lần đầu → có 2 giờ, mở được video mới, sổ giờ ghi một dòng GRANT", async () => {
      forgetWelcomeAsked();
      expect(await getHoursBalance(ownerW)).toEqual({ purchasedSeconds: 0, usedSeconds: 0, remainingSeconds: 0 });
      expect(await ensureWelcomeHours(ownerW)).toBe(true);
      expect(await getHoursBalance(ownerW)).toEqual({ purchasedSeconds: 2 * HOUR, usedSeconds: 0, remainingSeconds: 2 * HOUR });
      expect(await canOpenNewVideo(ownerW, new Date())).toMatchObject({ ok: true });
      const rows = await prisma.packHourGrant.findMany({ where: { ownerId: ownerW } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "GRANT", seconds: 2 * HOUR, amountVnd: null, paymentRef: welcomeRefOf(ownerW) });
      expect(rows[0].note).toBe("Hubsell tặng 2 giờ quay miễn phí");
    });

    it("gọi lại (cùng máy, máy khác) KHÔNG tặng lần hai", async () => {
      expect(await ensureWelcomeHours(ownerW)).toBe(false); // lối tắt trong bộ nhớ
      forgetWelcomeAsked(); // như một máy web khác / máy vừa khởi động lại
      expect(await ensureWelcomeHours(ownerW)).toBe(false);
      expect(await prisma.packHourGrant.count({ where: { ownerId: ownerW } })).toBe(1);
    });

    it("ba request ĐẦU TIÊN tới cùng lúc → đúng một dòng tặng", async () => {
      await prisma.packHourGrant.deleteMany({ where: { ownerId: ownerW } });
      forgetWelcomeAsked();
      const raced = await Promise.all([ensureWelcomeHours(ownerW), ensureWelcomeHours(ownerW), ensureWelcomeHours(ownerW)]);
      expect(raced.filter(Boolean)).toHaveLength(1);
      expect(await prisma.packHourGrant.count({ where: { ownerId: ownerW } })).toBe(1);
    });

    it("giờ tặng cộng dồn với giờ mua; sổ giờ hiện dòng tặng, không có số hóa đơn", async () => {
      await grantPurchasedHours({ ownerId: ownerW, hours: 20, amountVnd: 40_000, paymentRef: `${TAG}-w-pay` });
      const overview = await getHoursOverview(ownerW);
      expect(overview.purchasedSeconds).toBe(22 * HOUR);
      const gift = overview.ledger.find((r) => r.kind === "GRANT");
      expect(gift).toMatchObject({ seconds: 2 * HOUR, amountVnd: null, invoiceNo: null });
    });
  });

  describe("đệm số dư theo chủ shop (M2.3)", () => {
    it("trong hạn đệm KHÔNG đọc lại database; quên đệm thì thấy số mới", async () => {
      const owner = (
        await prisma.user.create({ data: { email: `${TAG}-k@test.local`, passwordHash: "x", fullName: `${TAG}-k` }, select: { id: true } })
      ).id;
      try {
        await grantHours({ ownerId: owner, seconds: 600, kind: "GRANT" });
        expect((await getHoursBalanceCached(owner)).remainingSeconds).toBe(600);
        // Một video lên kho bằng đường KHÁC (máy web khác): đệm của máy này chưa biết.
        await addVideo(owner, 100, "STORED", new Date());
        expect((await getHoursBalanceCached(owner)).remainingSeconds).toBe(600);
        // Đọc tươi thì đúng, và làm mới luôn đệm.
        expect((await getHoursBalance(owner)).remainingSeconds).toBe(500);
        expect((await getHoursBalanceCached(owner)).remainingSeconds).toBe(500);
        // Video lên kho ở CHÍNH máy này: cộng thẳng vào số đã nhớ, không đọc database.
        noteUsedSeconds(owner, 50);
        expect(await getHoursBalanceCached(owner)).toEqual({ purchasedSeconds: 600, usedSeconds: 150, remainingSeconds: 450 });
        // Sổ giờ đổi (tặng thêm) → quên đệm → lượt sau đọc tươi (video 50 giây ở trên chưa có trong sổ nên không tính).
        await grantHours({ ownerId: owner, seconds: 400, kind: "GRANT" });
        expect((await getHoursBalanceCached(owner)).remainingSeconds).toBe(900);
      } finally {
        forgetHoursBalance(owner);
        await prisma.packVideo.deleteMany({ where: { ownerId: owner } });
        await prisma.packHourGrant.deleteMany({ where: { ownerId: owner } });
        await prisma.user.delete({ where: { id: owner } });
      }
    });

    it("đệm báo CÒN giờ → cho mở clip mới dù sổ thật vừa hết (lệch tối đa một hạn đệm); đệm báo HẾT → đọc tươi, không chặn oan người vừa mua", async () => {
      const owner = (
        await prisma.user.create({ data: { email: `${TAG}-m@test.local`, passwordHash: "x", fullName: `${TAG}-m` }, select: { id: true } })
      ).id;
      try {
        const g = await grantHours({ ownerId: owner, seconds: 60, kind: "GRANT" });
        await prisma.packHourGrant.update({ where: { id: g.id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 3600_000) } });
        expect((await getHoursBalanceCached(owner)).remainingSeconds).toBe(60);
        // Máy khác vừa ghi một video 100 giây → sổ thật âm 40, đệm máy này còn nhớ +60.
        await addVideo(owner, 100, "STORED", new Date(Date.now() - 2 * 24 * 3600_000));
        expect((await canOpenNewVideo(owner, new Date())).ok).toBe(true);
        // Hết hạn đệm (ở đây: quên tay) → chặn đúng.
        forgetHoursBalance(owner);
        expect(await canOpenNewVideo(owner, new Date())).toEqual({ ok: false, remainingSeconds: -40 });
        // Đệm đang nhớ số ÂM; máy khác vừa cộng giờ mua thẳng vào sổ (không qua máy này) → vẫn mở được ngay.
        await prisma.packHourGrant.create({ data: { id: `${TAG}-m-buy`, ownerId: owner, seconds: 3600, kind: "GRANT" } });
        expect(await canOpenNewVideo(owner, new Date())).toMatchObject({ ok: true, balance: { remainingSeconds: 3560 } });
      } finally {
        forgetHoursBalance(owner);
        await prisma.packVideo.deleteMany({ where: { ownerId: owner } });
        await prisma.packHourGrant.deleteMany({ where: { ownerId: owner } });
        await prisma.user.delete({ where: { id: owner } });
      }
    });
  });

  describe("hết giờ thì dừng — canOpenNewVideo", () => {
    it("còn giờ → được mở video mới", async () => {
      expect(await canOpenNewVideo(ownerA, new Date())).toMatchObject({ ok: true });
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
        expect(await canOpenNewVideo(ownerC, clipStart)).toMatchObject({ ok: true, balance: { remainingSeconds: -40 } });
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
