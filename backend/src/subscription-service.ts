// ============================================================
// GÓI DỊCH VỤ & THUÊ BAO — service dùng chung (GĐ1 thương mại hóa 22/08).
//
// Nghiệp vụ vàng: MỘT lần "ghi nhận thanh toán" tự sinh đủ 4 hệ quả trong
// cùng transaction + 1 bước sau: (1) gia hạn Subscription, (2) chứng từ
// PackagePayment, (3) bút toán THU vào sổ quỹ (trừ thanh toán bằng Ví —
// không có tiền vào quỹ), (4) cờ "chờ xuất hóa đơn"; sau transaction cộng
// hoa hồng giới thiệu 10%. Kế toán không nhập tay, 4 con số không lệch nhau.
//
// Điểm gọi hiện tại: kế toán xác nhận chuyển khoản (/admin), khách dùng Ví
// gia hạn (/referral/renew). Khi cổng thanh toán lên sóng (đăng ký ngay khi
// có GPKD), webhook thanh-toán-thành-công chỉ cần gọi recordPackagePayment
// với method=GATEWAY + externalRef (unique chống webhook bắn lặp).
// ============================================================

import {
  BillingCycle,
  LedgerDirection,
  LedgerInvoiceStatus,
  LedgerSource,
  PackagePaymentMethod,
  Prisma,
} from "@prisma/client";
import { prisma } from "./prisma";
import { creditReferralCommission } from "./referral-wallet";

type Tx = Prisma.TransactionClient;

/** Số tháng của từng chu kỳ mua. */
export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  YEARLY: 12,
};

/** Nhãn tiếng Việt của chu kỳ — dùng cho diễn giải sổ quỹ + danh sách gói. */
export const CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: "1 tháng",
  QUARTERLY: "3 tháng",
  SEMIANNUAL: "6 tháng",
  YEARLY: "12 tháng",
};

/** Giá niêm yết của gói theo chu kỳ (0 = không bán kỳ đó). */
export function planPriceFor(
  plan: {
    priceMonthly: Prisma.Decimal | number;
    priceQuarterly: Prisma.Decimal | number;
    priceSemiannual: Prisma.Decimal | number;
    priceYearly: Prisma.Decimal | number;
  },
  cycle: BillingCycle
): number {
  const raw =
    cycle === BillingCycle.YEARLY
      ? plan.priceYearly
      : cycle === BillingCycle.SEMIANNUAL
        ? plan.priceSemiannual
        : cycle === BillingCycle.QUARTERLY
          ? plan.priceQuarterly
          : plan.priceMonthly;
  return Number(raw);
}

/** Cộng một chu kỳ vào mốc thời gian (1/3/6/12 tháng). */
export function addBillingPeriod(from: Date, cycle: BillingCycle): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + CYCLE_MONTHS[cycle]);
  return next;
}

/**
 * Trạng thái HIỂN THỊ của thuê bao — suy từ dữ liệu lúc đọc, không cần cron:
 * quá hạn (EXPIRED) khi currentPeriodEnd đã qua; null = vô thời hạn (Beta 0đ).
 */
export function effectiveSubscriptionStatus(sub: {
  status: string;
  currentPeriodEnd: Date | null;
}): "ACTIVE" | "EXPIRED" | "CANCELLED" {
  if (sub.status === "CANCELLED") return "CANCELLED";
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now()) return "EXPIRED";
  return "ACTIVE";
}

/**
 * Gán gói MẶC ĐỊNH (cờ isDefault) cho chủ shop chưa có thuê bao — mở kỳ DÙNG
 * THỬ theo trialDays của gói (0 = vô thời hạn, không tính là dùng thử).
 * Gọi fire-and-forget sau đăng ký; không có gói mặc định thì lặng lẽ thôi
 * (trước khi chạy backfill tạo gói, đăng ký vẫn phải hoạt động bình thường).
 */
export async function ensureDefaultSubscription(userId: string): Promise<void> {
  try {
    const existing = await prisma.subscription.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) return;
    const plan = await prisma.servicePlan.findFirst({
      where: { isDefault: true, isActive: true },
      select: { id: true, trialDays: true },
    });
    if (!plan) return;
    const trial = plan.trialDays > 0;
    await prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        isTrial: trial,
        currentPeriodEnd: trial
          ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000)
          : null,
      },
    });
  } catch (err) {
    // Không được làm gãy luồng đăng ký vì chuyện gán gói.
    console.error(`[Subscription] Gán gói mặc định cho ${userId} lỗi:`, err);
  }
}

