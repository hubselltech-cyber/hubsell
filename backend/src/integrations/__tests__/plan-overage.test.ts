// ============================================================
// PHÍ VƯỢT TRẦN ĐƠN "TÍNH THẲNG" (anh Trung chốt 11/11/2026) — services/plan-overage.ts
//   · Đơn giá vượt = giá 1 tháng ÷ trần: ra đúng bảng trong docs (330 / 199 / 133 / 69,9
//     / Scale 59,95 → sàn 65 / Enterprise 65); không nấc, không trần phí.
//   · Một câu SQL cho tạm tính lẫn chốt: trọn tháng, mua giữa tháng (trần chia theo phần
//     tháng được phủ, chỉ đếm đơn trong kỳ đã trả), nâng gói giữa tháng (trần mới áp cả
//     tháng), không vượt (dòng NONE), chạy lại không sinh trùng, đơn về sau lúc chốt
//     không tính thêm, dùng thử không có phí, gói thường chưa tới tháng bắt đầu thì chưa tính.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PackagePaymentMethod } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  OVERAGE_FIRST_MONTH,
  OVERAGE_START_MONTH,
  closeMonthOverage,
  monthOverageFor,
  overageDueAt,
  overageUnitPrice,
  upgradeBreakEvenOrder,
  vnMonthBounds,
  vnMonthKey,
  vnPreviousMonthKey,
} from "../../services/plan-overage";
import { recordPackagePayment } from "../../services/subscription-service";
import {
  OverageChargeError,
  recordOveragePayment,
  waiveOverageCharge,
} from "../../services/plan-overage-payment";
import { getOwnerPlanState, invalidatePlanState } from "../../services/plan-enforcement";
import { overageCloseDue } from "../../workers/plan-overage-close";
import { hqItemNameFor } from "../invoice/hq-auto-invoice";

const plan = (priceMonthly: number, maxOrdersPerMonth: number | null) => ({
  priceMonthly,
  maxOrdersPerMonth,
  minOrdersPerMonth: null,
  pricePerOrder: null,
});
const ENTERPRISE = { priceMonthly: 1_300_000, maxOrdersPerMonth: null, minOrdersPerMonth: 20_000, pricePerOrder: 65 };

describe("đơn giá vượt = giá 1 tháng ÷ trần (bảng giá thật 11/2026)", () => {
  it("Starter 330 · Growth 199 · Pro 133 · Business 69,9", () => {
    expect(overageUnitPrice(plan(99_000, 300), 65)).toBe(330);
    expect(overageUnitPrice(plan(199_000, 1_000), 65)).toBe(199);
    expect(overageUnitPrice(plan(399_000, 3_000), 65)).toBe(133);
    expect(overageUnitPrice(plan(699_000, 10_000), 65)).toBe(69.9);
  });
  it("Scale 59,95 bị nâng lên sàn 65; bỏ sàn thì giữ 59,95", () => {
    expect(overageUnitPrice(plan(1_199_000, 20_000), 65)).toBe(65);
    expect(overageUnitPrice(plan(1_199_000, 20_000), null)).toBe(59.95);
  });
  it("Enterprise (gói tính theo đơn) = giá công bố 65; không có giá công bố thì giá tháng ÷ mức tối thiểu", () => {
    expect(overageUnitPrice(ENTERPRISE, 65)).toBe(65);
    expect(overageUnitPrice({ ...ENTERPRISE, pricePerOrder: null }, null)).toBe(65);
  });
  it("gói không trần đơn hoặc giá 0 → không có phí vượt", () => {
    expect(overageUnitPrice(plan(99_000, null), 65)).toBeNull();
    expect(overageUnitPrice(plan(0, 300), 65)).toBeNull();
  });
});

describe("mốc báo — tính thẳng thì KHÔNG có nấc / trần phí, chỉ có mốc để báo", () => {
  it("mốc BÁO 'nâng gói rẻ hơn': Starter đơn 603 · Growth 2.005 · Pro 5.255 · Business 17.153", () => {
    expect(upgradeBreakEvenOrder(300, 330, 99_000, 199_000)).toBe(603);
    expect(upgradeBreakEvenOrder(1_000, 199, 199_000, 399_000)).toBe(2_005);
    expect(upgradeBreakEvenOrder(3_000, 133, 399_000, 699_000)).toBe(5_255);
    expect(upgradeBreakEvenOrder(10_000, 69.9, 699_000, 1_199_000)).toBe(17_153);
    expect(upgradeBreakEvenOrder(20_000, 65, 1_199_000, null)).toBeNull();
  });
});

