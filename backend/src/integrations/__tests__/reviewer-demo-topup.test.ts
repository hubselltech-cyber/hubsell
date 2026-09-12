// ============================================================
// WORKER BỒI ĐƠN TÀI KHOẢN REVIEWER ISV — TEST VÒNG ĐỜI + AN TOÀN
//
// Dựng một user demo riêng (email TEST-…) với 2 gian KHÔNG token + 3 SKU, cắm
// đơn ở từng trạng thái với tuổi ép sẵn, chạy runReviewerDemoTopup(now cố định)
// rồi kiểm:
//   1. Già hóa đúng bậc: PENDING 5h → PROCESSED (có packedAt + mã vận đơn);
//      PROCESSED đóng gói 12h trước → SHIPPING/CANCELLED; SHIPPING 4 ngày →
//      DELIVERED; DELIVERED 3 ngày chưa đối soát → isSettled + phí + ví cộng tiền;
//      hoàn AWAITING 8 ngày → về kho (returnedAt) ở một công đoạn hợp lệ.
//   2. Bồi đơn hôm nay đúng tỷ lệ giờ đã trôi, chạy lại KHÔNG tạo thêm
//      (idempotent theo mục tiêu), mã đơn không trùng, AdSpend hôm nay có dòng.
//   3. Ngày bù có cả 2 sàn theo tỷ lệ ~64/36; ngày -2 cắm 30 đơn kiểu worker
//      toàn Lazada (sự cố băm 12/09) → tự cân lại về ≥55% Shopee, đổi mã đơn
//      + hãng vận chuyển theo sàn mới; đơn seed (mã khác khuôn) không bị đụng.
//   4. Gian có refreshToken (gian thật) → worker bỏ qua hoàn toàn (trả null).
//   5. Email không tồn tại → null.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, Prisma, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { runReviewerDemoTopup, dailyTarget, dayProgress, vnMidnightUtc } from "../../workers/reviewer-demo-topup";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const suffix = `revdemo-${Date.now()}`;
const EMAIL = `test-${suffix}@hubsell.test`;

// "Bây giờ" cố định: 15h00 giờ VN hôm nay (UTC+7) → progress = (15-7,5)/15 = 0,5
const NOW = new Date(vnMidnightUtc(new Date()).getTime() + 15 * HOUR);
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let userId: string;
let shopeeId: string;
let lazadaId: string;
let productIds: string[] = [];
const seeded: Record<string, string> = {};

