// ============================================================
// GÓI DỊCH VỤ & THUÊ BAO — kiểm chứng "một hành động, 4 hệ quả" trên DB dev:
//   · Ghi nhận thanh toán → Subscription gia hạn + PackagePayment snapshot +
//     bút toán THU sổ quỹ (chờ hóa đơn) + hoa hồng giới thiệu 10%.
//   · Gia hạn sớm CÙNG GÓI → nối tiếp từ cuối kỳ, không mất ngày.
//   · ĐỔI GÓI giữa kỳ → kỳ mới tính từ ngày thu tiền.
//   · Thanh toán bằng VÍ → KHÔNG ghi sổ quỹ (bù trừ công nợ, không có tiền vào).
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../prisma";
import {
  addBillingPeriod,
  effectiveSubscriptionStatus,
  recordPackagePayment,
} from "../../subscription-service";

const STAMP = Date.now();
const payerEmail = `test-subpay-${STAMP}@hubsell.test`;
const referrerEmail = `test-subref-${STAMP}@hubsell.test`;

let payerId = "";
let referrerId = "";
let planAId = "";
let planBId = "";

beforeAll(async () => {
  const referrer = await prisma.user.create({
    data: {
      email: referrerEmail,
      passwordHash: "x",
      fullName: `TEST subref-${STAMP}`,
      role: "ADMIN",
    },
  });
  referrerId = referrer.id;
  const payer = await prisma.user.create({
    data: {
      email: payerEmail,
      passwordHash: "x",
      fullName: `TEST subpay-${STAMP}`,
      role: "ADMIN",
      referredById: referrer.id,
    },
  });
  payerId = payer.id;

  const planA = await prisma.servicePlan.create({
    data: {
      code: `TSTA${STAMP}`,
      name: "Test Starter",
      priceMonthly: 199_000,
      priceYearly: 1_990_000,
      isActive: true,
    },
  });
  planAId = planA.id;
  const planB = await prisma.servicePlan.create({
    data: {
      code: `TSTB${STAMP}`,
      name: "Test Pro",
      priceMonthly: 499_000,
      priceYearly: 4_990_000,
      isActive: true,
    },
  });
  planBId = planB.id;
});

afterAll(async () => {
  // Bút toán sổ quỹ không cascade theo user (SetNull) — dọn tay trước.
  await prisma.platformLedgerEntry.deleteMany({
    where: { customerId: { in: [payerId, referrerId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [payerId, referrerId] } } });
  await prisma.servicePlan.deleteMany({ where: { id: { in: [planAId, planBId] } } });
  await prisma.$disconnect();
});

describe("addBillingPeriod / effectiveSubscriptionStatus", () => {
  it("cộng đúng 1 / 3 / 6 / 12 tháng", () => {
    const from = new Date("2026-08-22T12:00:00Z");
    expect(addBillingPeriod(from, "MONTHLY").toISOString()).toBe("2026-09-22T12:00:00.000Z");
    expect(addBillingPeriod(from, "QUARTERLY").toISOString()).toBe("2026-11-22T12:00:00.000Z");
    expect(addBillingPeriod(from, "SEMIANNUAL").toISOString()).toBe("2027-02-22T12:00:00.000Z");
    expect(addBillingPeriod(from, "YEARLY").toISOString()).toBe("2027-08-22T12:00:00.000Z");
  });

  it("suy trạng thái hiển thị từ kỳ hạn, không cần cron", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86_400_000);
    expect(effectiveSubscriptionStatus({ status: "ACTIVE", currentPeriodEnd: null })).toBe("ACTIVE");
    expect(effectiveSubscriptionStatus({ status: "ACTIVE", currentPeriodEnd: future })).toBe("ACTIVE");
    expect(effectiveSubscriptionStatus({ status: "ACTIVE", currentPeriodEnd: past })).toBe("EXPIRED");
    expect(effectiveSubscriptionStatus({ status: "CANCELLED", currentPeriodEnd: future })).toBe(
      "CANCELLED"
    );
  });
});

