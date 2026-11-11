// ============================================================
// ENTERPRISE TỰ PHỤC VỤ (11/11/2026) — gói tính theo đơn:
//   · Giá: làm tròn nghìn(giá kỳ ở mức tối thiểu × N ÷ mức) — ở 20.000 đơn ra đúng
//     4 con số đã báo khách (1,3 tr / 3,69 tr / 6,99 tr / 12,99 tr).
//   · Số đơn khách nhập: < tối thiểu / không phải số nguyên → lỗi tiếng người.
//   · Ghi nhận thanh toán lưu số cam kết trên CHỨNG TỪ; trần đơn = số cam kết của kỳ
//     đang chạy; vượt KHÔNG khóa (phần vượt thu tháng sau — lát 2).
//   · Gia hạn sớm với số mới: kỳ đang chạy giữ số cũ, số mới áp từ kỳ nối tiếp.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PackagePaymentMethod } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  PerOrderInputError,
  isPerOrderPlan,
  perOrderPlanPrice,
  validateCommittedOrders,
} from "../../services/per-order-plan";
import { getOwnerPlanState, invalidatePlanState } from "../../services/plan-enforcement";
import { recordPackagePayment } from "../../services/subscription-service";

const ENTERPRISE = {
  priceMonthly: 1_300_000,
  priceQuarterly: 3_690_000,
  priceSemiannual: 6_990_000,
  priceYearly: 12_990_000,
  minOrdersPerMonth: 20_000,
};

describe("perOrderPlanPrice — giá theo số đơn khách nhập", () => {
  it("ở đúng 20.000 đơn ra y 4 con số đã báo khách", () => {
    expect(perOrderPlanPrice(ENTERPRISE, "MONTHLY", 20_000)).toBe(1_300_000);
    expect(perOrderPlanPrice(ENTERPRISE, "QUARTERLY", 20_000)).toBe(3_690_000);
    expect(perOrderPlanPrice(ENTERPRISE, "SEMIANNUAL", 20_000)).toBe(6_990_000);
    expect(perOrderPlanPrice(ENTERPRISE, "YEARLY", 20_000)).toBe(12_990_000);
  });

  it("nhân tỷ lệ theo số đơn, giữ nguyên mức giảm kỳ dài", () => {
    expect(perOrderPlanPrice(ENTERPRISE, "MONTHLY", 30_000)).toBe(1_950_000);
    expect(perOrderPlanPrice(ENTERPRISE, "QUARTERLY", 30_000)).toBe(5_535_000);
    expect(perOrderPlanPrice(ENTERPRISE, "SEMIANNUAL", 30_000)).toBe(10_485_000);
    expect(perOrderPlanPrice(ENTERPRISE, "YEARLY", 30_000)).toBe(19_485_000);
    // Số lẻ → tròn nghìn: 25.123 × 65 = 1.632.995 → 1.633.000.
    expect(perOrderPlanPrice(ENTERPRISE, "MONTHLY", 25_123)).toBe(1_633_000);
  });

  it("kỳ có giá 0 (không bán) vẫn là 0; gói thường trả giá cột như cũ", () => {
    expect(perOrderPlanPrice({ ...ENTERPRISE, priceSemiannual: 0 }, "SEMIANNUAL", 30_000)).toBe(0);
    expect(perOrderPlanPrice({ ...ENTERPRISE, minOrdersPerMonth: null }, "QUARTERLY", 30_000)).toBe(3_690_000);
    expect(isPerOrderPlan({ minOrdersPerMonth: null })).toBe(false);
    expect(isPerOrderPlan({ minOrdersPerMonth: 20_000 })).toBe(true);
  });
});

describe("validateCommittedOrders — số khách nhập", () => {
  it("nhận số nguyên ≥ tối thiểu, kể cả chuỗi có dấu chấm nghìn", () => {
    expect(validateCommittedOrders(ENTERPRISE, 20_000)).toBe(20_000);
    expect(validateCommittedOrders(ENTERPRISE, "25.000")).toBe(25_000);
  });
  it("dưới tối thiểu / số lẻ / rỗng → lỗi", () => {
    expect(() => validateCommittedOrders(ENTERPRISE, 19_999)).toThrow(PerOrderInputError);
    expect(() => validateCommittedOrders(ENTERPRISE, 20_000.5)).toThrow(PerOrderInputError);
    expect(() => validateCommittedOrders(ENTERPRISE, undefined)).toThrow(/số đơn/);
    expect(() => validateCommittedOrders(ENTERPRISE, 5_000_000)).toThrow(PerOrderInputError);
  });
});