async function seedOrder(key: string, channelId: string, data: Partial<Prisma.OrderUncheckedCreateInput>) {
  const o = await prisma.order.create({
    data: {
      channelId,
      orderCode: `TEST-${suffix}-${key}`,
      customerName: "Khách test",
      totalAmount: 250_000,
      paymentStatus: "PAID",
      itemCount: 1,
      items: { create: { productId: productIds[0], channelSku: "TEST-SKU", productName: "SP test", quantity: 1, price: 250_000 } },
      ...data,
    },
  });
  seeded[key] = o.id;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: "x", fullName: `TEST ${suffix}`, role: "ADMIN" },
  });
  userId = user.id;
  const [sh, lz] = await Promise.all([
    prisma.channel.create({ data: { userId, channelName: ChannelName.SHOPEE, shopName: `TEST-${suffix}`, apiToken: "shp_test", status: "ACTIVE", walletBalance: 1_000_000 } }),
    prisma.channel.create({ data: { userId, channelName: ChannelName.LAZADA, shopName: `TEST-${suffix}`, apiToken: "laz_test", status: "ACTIVE", walletBalance: 500_000 } }),
  ]);
  shopeeId = sh.id;
  lazadaId = lz.id;
  for (let i = 1; i <= 3; i++) {
    const p = await prisma.product.create({
      data: { userId, skuCode: `TEST-${suffix}-SKU${i}`, productName: `SP test ${i}`, sellingPrice: 150_000 * i, costPrice: 60_000 * i, quantityInStock: 50 },
    });
    productIds.push(p.id);
  }

  // Lịch sử 7 ngày trước: 10 đơn/ngày đã giao + đối soát → trung bình 10
  // (ngày -4 cố ý TRỐNG để kiểm bồi bù; ngày trống không kéo tụt trung bình).
  for (let d = 1; d <= 7; d++) {
    if (d === 4) continue;
    for (let i = 0; i < 10; i++) {
      await seedOrder(`hist-${d}-${i}`, i % 2 ? shopeeId : lazadaId, {
        createdAt: ago(d * DAY + i * HOUR),
        shippingStatus: ShippingStatus.DELIVERED,
        deliveredAt: ago(d * DAY - 2 * HOUR),
        isSettled: true,
        settledAt: ago(d * DAY - 3 * HOUR),
      });
    }
  }
  // Các đơn cần già hóa
  await seedOrder("pending-old", shopeeId, { createdAt: ago(5 * HOUR), shippingStatus: ShippingStatus.PENDING });
  await seedOrder("pending-fresh", shopeeId, { createdAt: ago(1 * HOUR), shippingStatus: ShippingStatus.PENDING });
  await seedOrder("processed-old", lazadaId, { createdAt: ago(20 * HOUR), packedAt: ago(12 * HOUR), shippingStatus: ShippingStatus.PROCESSED, trackingCode: "X" });
  await seedOrder("shipping-old", shopeeId, { createdAt: ago(3.5 * DAY), packedAt: ago(3.5 * DAY), shippingStatus: ShippingStatus.SHIPPING, trackingCode: "X" });
  await seedOrder("delivered-unsettled", lazadaId, { createdAt: ago(6 * DAY), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: ago(3 * DAY), isSettled: false, totalAmount: 400_000 });
  // Ngày -2: 30 đơn kiểu worker (mã 15 số) dồn hết Lazada → phải được cân lại.
  for (let i = 0; i < 30; i++) {
    await seedOrder(`skew-${i}`, lazadaId, {
      orderCode: `${100_000_000_000_000 + i * 7919}`,
      createdAt: ago(2 * DAY + (i % 12) * HOUR),
      shippingStatus: ShippingStatus.SHIPPING, packedAt: ago(2 * DAY), trackingCode: `LEXVN0${i}`,
    });
  }
  await seedOrder("return-awaiting", shopeeId, {
    createdAt: ago(14 * DAY), shippingStatus: ShippingStatus.DELIVERED, deliveredAt: ago(11 * DAY), isSettled: true,
    returnStatus: ReturnStatus.AWAITING, returnRequestedAt: ago(8 * DAY),
  });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
});

describe("hàm thuần", () => {
  it("dayProgress: 15h VN = nửa khung 7h30-22h30; trước 7h30 = 0; sau 22h30 = 1", () => {
    expect(dayProgress(NOW)).toBeCloseTo(0.5, 5);
    expect(dayProgress(new Date(vnMidnightUtc(NOW).getTime() + 6 * HOUR))).toBe(0);
    expect(dayProgress(new Date(vnMidnightUtc(NOW).getTime() + 23 * HOUR))).toBe(1);
  });
  it("dailyTarget tất định theo ngày, không dưới sàn 30 và bám trung bình 7 ngày", () => {
    expect(dailyTarget("2026-09-14", 80)).toBe(dailyTarget("2026-09-14", 80));
    expect(dailyTarget("2026-09-14", 1)).toBe(30);
    const t = dailyTarget("2026-09-16", 80); // thứ 4
    expect(t).toBeGreaterThanOrEqual(Math.round(80 * 0.96 * 0.96));
    expect(t).toBeLessThanOrEqual(Math.round(80 * 1.08 * 0.96));
  });
});