describe("lịch giờ Việt Nam", () => {
  it("tháng 12/2026 = [30/11 17:00Z, 31/12 17:00Z); 31/12 18:00Z đã là tháng 1", () => {
    const b = vnMonthBounds("2026-12");
    expect(b.start.toISOString()).toBe("2026-11-30T17:00:00.000Z");
    expect(b.end.toISOString()).toBe("2026-12-31T17:00:00.000Z");
    expect(vnMonthKey(new Date("2026-12-31T18:00:00Z"))).toBe("2027-01");
    expect(vnPreviousMonthKey(new Date("2027-01-01T23:00:00Z"))).toBe("2026-12");
  });
  it("worker chỉ chốt từ 06:00 mùng 2 giờ VN", () => {
    expect(overageCloseDue(new Date("2026-12-01T22:59:00Z"))).toBe(false); // 05:59 mùng 2
    expect(overageCloseDue(new Date("2026-12-01T23:00:00Z"))).toBe(true); // 06:00 mùng 2
    expect(overageCloseDue(new Date("2026-12-01T10:00:00Z"))).toBe(false); // chiều mùng 1
    expect(overageCloseDue(new Date("2026-12-20T03:00:00Z"))).toBe(true);
  });
  it("hạn: trả tới hết mùng 5, khóa từ 00:00 mùng 6 giờ VN; phiếu ra trễ thì còn ít nhất 3 ngày", () => {
    expect(overageDueAt("2026-12").toISOString()).toBe("2027-01-05T17:00:00.000Z");
    expect(overageDueAt("2026-12", new Date("2027-01-10T00:00:00Z")).toISOString()).toBe(
      "2027-01-13T00:00:00.000Z"
    );
  });
});

// ---------------- DB dev ----------------

const STAMP = Date.now();
const MONTH = "2026-12"; // gói thường bắt đầu tính từ đây
const owners: Record<string, { id: string; channelId: string }> = {};
let planA = ""; // trần 10 đơn, 3.300 ₫/tháng → 330 ₫/đơn vượt
let planB = ""; // trần 30 đơn, 6.000 ₫/tháng → 200 ₫/đơn vượt
let planPO = ""; // gói tính theo đơn: tối thiểu 10 đơn, 65 ₫/đơn

async function makeOwner(key: string) {
  const u = await prisma.user.create({
    data: { email: `test-overage-${key}-${STAMP}@hubsell.test`, passwordHash: "x", fullName: `TEST overage ${key}`, role: "ADMIN" },
  });
  const ch = await prisma.channel.create({
    data: { userId: u.id, channelName: "TIKTOK", shopName: `TEST overage ${key} ${STAMP}`, apiToken: `test_ovg_${key}_${STAMP}`, status: "ACTIVE" },
  });
  owners[key] = { id: u.id, channelId: ch.id };
}

async function makeOrders(key: string, n: number, createdAt: string, tag: string) {
  await prisma.order.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      channelId: owners[key].channelId,
      orderCode: `TEST-OVG-${STAMP}-${key}-${tag}-${i}`,
      customerName: "Khách test",
      itemCount: 1,
      createdAt: new Date(createdAt),
    })),
  });
}

const pay = (key: string, planId: string, cycle: "MONTHLY" | "QUARTERLY", occurredAt: string) =>
  recordPackagePayment({
    userId: owners[key].id,
    planId,
    cycle,
    method: PackagePaymentMethod.BANK_TRANSFER,
    occurredAt: new Date(occurredAt),
    actorName: "Test",
  });

