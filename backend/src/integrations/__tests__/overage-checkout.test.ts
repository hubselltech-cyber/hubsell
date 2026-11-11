// ============================================================
// THANH TOÁN QUA CỔNG payOS (cổng giả lập bằng vi.mock — không gọi mạng):
//   · Trả PHÍ VƯỢT: số tiền lấy từ phiếu, nội dung CK "… VUOTmmyy …", bấm hai lần dùng lại
//     một mã; tiền về → phiếu PAID + chứng từ OVERAGE, KHÔNG gia hạn thuê bao; webhook bắn
//     lặp không thu đôi; phiếu đã miễn mà tiền vẫn về → đơn MISMATCH, không ghi chứng từ.
//   · HỒI QUY mua gói thường sau khi tách openGatewayOrder dùng chung (11/11/2026): vẫn
//     tạo mã đúng giá và tiền về vẫn gia hạn thuê bao.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PackagePaymentMethod } from "@prisma/client";

vi.mock("../payos/client", async (orig) => {
  const actual = await orig<typeof import("../payos/client")>();
  return {
    ...actual,
    getPayosConfig: () => ({ transferPrefix: "HS", descriptionMaxLen: 25 }) as never,
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
import {
  CheckoutError,
  createCheckout,
  createOverageCheckout,
  settleGatewayOrder,
} from "../../services/gateway-checkout";
import { recordPackagePayment } from "../../services/subscription-service";
import { waiveOverageCharge } from "../../services/plan-overage-payment";
import { closeMonthOverage } from "../../services/plan-overage";

const STAMP = Date.now();
const MONTH = "2026-12";
const owners: Record<string, { id: string; channelId: string }> = {};
let planId = "";

async function makeOwner(key: string) {
  const u = await prisma.user.create({
    data: { email: `test-ovgpay-${key}-${STAMP}@hubsell.test`, passwordHash: "x", fullName: `TEST ovgpay ${key}`, role: "ADMIN" },
  });
  const ch = await prisma.channel.create({
    data: { userId: u.id, channelName: "TIKTOK", shopName: `TEST ovgpay ${key} ${STAMP}`, apiToken: `test_ovgpay_${key}_${STAMP}`, status: "ACTIVE" },
  });
  owners[key] = { id: u.id, channelId: ch.id };
}

/** Chủ shop đã trả gói (phủ trọn tháng 12), bán 14 đơn / trần 10 → phiếu OPEN 4 × 330 = 1.320. */
async function ownerWithOpenCharge(key: string) {
  await makeOwner(key);
  await recordPackagePayment({
    userId: owners[key].id,
    planId,
    cycle: "QUARTERLY",
    method: PackagePaymentMethod.BANK_TRANSFER,
    occurredAt: new Date("2026-11-20T03:00:00Z"),
    actorName: "Test",
  });
  await prisma.order.createMany({
    data: Array.from({ length: 14 }, (_, i) => ({
      channelId: owners[key].channelId,
      orderCode: `TEST-OVGPAY-${STAMP}-${key}-${i}`,
      customerName: "Khách test",
      itemCount: 1,
      createdAt: new Date("2026-12-10T03:00:00Z"),
    })),
  });
  const r = await closeMonthOverage(MONTH, new Date("2027-01-01T23:00:00Z"), owners[key].id);
  return r.open[0].id;
}

beforeAll(async () => {
  planId = (
    await prisma.servicePlan.create({
      data: { code: `TSTOVP${STAMP}`, name: "Test OVP", priceMonthly: 3_300, priceQuarterly: 9_900, maxOrdersPerMonth: 10, isActive: true },
    })
  ).id;
});

afterAll(async () => {
  const ids = Object.values(owners).map((o) => o.id);
  await prisma.notification.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.platformLedgerEntry.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.servicePlan.deleteMany({ where: { id: planId } });
  await prisma.$disconnect();
});

describe("trả phí vượt qua cổng", () => {
  it("tạo mã theo số tiền trên phiếu; bấm lại dùng lại mã; tiền về đóng phiếu, không gia hạn; bắn lặp không thu đôi", async () => {
    const chargeId = await ownerWithOpenCharge("pay");
    const subBefore = await prisma.subscription.findUniqueOrThrow({ where: { userId: owners.pay.id } });

    const co = await createOverageCheckout({ userId: owners.pay.id, chargeId });
    expect(co).toMatchObject({ amount: 1_320, overageChargeId: chargeId, committedOrders: 4, status: "PENDING" });
    expect(co.transferContent).toContain("VUOT1226");
    expect(co.transferContent.length).toBeLessThanOrEqual(25);
    const again = await createOverageCheckout({ userId: owners.pay.id, chargeId });
    expect(again.orderCode).toBe(co.orderCode);

    const settle = () =>
      settleGatewayOrder({
        orderCode: Number(co.orderCode),
        reference: `REF-${STAMP}-pay`,
        paidAmount: 1_320,
        paidAt: new Date("2027-01-03T03:00:00Z"),
      });
    expect((await settle()).status).toBe("PAID");
    expect((await settle()).status).toBe("PAID"); // webhook bắn lặp

    const charge = await prisma.planOverageCharge.findUniqueOrThrow({ where: { id: chargeId } });
    expect(charge.status).toBe("PAID");
    const pays = await prisma.packagePayment.findMany({ where: { overageChargeId: chargeId } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ kind: "OVERAGE", method: "GATEWAY", externalRef: `payos:REF-${STAMP}-pay` });
    expect(Number(pays[0].amount)).toBe(1_320);
    const subAfter = await prisma.subscription.findUniqueOrThrow({ where: { userId: owners.pay.id } });
    expect(subAfter.currentPeriodEnd?.getTime()).toBe(subBefore.currentPeriodEnd?.getTime());

    // Phiếu đã đóng thì không tạo mã mới được nữa.
    await expect(createOverageCheckout({ userId: owners.pay.id, chargeId })).rejects.toThrow(CheckoutError);
  });

  it("phiếu của người khác / không tồn tại → 404", async () => {
    const chargeId = await ownerWithOpenCharge("other");
    await expect(createOverageCheckout({ userId: owners.pay.id, chargeId })).rejects.toThrow(/Không tìm thấy/);
    await expect(createOverageCheckout({ userId: owners.pay.id, chargeId: "khong-co" })).rejects.toThrow(/Không tìm thấy/);
  });

  it("HQ miễn sau khi khách đã lấy mã, tiền vẫn về → đơn MISMATCH, không ghi chứng từ", async () => {
    const chargeId = await ownerWithOpenCharge("waived");
    const co = await createOverageCheckout({ userId: owners.waived.id, chargeId });
    await waiveOverageCharge({ chargeId, note: "Test miễn", actorName: "Test" });
    const settled = await settleGatewayOrder({
      orderCode: Number(co.orderCode),
      reference: `REF-${STAMP}-waived`,
      paidAmount: 1_320,
      paidAt: new Date("2027-01-03T03:00:00Z"),
    });
    expect(settled.status).toBe("MISMATCH");
    expect(await prisma.packagePayment.count({ where: { overageChargeId: chargeId } })).toBe(0);
    expect((await prisma.planOverageCharge.findUniqueOrThrow({ where: { id: chargeId } })).status).toBe("WAIVED");
  });
});

describe("hồi quy: mua gói thường qua cổng sau khi tách hàm mở đơn dùng chung", () => {
  it("tạo mã đúng giá kỳ, tiền về gia hạn thuê bao và chụp trần + đơn giá vượt", async () => {
    await makeOwner("plan");
    const co = await createCheckout({ userId: owners.plan.id, planId, cycle: "QUARTERLY" });
    expect(co).toMatchObject({ amount: 9_900, overageChargeId: null, committedOrders: null, status: "PENDING" });
    expect((await createCheckout({ userId: owners.plan.id, planId, cycle: "QUARTERLY" })).orderCode).toBe(co.orderCode);

    const settled = await settleGatewayOrder({
      orderCode: Number(co.orderCode),
      reference: `REF-${STAMP}-plan`,
      paidAmount: 9_900,
      paidAt: new Date(),
    });
    expect(settled.status).toBe("PAID");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: owners.plan.id } });
    expect(sub.planId).toBe(planId);
    expect(sub.isTrial).toBe(false);
    const pay = await prisma.packagePayment.findFirstOrThrow({ where: { userId: owners.plan.id } });
    expect(pay).toMatchObject({ kind: "PLAN", orderCap: 10 });
    expect(Number(pay.overageUnitPrice)).toBe(330);
  });
});