export interface RecordPaymentInput {
  userId: string;
  planId: string;
  cycle: BillingCycle;
  /** Số tiền THỰC THU — vắng mặt thì lấy giá niêm yết của gói theo chu kỳ. */
  amount?: number;
  method: PackagePaymentMethod;
  /** Ngày thực nhận tiền (khớp sao kê) — mặc định bây giờ. */
  occurredAt?: Date;
  note?: string | null;
  externalRef?: string | null;
  /** Người xác nhận (kế toán) — WALLET/GATEWAY tự ghi "Hệ thống". */
  actorId?: string | null;
  actorName?: string | null;
}

/**
 * Phần lõi chạy TRONG transaction của người gọi — cho phép luồng Ví gói chung
 * việc trừ ví + ghi nhận thanh toán vào MỘT transaction nguyên tử.
 *
 * Quy tắc kỳ hạn: cùng gói và kỳ cũ còn hạn → NỐI TIẾP từ cuối kỳ (khách gia
 * hạn sớm không mất ngày); đổi gói (nâng/hạ cấp) hoặc đã quá hạn → kỳ mới
 * bắt đầu từ ngày thu tiền. Số tiền thu thêm khi nâng gói giữa kỳ do kế toán
 * tự quyết ở ô amount (proration tự động chờ GĐ cổng thanh toán).
 */
export async function recordPackagePaymentTx(tx: Tx, input: RecordPaymentInput) {
  const plan = await tx.servicePlan.findUniqueOrThrow({ where: { id: input.planId } });

  const amount = input.amount ?? planPriceFor(plan, input.cycle);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Số tiền thanh toán không hợp lệ");
  }

  const occurredAt = input.occurredAt ?? new Date();
  const existing = await tx.subscription.findUnique({ where: { userId: input.userId } });

  const samePlanStillRunning =
    existing !== null &&
    existing.planId === plan.id &&
    existing.currentPeriodEnd !== null &&
    existing.currentPeriodEnd.getTime() > occurredAt.getTime();
  const periodStart = samePlanStillRunning ? existing.currentPeriodEnd! : occurredAt;
  const periodEnd = addBillingPeriod(periodStart, input.cycle);

  // Thanh toán đầu tiên kết thúc kỳ dùng thử — hạ cờ isTrial.
  const subscription = await tx.subscription.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      planId: plan.id,
      isTrial: false,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
    update: {
      planId: plan.id,
      status: "ACTIVE",
      isTrial: false,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });

  const cycleLabel = CYCLE_LABEL[input.cycle];
  const confirmedByName =
    input.actorName ??
    (input.method === PackagePaymentMethod.WALLET ? "Hệ thống (Ví Hubsell)" : "Hệ thống");

  const payment = await tx.packagePayment.create({
    data: {
      subscriptionId: subscription.id,
      userId: input.userId,
      planCode: plan.code,
      planName: plan.name,
      cycle: input.cycle,
      amount,
      method: input.method,
      periodStart,
      periodEnd,
      occurredAt,
      externalRef: input.externalRef ?? null,
      note: input.note?.trim() ? input.note.trim() : null,
      confirmedById: input.actorId ?? null,
      confirmedByName,
    },
  });

  // Sổ quỹ: chỉ ghi khi có TIỀN THẬT vào (chuyển khoản/cổng). Thanh toán bằng
  // Ví Hubsell là bù trừ công nợ hoa hồng — không có dòng tiền vào quỹ, kế
  // toán dịch vụ xử lý từ export chứng từ PackagePayment, ghi IN sẽ SAI quỹ.
  if (input.method !== PackagePaymentMethod.WALLET && amount > 0) {
    await tx.platformLedgerEntry.create({
      data: {
        direction: LedgerDirection.IN,
        source: LedgerSource.SUBSCRIPTION,
        amount,
        note: `Thu phí gói ${plan.name} — ${cycleLabel}`,
        customerId: input.userId,
        packagePaymentId: payment.id,
        occurredAt,
        invoiceStatus: LedgerInvoiceStatus.PENDING,
        createdById: input.actorId ?? null,
        createdByName: confirmedByName,
      },
    });
  }

  return { payment, subscription, plan };
}

/**
 * Bản đầy đủ: tự mở transaction + cộng hoa hồng giới thiệu 10% sau khi chốt
 * (mọi lượt thanh toán thành công đều tính — "hoa hồng vĩnh viễn").
 */
export async function recordPackagePayment(input: RecordPaymentInput) {
  const result = await prisma.$transaction((tx) => recordPackagePaymentTx(tx, input));
  const amount = Number(result.payment.amount);
  if (amount > 0) {
    await creditReferralCommission(
      input.userId,
      amount,
      undefined
    ).catch((err) => console.error("[Subscription] Cộng hoa hồng giới thiệu lỗi:", err));
  }
  return result;
}