beforeAll(async () => {
  expect(MONTH >= OVERAGE_START_MONTH).toBe(true);
  for (const k of ["full", "mid", "up", "ok", "trial"]) await makeOwner(k);
  const mk = (code: string, price: number, cap: number) =>
    prisma.servicePlan.create({
      data: { code: `${code}${STAMP}`, name: `Test ${code}`, priceMonthly: price, priceQuarterly: price * 3, maxOrdersPerMonth: cap, isActive: false },
    });
  planA = (await mk("TSTOVA", 3_300, 10)).id;
  planB = (await mk("TSTOVB", 6_000, 30)).id;
});

afterAll(async () => {
  const ids = Object.values(owners).map((o) => o.id);
  await prisma.notification.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.platformLedgerEntry.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.servicePlan.deleteMany({ where: { id: { in: [planA, planB, planPO].filter(Boolean) } } });
  await prisma.$disconnect();
});

describe("một câu SQL cho tạm tính và chốt tháng", () => {
  it("chứng từ mua gói chụp trần + đơn giá vượt", async () => {
    // Trả 20/11, kỳ 3 tháng → phủ trọn tháng 12.
    const r = await pay("full", planA, "QUARTERLY", "2026-11-20T03:00:00Z");
    expect(r.payment.kind).toBe("PLAN");
    expect(r.payment.orderCap).toBe(10);
    expect(Number(r.payment.overageUnitPrice)).toBe(330);
  });

  it("trọn tháng: 14 đơn / trần 10 → vượt 4 × 330 = 1.320; đơn tháng 11 không tính", async () => {
    await makeOrders("full", 3, "2026-11-25T03:00:00Z", "nov");
    await makeOrders("full", 14, "2026-12-10T03:00:00Z", "dec");
    const est = await monthOverageFor(owners.full.id, { month: MONTH, asOf: new Date("2026-12-31T10:00:00Z") });
    expect(est).toMatchObject({ orderCap: 10, ordersCounted: 14, overOrders: 4, unitPrice: 330, amount: 1_320 });
    // Tạm tính giữa tháng chỉ đếm đơn đã phát sinh tới lúc hỏi.
    const early = await monthOverageFor(owners.full.id, { month: MONTH, asOf: new Date("2026-12-05T00:00:00Z") });
    expect(early).toMatchObject({ ordersCounted: 0, overOrders: 0, amount: 0 });
  });

  it("đơn bán tại quầy (gian OFFLINE) không tính vào số đơn vượt", async () => {
    const offline = await prisma.channel.create({
      data: { userId: owners.full.id, channelName: "OFFLINE", shopName: `TEST overage quay ${STAMP}`, apiToken: `test_ovg_off_${STAMP}`, status: "ACTIVE" },
    });
    await prisma.order.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        channelId: offline.id,
        orderCode: `TEST-OVG-${STAMP}-quay-${i}`,
        customerName: "Khách tại quầy",
        itemCount: 1,
        createdAt: new Date("2026-12-12T03:00:00Z"),
      })),
    });
    const est = await monthOverageFor(owners.full.id, { month: MONTH, asOf: new Date("2026-12-31T10:00:00Z") });
    expect(est).toMatchObject({ ordersCounted: 14, overOrders: 4, amount: 1_320 });
  });

  it("gói thường trước tháng bắt đầu (11/2026) chưa tính phí vượt", async () => {
    expect(await monthOverageFor(owners.full.id, { month: "2026-11", asOf: new Date("2026-11-30T10:00:00Z") })).toBeNull();
  });

  it("chốt: sinh đúng một phiếu OPEN, hạn khóa 00:00 06/01 giờ VN; chạy lại không sinh thêm; đơn về sau không tính", async () => {
    const now = new Date("2027-01-01T23:00:00Z"); // 06:00 mùng 2 giờ VN
    const first = await closeMonthOverage(MONTH, now, owners.full.id);
    expect(first.created).toBe(1);
    expect(first.open).toHaveLength(1);
    expect(first.open[0]).toMatchObject({ overOrders: 4, amount: 1_320 });
    expect(first.open[0].dueAt.toISOString()).toBe("2027-01-05T17:00:00.000Z");

    await makeOrders("full", 5, "2026-12-30T03:00:00Z", "late"); // đơn tháng 12 về trễ sau lúc chốt
    const again = await closeMonthOverage(MONTH, new Date("2027-01-02T05:00:00Z"), owners.full.id);
    expect(again.created).toBe(0);
    const charge = await prisma.planOverageCharge.findUniqueOrThrow({
      where: { ownerId_month: { ownerId: owners.full.id, month: MONTH } },
    });
    expect(charge.status).toBe("OPEN");
    expect(charge.overOrders).toBe(4);
    expect(Number(charge.amount)).toBe(1_320);
  });

  it("không chốt tháng chưa kết thúc", async () => {
    await expect(closeMonthOverage(MONTH, new Date("2026-12-20T00:00:00Z"), owners.full.id)).rejects.toThrow(/chưa kết thúc/);
  });

  it("mua giữa tháng (21/12): trần = 10 × 11/31 → 4; chỉ đếm đơn từ ngày mua", async () => {
    await makeOrders("mid", 5, "2026-12-10T03:00:00Z", "truoc"); // lúc chưa mua — không tính
    await pay("mid", planA, "MONTHLY", "2026-12-20T17:00:00Z"); // 00:00 21/12 giờ VN
    await makeOrders("mid", 6, "2026-12-25T03:00:00Z", "sau");
    const est = await monthOverageFor(owners.mid.id, { month: MONTH, asOf: new Date("2026-12-31T16:00:00Z") });
    expect(est).toMatchObject({ orderCap: 4, ordersCounted: 6, overOrders: 2, amount: 660 });
  });

  it("nâng gói giữa tháng: trần gói mới (30) áp cho cả tháng, đơn giá theo gói mới", async () => {
    await pay("up", planA, "QUARTERLY", "2026-11-20T03:00:00Z");
    await makeOrders("up", 20, "2026-12-05T03:00:00Z", "a");
    await pay("up", planB, "MONTHLY", "2026-12-15T03:00:00Z");
    await makeOrders("up", 15, "2026-12-20T03:00:00Z", "b");
    const est = await monthOverageFor(owners.up.id, { month: MONTH, asOf: new Date("2026-12-31T16:00:00Z") });
    // 35 đơn / trần 30 → vượt 5 × 200 = 1.000 (không phải 25 × 330 của gói cũ).
    expect(est).toMatchObject({ orderCap: 30, ordersCounted: 35, overOrders: 5, unitPrice: 200, amount: 1_000 });
  });

  it("không vượt → dòng NONE (đã chốt, không có gì phải trả)", async () => {
    await pay("ok", planA, "QUARTERLY", "2026-11-20T03:00:00Z");
    await makeOrders("ok", 7, "2026-12-10T03:00:00Z", "dec");
    const r = await closeMonthOverage(MONTH, new Date("2027-01-01T23:00:00Z"), owners.ok.id);
    expect(r.created).toBe(1);
    expect(r.open).toHaveLength(0);
    const charge = await prisma.planOverageCharge.findUniqueOrThrow({
      where: { ownerId_month: { ownerId: owners.ok.id, month: MONTH } },
    });
    expect(charge).toMatchObject({ status: "NONE", ordersCounted: 7, overOrders: 0 });
  });

  it("phiếu còn hạn: không khóa; quá hạn chưa trả: khóa OVERAGE_UNPAID", async () => {
    invalidatePlanState(owners.full.id);
    let st = await getOwnerPlanState(owners.full.id);
    expect(st.overage.openCharges).toHaveLength(1);
    expect(st.overage.openCharges[0]).toMatchObject({ month: MONTH, overOrders: 4, amount: 1_320, overdue: false });
    // (Đơn thử đặt ngày tương lai nên luật khóa mềm cũ của tháng 11 có thể bật ORDERS —
    // ở đây chỉ kiểm lý do khóa vì nợ phí vượt.)
    expect(st.lockedReason).not.toBe("OVERAGE_UNPAID");

    await prisma.planOverageCharge.update({
      where: { ownerId_month: { ownerId: owners.full.id, month: MONTH } },
      data: { dueAt: new Date(Date.now() - 60_000) },
    });
    invalidatePlanState(owners.full.id);
    st = await getOwnerPlanState(owners.full.id);
    expect(st.locked).toBe(true);
    expect(st.lockedReason).toBe("OVERAGE_UNPAID");
  });

  it("trả phiếu = mua thêm N đơn: chứng từ OVERAGE + sổ quỹ, KHÔNG gia hạn thuê bao, mở khóa ngay", async () => {
    const before = await prisma.subscription.findUniqueOrThrow({ where: { userId: owners.full.id } });
    const charge = await prisma.planOverageCharge.findUniqueOrThrow({
      where: { ownerId_month: { ownerId: owners.full.id, month: MONTH } },
    });
    const r = await recordOveragePayment({
      chargeId: charge.id,
      method: PackagePaymentMethod.BANK_TRANSFER,
      actorName: "Test",
    });
    expect(r.payment).toMatchObject({ kind: "OVERAGE", overageChargeId: charge.id, committedOrders: 4 });
    expect(Number(r.payment.amount)).toBe(1_320);

    const after = await prisma.subscription.findUniqueOrThrow({ where: { userId: owners.full.id } });
    expect(after.currentPeriodEnd?.getTime()).toBe(before.currentPeriodEnd?.getTime());
    expect(after.planId).toBe(before.planId);

    const ledger = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { packagePaymentId: r.payment.id } });
    expect(ledger.note).toContain("mua thêm 4 đơn hàng tháng 12/2026");
    expect(Number(ledger.amount)).toBe(1_320);
    // Tên dòng hóa đơn đúng câu anh chốt.
    expect(hqItemNameFor(r.payment)).toBe("Gói phần mềm Hubsell - mua thêm 4 đơn hàng");

    const paid = await prisma.planOverageCharge.findUniqueOrThrow({ where: { id: charge.id } });
    expect(paid).toMatchObject({ status: "PAID", packagePaymentId: r.payment.id });
    const st = await getOwnerPlanState(owners.full.id); // recordOveragePayment đã xóa cache
    expect(st.lockedReason).not.toBe("OVERAGE_UNPAID");
    expect(st.overage.openCharges).toHaveLength(0);

    // Trả đôi (webhook bắn lặp / HQ ghi tay sau khi cổng đã ghi) → từ chối, không thu hai lần.
    await expect(
      recordOveragePayment({ chargeId: charge.id, method: PackagePaymentMethod.BANK_TRANSFER, actorName: "Test" })
    ).rejects.toThrow(OverageChargeError);
    expect(await prisma.packagePayment.count({ where: { overageChargeId: charge.id } })).toBe(1);
  });

  it("kỳ hạn gói không bị khoản OVERAGE làm lệch: tạm tính tháng vẫn theo kỳ PLAN", async () => {
    const est = await monthOverageFor(owners.full.id, { month: MONTH, asOf: new Date("2026-12-31T16:00:00Z") });
    expect(est).toMatchObject({ orderCap: 10, unitPrice: 330 });
  });

  it("HQ miễn: bắt buộc lý do; miễn xong không trả được nữa và hết khóa", async () => {
    const r = await closeMonthOverage(MONTH, new Date("2027-01-01T23:00:00Z"), owners.mid.id);
    expect(r.open[0]).toMatchObject({ overOrders: 2, amount: 660 });
    const id = r.open[0].id;
    await prisma.planOverageCharge.update({ where: { id }, data: { dueAt: new Date(Date.now() - 60_000) } });
    invalidatePlanState(owners.mid.id);
    expect((await getOwnerPlanState(owners.mid.id)).lockedReason).toBe("OVERAGE_UNPAID");

    await expect(waiveOverageCharge({ chargeId: id, note: "  ", actorName: "Test" })).rejects.toThrow(/lý do/);
    const waived = await waiveOverageCharge({ chargeId: id, note: "Khách mới, tặng tháng đầu", actorName: "Test" });
    expect(waived).toMatchObject({ status: "WAIVED", waivedByName: "Test", waivedNote: "Khách mới, tặng tháng đầu" });
    expect((await getOwnerPlanState(owners.mid.id)).lockedReason).not.toBe("OVERAGE_UNPAID");
    await expect(
      recordOveragePayment({ chargeId: id, method: PackagePaymentMethod.BANK_TRANSFER, actorName: "Test" })
    ).rejects.toThrow(OverageChargeError);
  });

  it("vừa hết hạn gói quá ân hạn vừa nợ phí vượt: lý do khóa là EXPIRED (gia hạn trước)", async () => {
    const r = await closeMonthOverage(MONTH, new Date("2027-01-01T23:00:00Z"), owners.up.id);
    expect(r.open[0]).toMatchObject({ overOrders: 5, amount: 1_000 });
    await prisma.planOverageCharge.update({ where: { id: r.open[0].id }, data: { dueAt: new Date(Date.now() - 60_000) } });
    await prisma.subscription.update({
      where: { userId: owners.up.id },
      data: { currentPeriodEnd: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    });
    invalidatePlanState(owners.up.id);
    const st = await getOwnerPlanState(owners.up.id);
    expect(st.locked).toBe(true);
    expect(st.lockedReason).toBe("EXPIRED");
    expect(st.overage.openCharges[0].overdue).toBe(true);
  });

  it("dùng thử (chưa trả tiền) không có phí vượt dù đơn nhiều", async () => {
    await prisma.subscription.create({
      data: { userId: owners.trial.id, planId: planA, isTrial: true, currentPeriodEnd: new Date("2027-01-15T00:00:00Z") },
    });
    await makeOrders("trial", 40, "2026-12-10T03:00:00Z", "dec");
    expect(await monthOverageFor(owners.trial.id, { month: MONTH, asOf: new Date("2026-12-31T10:00:00Z") })).toBeNull();
    const r = await closeMonthOverage(MONTH, new Date("2027-01-01T23:00:00Z"), owners.trial.id);
    expect(r.created).toBe(0);
  });
});

