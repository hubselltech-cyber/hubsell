// ============================================================
// HỦY GHI NHẬN khoản thu gói HQ bấm tay (services/void-package-payment.ts) — ca gốc
// 26/11/2026: khách chuyển qua payOS (máy đã ghi), HQ ghi tay thêm một lần → hai
// khoản thu, hạn gói 6 tháng thay vì 3. Kiểm trên DB dev, cả hai thứ tự ghi:
//   · payOS trước, HQ sau  → gỡ khoản HQ, hạn về đúng kỳ payOS.
//   · HQ trước, payOS sau  → gỡ khoản HQ, kỳ payOS dời về tính từ ngày thu của nó.
// Và các ca phải TỪ CHỐI: khoản payOS, khoản đã có hóa đơn, tờ đã ký trên
// meinvoice.vn, khoản mở kỳ đầu (không dựng lại được trạng thái trước đó).
// meinvoice.vn được giả lập — test không gọi MISA.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const draftState = vi.hoisted(() => ({ value: "DRAFT" as string, removed: [] as string[] }));
vi.mock("../invoice/hq-auto-invoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/hq-auto-invoice")>();
  return {
    ...actual,
    kickHqAutoInvoice: () => undefined,
    inspectHqWebDraft: async (entryId: string, opts: { remove: boolean }) => {
      if (draftState.value === "DRAFT" && opts.remove) {
        draftState.removed.push(entryId);
        return "DELETED";
      }
      return draftState.value;
    },
  };
});

import { prisma } from "../../lib/prisma";
import { recordPackagePayment } from "../../services/subscription-service";
import {
  computePeriodRollback,
  previewVoidPackagePayment,
  voidPackagePayment,
  VoidPaymentError,
  type PlanPaymentRow,
} from "../../services/void-package-payment";

const STAMP = Date.now();
const AMOUNT = 1_129_000;
const NOON = new Date("2026-11-26T05:00:00Z"); // 12:00 giờ VN — giờ mặc định của ô ngày ở HQ
const PAYOS_AT = new Date("2026-11-26T06:10:00Z"); // 13:10 giờ VN

let referrerId = "";
let planId = "";
const userIds: string[] = [];

async function newPayer(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `test-void-${tag}-${STAMP}@hubsell.test`,
      passwordHash: "x",
      fullName: `TEST void-${tag}-${STAMP}`,
      role: "ADMIN",
      referredById: referrerId,
    },
  });
  userIds.push(u.id);
  return u.id;
}

const payByGateway = (userId: string, tag: string) =>
  recordPackagePayment({
    userId,
    planId,
    cycle: "QUARTERLY",
    amount: AMOUNT,
    method: "GATEWAY",
    occurredAt: PAYOS_AT,
    externalRef: `payos:test-void-${tag}-${STAMP}`,
  });

const payByHand = (userId: string) =>
  recordPackagePayment({
    userId,
    planId,
    cycle: "QUARTERLY",
    amount: AMOUNT,
    method: "BANK_TRANSFER",
    occurredAt: NOON,
    actorId: referrerId,
    actorName: "Hiếu Test",
  });

const ledgerOf = (paymentId: string) =>
  prisma.platformLedgerEntry.findUniqueOrThrow({ where: { packagePaymentId: paymentId } });

const walletBalance = async () =>
  Number((await prisma.hubsellWallet.findUnique({ where: { userId: referrerId } }))?.balance ?? 0);