// ---------------- DB dev: chứng từ + trần đơn ----------------

const STAMP = Date.now();
let ownerId = "";
let planId = "";
let channelId = "";

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `test-perorder-${STAMP}@hubsell.test`,
      passwordHash: "x",
      fullName: `TEST perorder-${STAMP}`,
      role: "ADMIN",
    },
  });
  ownerId = owner.id;
  channelId = (
    await prisma.channel.create({
      data: {
        userId: ownerId,
        channelName: "TIKTOK",
        shopName: `TEST perorder ${STAMP}`,
        apiToken: `test_perorder_${STAMP}`,
        status: "ACTIVE",
      },
    })
  ).id;
  // Mức tối thiểu NHỎ (10 đơn) để tạo đơn test nhanh; giá ở mức tối thiểu = 650 đ × 1.000.
  planId = (
    await prisma.servicePlan.create({
      data: {
        code: `TSTPO${STAMP}`,
        name: "Test Enterprise",
        priceMonthly: 650_000,
        priceQuarterly: 1_845_000,
        priceSemiannual: 0,
        priceYearly: 0,
        pricePerOrder: 65,
        minOrdersPerMonth: 10,
        isActive: true,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { ownerId } });
  await prisma.platformLedgerEntry.deleteMany({ where: { customerId: ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.servicePlan.deleteMany({ where: { id: planId } });
  await prisma.$disconnect();
});

describe("recordPackagePayment + getOwnerPlanState — gói tính theo đơn", () => {
  it("lưu số cam kết trên chứng từ, giá mặc định tính theo số đó", async () => {
    const r = await recordPackagePayment({
      userId: ownerId,
      planId,
      cycle: "MONTHLY",
      committedOrders: 12,
      method: PackagePaymentMethod.BANK_TRANSFER,
      actorName: "Test",
    });
    expect(r.payment.committedOrders).toBe(12);
    // 650.000 × 12 ÷ 10 = 780.000
    expect(Number(r.payment.amount)).toBe(780_000);
    const ledger = await prisma.platformLedgerEntry.findUniqueOrThrow({
      where: { packagePaymentId: r.payment.id },
    });
    expect(ledger.note).toContain("12 đơn/tháng");
  });

  it("trần đơn = số cam kết; vượt 150% vẫn KHÔNG khóa", async () => {
    for (let i = 0; i < 18; i++) {
      await prisma.order.create({
        data: { channelId, orderCode: `TEST-PO-${STAMP}-${i}`, customerName: "Khách test", itemCount: 1 },
      });
    }
    invalidatePlanState(ownerId);
    const st = await getOwnerPlanState(ownerId);
    expect(st.committedOrders).toBe(12);
    expect(st.orders.limit).toBe(12);
    expect(st.orders.used).toBe(18);
    expect(st.orders.state).toBe("over");
    expect(st.orders.graceDeadline).toBeNull();
    expect(st.locked).toBe(false);
  });

  it("gia hạn sớm với số mới: kỳ đang chạy giữ số cũ, kỳ nối tiếp mang số mới", async () => {
    const r = await recordPackagePayment({
      userId: ownerId,
      planId,
      cycle: "QUARTERLY",
      committedOrders: 20,
      method: PackagePaymentMethod.BANK_TRANSFER,
      actorName: "Test",
    });
    expect(r.payment.periodStart.getTime()).toBeGreaterThan(Date.now());
    expect(Number(r.payment.amount)).toBe(3_690_000); // 1.845.000 × 20 ÷ 10
    invalidatePlanState(ownerId);
    expect((await getOwnerPlanState(ownerId)).committedOrders).toBe(12);
  });

  it("khoản HQ ghi tay không có số đơn → hiểu là mức tối thiểu", async () => {
    await prisma.packagePayment.updateMany({ where: { userId: ownerId }, data: { committedOrders: null } });
    invalidatePlanState(ownerId);
    expect((await getOwnerPlanState(ownerId)).committedOrders).toBe(10);
  });
});
