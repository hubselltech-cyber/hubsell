// ============================================================
// CRM TỰ CHUYỂN TRẠNG THÁI THEO THUÊ BAO trên DB dev (services/care-auto-status.ts,
// 22/10/2026): worker hết gói → Đã rời bỏ (tạo hồ sơ thiếu, đè hồ sơ cũ, giữ
// quyết định tay sau hết gói, bỏ qua trong ân hạn + tài khoản điều hành, idempotent,
// ghi Nhật ký thao tác); thanh toán → Đang dùng ổn định kể cả từ Đã rời bỏ, giữ
// ghi chú/phụ trách, 0đ không tính. Tự dọn dữ liệu test.
// ============================================================

import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformCareStatus, PlatformCareStatusSource } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { CARE_AUTO_AUDIT_ACTION, churnExpiredOwners } from "../care-auto-status";
import { recordPackagePaymentTx } from "../subscription-service";

const DAY_MS = 86_400_000;
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY_MS);
const suffix = `care-${Date.now()}`;

interface Fx {
  planId: string;
  users: Record<string, string>;
}

async function mkUser(tag: string, opts: { periodEndDaysAgo: number; isPlatformAdmin?: boolean }): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `test-${suffix}-${tag}@hubsell.test`,
      passwordHash: "x",
      fullName: `TEST ${suffix} ${tag}`,
      role: "ADMIN",
      isPlatformAdmin: opts.isPlatformAdmin ?? false,
      createdAt: daysAgo(opts.periodEndDaysAgo + 14),
    },
  });
  return u.id;
}