beforeAll(async () => {
  const referrer = await prisma.user.create({
    data: {
      email: `test-void-ref-${STAMP}@hubsell.test`,
      passwordHash: "x",
      fullName: `TEST void-ref-${STAMP}`,
      role: "ADMIN",
    },
  });
  referrerId = referrer.id;
  userIds.push(referrer.id);
  const plan = await prisma.servicePlan.create({
    data: {
      code: `TSTV${STAMP}`,
      name: "Test Pro",
      priceMonthly: 399_000,
      priceYearly: 3_990_000,
      isActive: true,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await prisma.platformLedgerEntry.deleteMany({ where: { customerId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.servicePlan.deleteMany({ where: { id: planId } });
  await prisma.$disconnect();
});

describe("computePeriodRollback — dựng lại hạn gói như chưa có khoản bị gỡ", () => {
  const row = (id: string, occurredAt: string, start: string, end: string, planCode = "PRO"): PlanPaymentRow => ({
    id,
    planCode,
    cycle: "QUARTERLY",
    occurredAt: new Date(occurredAt),
    periodStart: new Date(start),
    periodEnd: new Date(end),
  });

  it("khoản cuối, nối tiếp đúng khoản trước → về kỳ của khoản trước", () => {
    const payos = row("a", "2026-11-26T06:10:00Z", "2026-11-26T06:10:00Z", "2027-02-26T06:10:00Z");
    const hand = row("b", "2026-11-26T05:00:00Z", "2027-02-26T06:10:00Z", "2027-05-26T06:10:00Z");
    const r = computePeriodRollback(hand, [payos], []);
    expect(r).toEqual({ ok: true, periodStart: payos.periodStart, periodEnd: payos.periodEnd, shifted: [] });
  });

  it("khoản ghi trước, khoản sau đã nối lên nó → khoản sau dời về ngày thu của chính nó", () => {
    const hand = row("a", "2026-11-26T05:00:00Z", "2026-11-26T05:00:00Z", "2027-02-26T05:00:00Z");
    const payos = row("b", "2026-11-26T06:10:00Z", "2027-02-26T05:00:00Z", "2027-05-26T05:00:00Z");
    const r = computePeriodRollback(hand, [], [payos]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.periodEnd.toISOString()).toBe("2027-02-26T06:10:00.000Z");
    expect(r.shifted).toEqual([
      { id: "b", periodStart: new Date("2026-11-26T06:10:00Z"), periodEnd: new Date("2027-02-26T06:10:00Z") },
    ]);
  });

  it("khoản nối sau một kỳ còn hạn, có khoản sau nữa → khoản sau lùi đúng một kỳ", () => {
    const first = row("a", "2026-08-01T05:00:00Z", "2026-08-01T05:00:00Z", "2026-11-01T05:00:00Z");
    const dup = row("b", "2026-10-20T05:00:00Z", "2026-11-01T05:00:00Z", "2027-02-01T05:00:00Z");
    const next = row("c", "2026-10-25T05:00:00Z", "2027-02-01T05:00:00Z", "2027-05-01T05:00:00Z");
    const r = computePeriodRollback(dup, [first], [next]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.periodEnd.toISOString()).toBe("2027-02-01T05:00:00.000Z");
    expect(r.shifted).toHaveLength(1);
  });

  it("khoản sau KHÁC gói (không nối lên khoản bị gỡ) → không dời gì", () => {
    const first = row("a", "2026-08-01T05:00:00Z", "2026-08-01T05:00:00Z", "2026-11-01T05:00:00Z");
    const dup = row("b", "2026-10-20T05:00:00Z", "2026-11-01T05:00:00Z", "2027-02-01T05:00:00Z");
    const other = row("c", "2026-10-25T05:00:00Z", "2026-10-25T05:00:00Z", "2027-01-25T05:00:00Z", "BIZ");
    const r = computePeriodRollback(dup, [first], [other]);
    expect(r).toEqual({ ok: true, periodStart: other.periodStart, periodEnd: other.periodEnd, shifted: [] });
  });

  it("khoản mở kỳ đầu, không có khoản nào sau → TỪ CHỐI (không biết trạng thái trước đó)", () => {
    const only = row("a", "2026-11-26T05:00:00Z", "2026-11-26T05:00:00Z", "2027-02-26T05:00:00Z");
    expect(computePeriodRollback(only, [], []).ok).toBe(false);
  });

  it("khoản mở kỳ mới rồi khách trả tiếp GÓI KHÁC → TỪ CHỐI (không suy được có nối kỳ cũ hay không)", () => {
    const hand = row("a", "2026-11-26T05:00:00Z", "2026-11-26T05:00:00Z", "2027-02-26T05:00:00Z");
    const other = row("b", "2026-11-27T05:00:00Z", "2026-11-27T05:00:00Z", "2027-02-27T05:00:00Z", "BIZ");
    expect(computePeriodRollback(hand, [], [other]).ok).toBe(false);
  });
});

describe("voidPackagePayment — ca ghi trùng với payOS", () => {
  it("payOS ghi trước, HQ ghi sau: gỡ khoản HQ → hạn về 3 tháng, sổ + chứng từ + tờ nháp + hoa hồng gỡ đủ", async () => {
    const userId = await newPayer("after");
    const walletBefore = await walletBalance();
    const payos = await payByGateway(userId, "after");
    const hand = await payByHand(userId);
    // Trước khi gỡ: hai khoản nối nhau = 6 tháng, hoa hồng cộng hai lần.
    expect(hand.subscription.currentPeriodEnd?.toISOString()).toBe("2027-05-26T06:10:00.000Z");
    expect(await walletBalance()).toBe(walletBefore + 2 * 112_900);

    const entry = await ledgerOf(hand.payment.id);
    draftState.value = "DRAFT";
    draftState.removed = [];

    const preview = await previewVoidPackagePayment(entry.id);
    expect(preview.periodEndBefore).toBe("2027-05-26T06:10:00.000Z");
    expect(preview.periodEndAfter).toBe("2027-02-26T06:10:00.000Z");
    expect(preview.invoiceDraft).toBe("DRAFT");
    expect(preview.commission).toMatchObject({ amount: 112_900, recoverable: true });
    // Xem trước không đổi gì.
    expect(draftState.removed).toEqual([]);
    expect(await prisma.packagePayment.count({ where: { id: hand.payment.id } })).toBe(1);

    const done = await voidPackagePayment(entry.id);
    expect(done.invoiceDraft).toBe("DELETED");
    expect(draftState.removed).toEqual([entry.id]);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(sub.currentPeriodStart.toISOString()).toBe("2026-11-26T06:10:00.000Z");
    expect(sub.currentPeriodEnd?.toISOString()).toBe("2027-02-26T06:10:00.000Z");
    expect(await prisma.packagePayment.count({ where: { id: hand.payment.id } })).toBe(0);
    expect(await prisma.platformLedgerEntry.count({ where: { id: entry.id } })).toBe(0);
    // Khoản payOS còn nguyên: chứng từ + bút toán.
    expect(await prisma.platformLedgerEntry.count({ where: { packagePaymentId: payos.payment.id } })).toBe(1);
    // Hoa hồng: còn đúng một lần, có bút toán thu hồi âm.
    expect(await walletBalance()).toBe(walletBefore + 112_900);
    const reversal = await prisma.walletTransaction.findFirst({
      where: { userId: referrerId, type: "ADJUSTMENT", sourceUserId: userId },
    });
    expect(Number(reversal?.amount)).toBe(-112_900);
  });

  it("HQ ghi trước, payOS ghi sau: gỡ khoản HQ → kỳ payOS dời về tính từ ngày thu của nó", async () => {
    const userId = await newPayer("before");
    const hand = await payByHand(userId);
    const payos = await payByGateway(userId, "before");
    expect(payos.subscription.currentPeriodEnd?.toISOString()).toBe("2027-05-26T05:00:00.000Z");

    draftState.value = "NO_DRAFT";
    const entry = await ledgerOf(hand.payment.id);
    const done = await voidPackagePayment(entry.id);
    expect(done.shiftedPayments).toBe(1);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(sub.currentPeriodEnd?.toISOString()).toBe("2027-02-26T06:10:00.000Z");
    const kept = await prisma.packagePayment.findUniqueOrThrow({ where: { id: payos.payment.id } });
    expect(kept.periodStart.toISOString()).toBe("2026-11-26T06:10:00.000Z");
    expect(kept.periodEnd.toISOString()).toBe("2027-02-26T06:10:00.000Z");
  });
});

describe("voidPackagePayment — các ca phải TỪ CHỐI, không đổi gì", () => {
  it("khoản payOS (máy ghi từ tiền thật) không hủy được", async () => {
    const userId = await newPayer("gw");
    const payos = await payByGateway(userId, "gw");
    const entry = await ledgerOf(payos.payment.id);
    await expect(voidPackagePayment(entry.id)).rejects.toBeInstanceOf(VoidPaymentError);
    expect(await prisma.platformLedgerEntry.count({ where: { id: entry.id } })).toBe(1);
  });

  it("khoản đã có hóa đơn không hủy được", async () => {
    const userId = await newPayer("inv");
    await payByGateway(userId, "inv");
    const hand = await payByHand(userId);
    const entry = await ledgerOf(hand.payment.id);
    await prisma.platformLedgerEntry.update({
      where: { id: entry.id },
      data: { invoiceStatus: "ISSUED", invoiceNo: "00000099" },
    });
    await expect(voidPackagePayment(entry.id)).rejects.toThrow(/đã có hóa đơn/);
    expect(await prisma.packagePayment.count({ where: { id: hand.payment.id } })).toBe(1);
  });

  it("tờ đã ký trên meinvoice.vn (máy chưa kịp lấy số) → dừng, nhả khóa, còn nguyên", async () => {
    const userId = await newPayer("signed");
    await payByGateway(userId, "signed");
    const hand = await payByHand(userId);
    const entry = await ledgerOf(hand.payment.id);
    draftState.value = "SIGNED";
    await expect(voidPackagePayment(entry.id)).rejects.toThrow(/ĐÃ KÝ/);
    const after = await prisma.platformLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.einvoiceAutoLockedAt).toBeNull();
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    expect(sub.currentPeriodEnd?.toISOString()).toBe("2027-05-26T06:10:00.000Z");
    draftState.value = "DRAFT";
  });

  it("khoản HQ ghi là khoản DUY NHẤT của khách (mở kỳ đầu) → từ chối, không đoán hạn gói", async () => {
    const userId = await newPayer("only");
    const hand = await payByHand(userId);
    const entry = await ledgerOf(hand.payment.id);
    await expect(voidPackagePayment(entry.id)).rejects.toThrow(/mở kỳ gói đầu tiên/);
    expect(await prisma.packagePayment.count({ where: { id: hand.payment.id } })).toBe(1);
  });
});
