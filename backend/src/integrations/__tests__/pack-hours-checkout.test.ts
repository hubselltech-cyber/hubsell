// ============================================================
// MUA GIỜ QUAY VIDEO ĐÓNG HÀNG QUA CỔNG payOS (cổng giả lập bằng vi.mock — không gọi mạng), 18/11/2026.
// Rào kiểm:
//   · Khách chỉ gửi SỐ GIỜ, máy chủ tự tính tiền; nội dung CK "HS PAC<n> <mã đơn>" ≤ 25 ký tự; bấm hai
//     lần dùng lại một mã; đổi số giờ thì mã cũ bị hủy.
//   · Tiền về → đơn PAID + chứng từ PACK_HOURS + bút toán THU chờ hóa đơn + CỘNG ĐÚNG số giờ; KHÔNG gia
//     hạn thuê bao; webhook bắn lặp không cộng giờ hai lần.
//   · Tiền thiếu / thừa → MISMATCH, không cộng giờ, không ghi chứng từ.
//   · Công tắc mở bán tắt → không tạo được mã. Số giờ sai luật (lẻ, dưới tối thiểu, quá tối đa) → từ chối.
//   · Trần 9 ký tự (tài khoản chưa liên kết) → chỉ ghi "HS PAC", không cắt thành số giờ sai.
// ============================================================
import "./load-env";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PackagePaymentMethod } from "@prisma/client";

const payosCfg = { transferPrefix: "HS", descriptionMaxLen: 25 };

vi.mock("../payos/client", async (orig) => {
  const actual = await orig<typeof import("../payos/client")>();
  return {
    ...actual,
    getPayosConfig: () => payosCfg as never,
    isPayosConfigured: () => true,
    createPayosPaymentLink: vi.fn(async (_cfg: unknown, p: { orderCode: number }) => ({
      paymentLinkId: `mock-${p.orderCode}`,
      checkoutUrl: `https://pay.example.test/${p.orderCode}`,
      qrCode: "000201MOCK",
      bin: "970422",
      accountNumber: "0000000000",
      accountName: "HUBSELL TEST",
    })),
    cancelPayosPaymentLink: vi.fn(async () => undefined),
  };
});

import { prisma } from "../../lib/prisma";
import { PACK_VIDEO_HOUR_PRICE_VND } from "../../config/pack-video";
import { CheckoutError, createPackHoursCheckout, settleGatewayOrder } from "../../services/gateway-checkout";
import { getHoursBalance, getHoursOverview } from "../../services/pack-video/hours";
import { recordPackagePayment } from "../../services/subscription-service";
import { hqItemNameFor } from "../invoice/hq-auto-invoice";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT "packHours" FROM "gateway_payment_orders" LIMIT 1`;
    await prisma.$queryRaw`SELECT "paymentRef" FROM "pack_hour_grants" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const STAMP = Date.now();
const HOUR = 3600;
const PRICE = PACK_VIDEO_HOUR_PRICE_VND;
const owners: Record<string, string> = {};
let planId = "";

/** Chủ shop đã có thuê bao (chứng từ mua giờ cần một thuê bao để bám). */
async function makeOwner(key: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `test-packhrs-${key}-${STAMP}@hubsell.test`, passwordHash: "x", fullName: `TEST packhrs ${key}`, role: "ADMIN" },
  });
  owners[key] = u.id;
  await recordPackagePayment({
    userId: u.id,
    planId,
    cycle: "MONTHLY",
    method: PackagePaymentMethod.BANK_TRANSFER,
    occurredAt: new Date("2026-11-01T03:00:00Z"),
    actorName: "Test",
  });
  return u.id;
}

describe("tên dòng hóa đơn khoản mua giờ (thuần)", () => {
  it("ghi đúng số giờ, cùng khuôn 'Gói phần mềm Hubsell - mua thêm …'", () => {
    expect(
      hqItemNameFor({
        planName: "Pro",
        cycle: "MONTHLY",
        periodStart: new Date(),
        periodEnd: new Date(),
        kind: "PACK_HOURS",
        packHours: 1200,
      })
    ).toBe("Gói phần mềm Hubsell - mua thêm 1.200 giờ quay video đóng hàng");
  });
});