describe("rào khi lên prod: không tính cho người chưa từng được báo luật này", () => {
  it("gói tính theo đơn: khoản HQ ghi tay kiểu cũ (không có số đơn đã chọn) không bị tính; có số thì tính", async () => {
    planPO = (
      await prisma.servicePlan.create({
        data: { code: `TSTOVPO${STAMP}`, name: "Test PO", priceMonthly: 650, pricePerOrder: 65, minOrdersPerMonth: 10, isActive: false },
      })
    ).id;
    await makeOwner("legacy");
    const sub = await prisma.subscription.create({
      data: { userId: owners.legacy.id, planId: planPO, currentPeriodEnd: new Date("2027-02-01T00:00:00Z") },
    });
    const legacyPay = await prisma.packagePayment.create({
      data: {
        subscriptionId: sub.id,
        userId: owners.legacy.id,
        planCode: `TSTOVPO${STAMP}`,
        planName: "Test PO",
        cycle: "QUARTERLY",
        amount: 1_950,
        method: PackagePaymentMethod.BANK_TRANSFER,
        periodStart: new Date("2026-11-01T00:00:00Z"),
        periodEnd: new Date("2027-02-01T00:00:00Z"),
        confirmedByName: "Test",
      },
    });
    await makeOrders("legacy", 30, "2026-12-10T03:00:00Z", "dec");
    const asOf = new Date("2026-12-31T10:00:00Z");
    expect(await monthOverageFor(owners.legacy.id, { month: MONTH, asOf })).toBeNull();

    await prisma.packagePayment.update({ where: { id: legacyPay.id }, data: { committedOrders: 10 } });
    expect(await monthOverageFor(owners.legacy.id, { month: MONTH, asOf })).toMatchObject({
      orderCap: 10,
      ordersCounted: 30,
      overOrders: 20,
      unitPrice: 65,
      amount: 1_300,
    });
  });

  it("không bao giờ tính lùi về tháng trước OVERAGE_FIRST_MONTH (10/2026), kể cả gói tính theo đơn", async () => {
    expect(OVERAGE_FIRST_MONTH).toBe("2026-11");
    await prisma.packagePayment.updateMany({
      where: { userId: owners.legacy.id },
      data: { periodStart: new Date("2026-09-25T00:00:00Z") },
    });
    await makeOrders("legacy", 40, "2026-10-10T03:00:00Z", "oct");
    expect(await monthOverageFor(owners.legacy.id, { month: "2026-10" })).toBeNull();
    const r = await closeMonthOverage("2026-10", new Date("2026-11-11T00:00:00Z"), owners.legacy.id);
    expect(r.created).toBe(0);
  });
});