describe("runReviewerDemoTopup", () => {
  it("email không tồn tại → null", async () => {
    expect(await runReviewerDemoTopup({ email: `khong-co-${suffix}@hubsell.test`, now: NOW })).toBeNull();
  });

  it("già hóa đúng bậc + bồi đơn theo giờ đã trôi + ads hôm nay", async () => {
    const walletBefore = Number((await prisma.channel.findUniqueOrThrow({ where: { id: lazadaId } })).walletBalance);
    const s = await runReviewerDemoTopup({ email: EMAIL, now: NOW });
    expect(s).not.toBeNull();

    const get = (key: string) => prisma.order.findUniqueOrThrow({ where: { id: seeded[key] } });

    const pendingOld = await get("pending-old");
    expect(pendingOld.shippingStatus).toBe(ShippingStatus.PROCESSED);
    expect(pendingOld.packedAt).not.toBeNull();
    expect(pendingOld.trackingCode).toMatch(/^SPXVN0/);
    expect((await get("pending-fresh")).shippingStatus).toBe(ShippingStatus.PENDING);

    expect([ShippingStatus.SHIPPING, ShippingStatus.CANCELLED]).toContain((await get("processed-old")).shippingStatus);

    const shipped = await get("shipping-old");
    expect(shipped.shippingStatus).toBe(ShippingStatus.DELIVERED);
    expect(shipped.deliveredAt!.getTime()).toBeGreaterThan(shipped.createdAt.getTime() + 1.5 * DAY - 1);
    expect(shipped.deliveredAt!.getTime()).toBeLessThanOrEqual(NOW.getTime());

    const settled = await get("delivered-unsettled");
    expect(settled.isSettled).toBe(true);
    expect(Number(settled.fixedFee)).toBe(Math.round(400_000 * 0.03)); // Lazada 3%
    expect(Number(settled.actualPayout)).toBeGreaterThan(0);
    expect(Number(settled.actualPayout)).toBeLessThan(400_000);
    // Ví Lazada cộng ít nhất tiền đối soát của đơn này (đơn bù ngày -4 có thể cùng về ví).
    const walletAfter = Number((await prisma.channel.findUniqueOrThrow({ where: { id: lazadaId } })).walletBalance);
    expect(walletAfter - walletBefore).toBeGreaterThanOrEqual(Number(settled.actualPayout) - 1);

    // Ngày -4 trống → được bù trọn ngày (mục tiêu sàn 30) và đã già hóa qua PENDING.
    const day4Start = vnMidnightUtc(ago(4 * DAY));
    const day4 = await prisma.order.findMany({ where: { channelId: { in: [shopeeId, lazadaId] }, createdAt: { gte: day4Start, lt: new Date(day4Start.getTime() + DAY) } } });
    expect(day4.length).toBe(30);
    expect(day4.every((o) => o.shippingStatus !== ShippingStatus.PENDING)).toBe(true);
    expect(day4.filter((o) => o.shippingStatus === ShippingStatus.DELIVERED).length).toBeGreaterThan(20);
    const day4Shopee = day4.filter((o) => o.channelId === shopeeId).length / day4.length;
    expect(day4Shopee).toBeGreaterThanOrEqual(0.4);
    expect(day4Shopee).toBeLessThanOrEqual(0.85);

    // Ngày -2 lệch 100% Lazada → cân lại: ≥55% Shopee, mã đơn Shopee đúng khuôn, mã vận đơn đổi tiền tố.
    const skew = await prisma.order.findMany({ where: { id: { in: Object.entries(seeded).filter(([k]) => k.startsWith("skew-")).map(([, id]) => id) } } });
    const skewShopee = skew.filter((o) => o.channelId === shopeeId);
    expect(skewShopee.length / skew.length).toBeGreaterThanOrEqual(0.55);
    expect(skewShopee.length / skew.length).toBeLessThanOrEqual(0.75);
    for (const o of skewShopee) {
      expect(o.orderCode).toMatch(/^\d{6}[0-9A-Z]{8}$/);
      expect(o.trackingCode).toMatch(/^SPXVN0/);
      expect(["SPX Express", "Giao Hàng Nhanh", "J&T Express"]).toContain(o.shippingCarrierName);
    }
    expect(s!.rebalanced).toBe(skewShopee.length);
    // Đơn seed (mã TEST-…) không bị cân: lịch sử ngày -1 vẫn 5 Shopee / 5 Lazada.
    const day1Start = vnMidnightUtc(ago(1 * DAY));
    const day1 = await prisma.order.findMany({ where: { channelId: { in: [shopeeId, lazadaId] }, orderCode: { startsWith: "TEST-" }, createdAt: { gte: day1Start, lt: new Date(day1Start.getTime() + DAY) } } });
    expect(day1.filter((o) => o.channelId === shopeeId).length).toBe(5);

    // Ngày -5 vẫn đủ 10 (không bị "bù" đè lên ngày có đơn).
    const day5Start = vnMidnightUtc(ago(5 * DAY));
    expect(await prisma.order.count({ where: { channelId: { in: [shopeeId, lazadaId] }, createdAt: { gte: day5Start, lt: new Date(day5Start.getTime() + DAY) } } })).toBe(10);

    const ret = await get("return-awaiting");
    expect(ret.returnStatus).not.toBe(ReturnStatus.AWAITING);
    expect(ret.returnedAt).not.toBeNull();

    // Bồi đơn: mục tiêu ≥30 (trung bình 10/ngày chạm sàn), 15h → ~50% mục tiêu.
    expect(s!.dailyTarget).toBe(30);
    const todayStart = vnMidnightUtc(NOW);
    const today = await prisma.order.findMany({ where: { channelId: { in: [shopeeId, lazadaId] }, createdAt: { gte: todayStart } } });
    // 2 đơn cắm sẵn hôm nay (pending-old, pending-fresh) + bồi cho đủ 15
    expect(today.length).toBe(15);
    expect(s!.created).toBe(13 + 30);
    const codes = new Set(today.map((o) => o.orderCode));
    expect(codes.size).toBe(today.length);
    for (const o of today) {
      expect(o.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(o.createdAt.getTime()).toBeGreaterThanOrEqual(todayStart.getTime() + 7.5 * HOUR - 1);
    }
    const items = await prisma.orderItem.count({ where: { orderId: { in: today.map((o) => o.id) } } });
    expect(items).toBeGreaterThanOrEqual(today.length);

    const ads = await prisma.adSpend.findMany({ where: { channelId: { in: [shopeeId, lazadaId] }, date: todayStart } });
    expect(ads.length).toBe(2);
    expect(Number(ads[0].amount)).toBeGreaterThan(0);
  });

  it("chạy lại cùng thời điểm → không bồi thêm; muộn hơn 3h → bồi tiếp đúng phần chênh", async () => {
    const again = await runReviewerDemoTopup({ email: EMAIL, now: NOW });
    expect(again!.created).toBe(0);

    const later = new Date(NOW.getTime() + 3 * HOUR); // 18h → progress 0,7 → 21 đơn
    const s2 = await runReviewerDemoTopup({ email: EMAIL, now: later });
    expect(s2!.created).toBe(6);
    const count = await prisma.order.count({ where: { channelId: { in: [shopeeId, lazadaId] }, createdAt: { gte: vnMidnightUtc(NOW) } } });
    expect(count).toBe(21);
  });

  it("gian đã nối sàn thật (có refreshToken) → không đụng, trả null", async () => {
    await prisma.channel.updateMany({ where: { userId }, data: { refreshToken: "real-token" } });
    const before = await prisma.order.count({ where: { channelId: { in: [shopeeId, lazadaId] } } });
    expect(await runReviewerDemoTopup({ email: EMAIL, now: new Date(NOW.getTime() + 6 * HOUR) })).toBeNull();
    const after = await prisma.order.count({ where: { channelId: { in: [shopeeId, lazadaId] } } });
    expect(after).toBe(before);
  });
});