describe.skipIf(!dbReady)("mua giờ quay qua cổng", () => {
  beforeAll(async () => {
    planId = (
      await prisma.servicePlan.create({
        data: { code: `TSTPH${STAMP}`, name: "Test PH", priceMonthly: 3_300, maxOrdersPerMonth: 10, isActive: true },
      })
    ).id;
  });

  beforeEach(() => {
    process.env.PACK_VIDEO_HOUR_SALES_OPEN = "1";
    payosCfg.descriptionMaxLen = 25;
  });

  afterEach(() => {
    delete process.env.PACK_VIDEO_HOUR_SALES_OPEN;
  });

  afterAll(async () => {
    const ids = Object.values(owners);
    await prisma.packHourGrant.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.platformLedgerEntry.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.servicePlan.deleteMany({ where: { id: planId } });
    await prisma.$disconnect();
  });

  it("nhập 137 giờ → máy chủ tính 137 × đơn giá; bấm lại dùng lại mã; tiền về cộng đúng 137 giờ, bắn lặp không cộng đôi", async () => {
    const id = await makeOwner("buy");
    const subBefore = await prisma.subscription.findUniqueOrThrow({ where: { userId: id } });

    const co = await createPackHoursCheckout({ userId: id, hours: 137 });
    expect(co).toMatchObject({ amount: 137 * PRICE, packHours: 137, overageChargeId: null, status: "PENDING" });
    expect(co.transferContent).toMatch(/^HS PAC137 \d{8}$/);
    expect(co.transferContent.length).toBeLessThanOrEqual(25);
    expect((await createPackHoursCheckout({ userId: id, hours: 137 })).orderCode).toBe(co.orderCode);
    // Tạo mã chưa cộng gì — giờ chỉ cộng khi tiền ĐÃ VỀ.
    expect((await getHoursBalance(id)).purchasedSeconds).toBe(0);

    const settle = () =>
      settleGatewayOrder({
        orderCode: Number(co.orderCode),
        reference: `REF-${STAMP}-buy`,
        paidAmount: 137 * PRICE,
        paidAt: new Date("2026-11-18T13:00:00Z"),
      });
    expect((await settle()).status).toBe("PAID");
    expect((await settle()).status).toBe("PAID"); // webhook bắn lặp / poll đua webhook

    expect((await getHoursBalance(id)).purchasedSeconds).toBe(137 * HOUR);
    const grants = await prisma.packHourGrant.findMany({ where: { ownerId: id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ kind: "PURCHASE", amountVnd: 137 * PRICE, paymentRef: `payos:REF-${STAMP}-buy` });

    const pays = await prisma.packagePayment.findMany({ where: { userId: id, kind: "PACK_HOURS" } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ packHours: 137, method: "GATEWAY", externalRef: `payos:REF-${STAMP}-buy` });
    expect(Number(pays[0].amount)).toBe(137 * PRICE);
    const entries = await prisma.platformLedgerEntry.findMany({ where: { packagePaymentId: pays[0].id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "IN", invoiceStatus: "PENDING" });
    expect(Number(entries[0].amount)).toBe(137 * PRICE);

    // Mua giờ KHÔNG gia hạn thuê bao.
    const subAfter = await prisma.subscription.findUniqueOrThrow({ where: { userId: id } });
    expect(subAfter.currentPeriodEnd?.getTime()).toBe(subBefore.currentPeriodEnd?.getTime());
    expect(subAfter.planId).toBe(subBefore.planId);

    // Sổ giờ của khách thấy dòng mua kèm số tiền.
    const overview = await getHoursOverview(id);
    expect(overview.salesOpen).toBe(true);
    expect(overview.ledger[0]).toMatchObject({ kind: "PURCHASE", seconds: 137 * HOUR, amountVnd: 137 * PRICE });
  });

  it("đổi số giờ thì mã cũ bị hủy, chỉ còn một mã sống", async () => {
    const id = await makeOwner("change");
    const first = await createPackHoursCheckout({ userId: id, hours: 50 });
    const second = await createPackHoursCheckout({ userId: id, hours: 80 });
    expect(second.orderCode).not.toBe(first.orderCode);
    expect(second).toMatchObject({ amount: 80 * PRICE, packHours: 80 });
    const rows = await prisma.gatewayPaymentOrder.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["CANCELLED", "PENDING"]);
  });

  it("tiền về thiếu hoặc thừa → MISMATCH, không cộng giờ, không ghi chứng từ", async () => {
    const id = await makeOwner("mismatch");
    const under = await createPackHoursCheckout({ userId: id, hours: 40 });
    const s1 = await settleGatewayOrder({
      orderCode: Number(under.orderCode),
      reference: `REF-${STAMP}-under`,
      paidAmount: 40 * PRICE - 1_000,
      paidAt: new Date(),
    });
    expect(s1.status).toBe("MISMATCH");

    const over = await createPackHoursCheckout({ userId: id, hours: 60 });
    const s2 = await settleGatewayOrder({
      orderCode: Number(over.orderCode),
      reference: `REF-${STAMP}-over`,
      paidAmount: 60 * PRICE + 5_000,
      paidAt: new Date(),
    });
    expect(s2.status).toBe("MISMATCH");

    expect((await getHoursBalance(id)).purchasedSeconds).toBe(0);
    expect(await prisma.packagePayment.count({ where: { userId: id, kind: "PACK_HOURS" } })).toBe(0);
  });

  it("số giờ sai luật / công tắc tắt → không tạo mã", async () => {
    const id = await makeOwner("guard");
    await expect(createPackHoursCheckout({ userId: id, hours: 19 })).rejects.toThrow(/tối thiểu/);
    await expect(createPackHoursCheckout({ userId: id, hours: 10_001 })).rejects.toThrow(/tối đa/);
    await expect(createPackHoursCheckout({ userId: id, hours: 20.5 })).rejects.toThrow(/số nguyên/);
    await expect(createPackHoursCheckout({ userId: id, hours: "abc" })).rejects.toThrow(CheckoutError);
    await expect(createPackHoursCheckout({ userId: id, hours: undefined })).rejects.toThrow(CheckoutError);

    delete process.env.PACK_VIDEO_HOUR_SALES_OPEN;
    await expect(createPackHoursCheckout({ userId: id, hours: 50 })).rejects.toThrow(/Chưa mở thanh toán/);
    expect((await getHoursOverview(id)).salesOpen).toBe(false);
    expect(await prisma.gatewayPaymentOrder.count({ where: { userId: id } })).toBe(0);
  });

  it("mua tối đa 10.000 giờ vẫn vừa trần 25 ký tự; trần 9 ký tự thì chỉ ghi 'HS PAC'", async () => {
    const id = await makeOwner("desc");
    const big = await createPackHoursCheckout({ userId: id, hours: 10_000 });
    expect(big.transferContent).toMatch(/^HS PAC10000 \d{8}$/);
    expect(big.transferContent.length).toBeLessThanOrEqual(25);

    payosCfg.descriptionMaxLen = 9;
    const small = await createPackHoursCheckout({ userId: id, hours: 1_000 });
    expect(small.transferContent).toBe("HS PAC"); // không bị cắt thành "HS PAC100"
    const fits = await createPackHoursCheckout({ userId: id, hours: 200 });
    expect(fits.transferContent).toBe("HS PAC200");
  });
});