describe("CRM tự chuyển trạng thái theo thuê bao (DB dev)", () => {
  const fx: Fx = { planId: "", users: {} };

  beforeAll(async () => {
    const plan = await prisma.servicePlan.create({
      data: { code: `TEST-${suffix}`, name: `Gói test ${suffix}`, isActive: true, priceMonthly: 100_000, trialDays: 14 },
    });
    fx.planId = plan.id;

    // A: hết dùng thử 20 ngày, chưa có hồ sơ → tạo CHURNED.
    // B: hết 20 ngày, Sale đặt CONTACTED 3 ngày trước (SAU hết gói) → giữ.
    // C: hết 20 ngày, Sale đặt CHURN_RISK 30 ngày trước (TRƯỚC hết gói), có ghi chú → CHURNED, ghi chú giữ.
    // D: hết 5 ngày — trong ân hạn → không đụng.
    // E: tài khoản điều hành hết 20 ngày → không đụng.
    // F: đã CHURNED tay → không ghi lại (idempotent, không nhật ký mới).
    // G, H: như A — để trang 1 dòng có nhiều ứng viên liên tiếp (bẫy cursor + skip).
    const spec: Record<string, { end: number; admin?: boolean; care?: { status: PlatformCareStatus; changedDaysAgo: number; note?: string } }> = {
      A: { end: 20 },
      B: { end: 20, care: { status: "CONTACTED", changedDaysAgo: 3 } },
      C: { end: 20, care: { status: "CHURN_RISK", changedDaysAgo: 30, note: "gọi 2 lần không nghe" } },
      D: { end: 5 },
      E: { end: 20, admin: true },
      F: { end: 20, care: { status: "CHURNED", changedDaysAgo: 1 } },
      G: { end: 40 },
      H: { end: 9 },
    };
    for (const [tag, s] of Object.entries(spec)) {
      const id = await mkUser(tag, { periodEndDaysAgo: s.end, isPlatformAdmin: s.admin });
      fx.users[tag] = id;
      await prisma.subscription.create({
        data: { userId: id, planId: plan.id, isTrial: true, currentPeriodStart: daysAgo(s.end + 14), currentPeriodEnd: daysAgo(s.end) },
      });
      if (s.care) {
        await prisma.platformCustomerCare.create({
          data: {
            userId: id,
            status: s.care.status,
            statusSource: PlatformCareStatusSource.MANUAL,
            statusChangedAt: daysAgo(s.care.changedDaysAgo),
            note: s.care.note ?? null,
          },
        });
      }
    }
  });

  afterAll(async () => {
    const ids = Object.values(fx.users);
    if (ids.length) {
      await prisma.platformLedgerEntry.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.platformAuditLog.deleteMany({ where: { targetUserId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } }); // cascade: care, subscription, payments
    }
    if (fx.planId) await prisma.servicePlan.delete({ where: { id: fx.planId } }).catch(() => undefined);
  });

  const care = (tag: string) =>
    prisma.platformCustomerCare.findUnique({
      where: { userId: fx.users[tag] },
      select: { status: true, statusSource: true, note: true, assigneeId: true },
    });
  const auditCount = (tag: string) =>
    prisma.platformAuditLog.count({ where: { targetUserId: fx.users[tag], action: CARE_AUTO_AUDIT_ACTION } });

  it("worker: hết gói quá ân hạn → Đã rời bỏ đúng người, giữ quyết định tay sau hết gói, ghi nhật ký", async () => {
    // pageSize 1: mỗi dòng một trang, dòng vừa chuyển CHURNED rơi khỏi điều kiện lọc —
    // phân trang phải là `id > cursor`, dùng cursor + skip 1 của Prisma sẽ bỏ sót
    // (A/C/G/H là 4 ứng viên liên tiếp theo id).
    const r = await churnExpiredOwners(now, 1);
    expect(r.scanned).toBeGreaterThanOrEqual(6);

    expect(await care("A")).toMatchObject({ status: "CHURNED", statusSource: "AUTO_EXPIRED" });
    expect(await care("G")).toMatchObject({ status: "CHURNED", statusSource: "AUTO_EXPIRED" });
    expect(await care("H")).toMatchObject({ status: "CHURNED", statusSource: "AUTO_EXPIRED" });
    expect(await care("C")).toMatchObject({ status: "CHURNED", statusSource: "AUTO_EXPIRED", note: "gọi 2 lần không nghe" });
    expect(await care("B")).toMatchObject({ status: "CONTACTED", statusSource: "MANUAL" });
    expect(await care("D")).toBeNull();
    expect(await care("E")).toBeNull();
    expect(await care("F")).toMatchObject({ status: "CHURNED", statusSource: "MANUAL" });

    expect(await auditCount("A")).toBe(1);
    expect(await auditCount("C")).toBe(1);
    expect(await auditCount("B")).toBe(0);
    expect(await auditCount("F")).toBe(0);
    const log = await prisma.platformAuditLog.findFirst({ where: { targetUserId: fx.users["A"], action: CARE_AUTO_AUDIT_ACTION } });
    expect(log?.actorId).toBeNull();
    expect(log?.detail).toMatchObject({ status: "CHURNED", reason: "EXPIRED", from: null, isTrial: true });
  });

  it("worker chạy lặp: không ghi lại, không nhật ký mới", async () => {
    await churnExpiredOwners(now, 1);
    expect(await auditCount("A")).toBe(1);
    expect(await auditCount("C")).toBe(1);
    expect(await care("B")).toMatchObject({ status: "CONTACTED" });
  });

  it("thanh toán: Đã rời bỏ quay lại trả tiền → Đang dùng ổn định, ghi chú giữ nguyên; thanh toán lặp không nhật ký thêm", async () => {
    const r = await prisma.$transaction((tx) =>
      recordPackagePaymentTx(tx, { userId: fx.users["C"], planId: fx.planId, cycle: "MONTHLY", method: "BANK_TRANSFER", occurredAt: now })
    );
    expect(Number(r.payment.amount)).toBe(100_000);
    expect(await care("C")).toMatchObject({ status: "ACTIVE", statusSource: "AUTO_PAYMENT", note: "gọi 2 lần không nghe" });
    expect(await auditCount("C")).toBe(2);

    // Gia hạn tiếp khi đang ACTIVE: trạng thái không đổi → không ghi nhật ký.
    await prisma.$transaction((tx) =>
      recordPackagePaymentTx(tx, { userId: fx.users["C"], planId: fx.planId, cycle: "MONTHLY", method: "BANK_TRANSFER", occurredAt: now })
    );
    expect(await auditCount("C")).toBe(2);

    // Kỳ mới ở tương lai → worker không rời bỏ lại.
    await churnExpiredOwners(now, 1);
    expect(await care("C")).toMatchObject({ status: "ACTIVE" });
  });

  it("thanh toán cho khách CHƯA có hồ sơ → tạo hồ sơ ACTIVE", async () => {
    await prisma.$transaction((tx) =>
      recordPackagePaymentTx(tx, { userId: fx.users["D"], planId: fx.planId, cycle: "MONTHLY", method: "WALLET", occurredAt: now })
    );
    expect(await care("D")).toMatchObject({ status: "ACTIVE", statusSource: "AUTO_PAYMENT" });
    expect(await auditCount("D")).toBe(1);
  });

  it("đổi gói 0đ không tính là thanh toán → trạng thái giữ nguyên", async () => {
    await prisma.$transaction((tx) =>
      recordPackagePaymentTx(tx, { userId: fx.users["B"], planId: fx.planId, cycle: "MONTHLY", amount: 0, method: "BANK_TRANSFER", occurredAt: now })
    );
    expect(await care("B")).toMatchObject({ status: "CONTACTED", statusSource: "MANUAL" });
    expect(await auditCount("B")).toBe(0);
  });
});