describe("recordPackagePayment — một hành động, 4 hệ quả", () => {
  it("thanh toán đầu tiên: thuê bao + chứng từ + bút toán THU chờ hóa đơn + hoa hồng 10%", async () => {
    const occurredAt = new Date("2026-08-22T05:00:00Z");
    const { payment, subscription } = await recordPackagePayment({
      userId: payerId,
      planId: planAId,
      cycle: "MONTHLY",
      method: "BANK_TRANSFER",
      occurredAt,
      actorName: "Kế toán Test",
    });

    // (1) Thuê bao: kỳ bắt đầu từ ngày thu, +1 tháng.
    expect(subscription.planId).toBe(planAId);
    expect(subscription.currentPeriodEnd?.toISOString()).toBe("2026-09-22T05:00:00.000Z");

    // (2) Chứng từ snapshot giá niêm yết + tên gói.
    expect(Number(payment.amount)).toBe(199_000);
    expect(payment.planName).toBe("Test Starter");

    // (3) Bút toán THU tự sinh, nghĩa vụ hóa đơn PENDING, khóa theo payment.
    const ledger = await prisma.platformLedgerEntry.findUnique({
      where: { packagePaymentId: payment.id },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.direction).toBe("IN");
    expect(ledger!.source).toBe("SUBSCRIPTION");
    expect(Number(ledger!.amount)).toBe(199_000);
    expect(ledger!.invoiceStatus).toBe("PENDING");
    expect(ledger!.customerId).toBe(payerId);

    // (4) Hoa hồng 10% chảy về ví người giới thiệu.
    const wallet = await prisma.hubsellWallet.findUnique({ where: { userId: referrerId } });
    expect(Number(wallet?.balance)).toBe(19_900);
  });

  it("gia hạn sớm CÙNG GÓI: nối tiếp từ cuối kỳ, không mất ngày", async () => {
    const { subscription } = await recordPackagePayment({
      userId: payerId,
      planId: planAId,
      cycle: "MONTHLY",
      method: "BANK_TRANSFER",
      occurredAt: new Date("2026-08-25T05:00:00Z"), // còn hạn tới 22/09
    });
    expect(subscription.currentPeriodEnd?.toISOString()).toBe("2026-10-22T05:00:00.000Z");
  });

  it("ĐỔI GÓI giữa kỳ: kỳ mới tính từ ngày thu tiền, số tiền kế toán tự quyết", async () => {
    const { payment, subscription } = await recordPackagePayment({
      userId: payerId,
      planId: planBId,
      cycle: "MONTHLY",
      method: "BANK_TRANSFER",
      occurredAt: new Date("2026-08-26T05:00:00Z"),
      amount: 300_000, // thu bù chênh lệch — không theo giá niêm yết
    });
    expect(subscription.planId).toBe(planBId);
    expect(subscription.currentPeriodEnd?.toISOString()).toBe("2026-09-26T05:00:00.000Z");
    expect(Number(payment.amount)).toBe(300_000);
  });

  it("thanh toán đầu tiên KẾT THÚC kỳ dùng thử (hạ cờ isTrial)", async () => {
    // Giả lập khách đang dùng thử 14 ngày (như ensureDefaultSubscription gán).
    await prisma.subscription.update({
      where: { userId: payerId },
      data: { isTrial: true },
    });
    await recordPackagePayment({
      userId: payerId,
      planId: planBId,
      cycle: "MONTHLY",
      method: "BANK_TRANSFER",
      occurredAt: new Date("2026-08-27T05:00:00Z"),
    });
    const sub = await prisma.subscription.findUnique({ where: { userId: payerId } });
    expect(sub?.isTrial).toBe(false);
  });

  it("ghi nhận thanh toán TỰ ĐÓNG yêu cầu mua gói đang chờ (GĐ3)", async () => {
    const request = await prisma.planUpgradeRequest.create({
      data: {
        userId: payerId,
        planId: planBId,
        planCode: `TSTB${STAMP}`,
        planName: "Test Pro",
        cycle: "MONTHLY",
        listedPrice: 499_000,
      },
    });
    await recordPackagePayment({
      userId: payerId,
      planId: planBId,
      cycle: "MONTHLY",
      method: "BANK_TRANSFER",
      occurredAt: new Date("2026-08-28T05:00:00Z"),
      actorName: "Kế toán Test",
    });
    const closed = await prisma.planUpgradeRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(closed.status).toBe("DONE");
    expect(closed.resolvedByName).toBe("Kế toán Test");
    expect(closed.resolvedAt).not.toBeNull();
  });

  it("thanh toán bằng VÍ: có chứng từ nhưng KHÔNG ghi sổ quỹ", async () => {
    const { payment } = await recordPackagePayment({
      userId: payerId,
      planId: planBId,
      cycle: "MONTHLY",
      method: "WALLET",
      occurredAt: new Date("2026-09-26T05:00:00Z"),
    });
    expect(payment.method).toBe("WALLET");
    const ledger = await prisma.platformLedgerEntry.findUnique({
      where: { packagePaymentId: payment.id },
    });
    expect(ledger).toBeNull();
  });
});
