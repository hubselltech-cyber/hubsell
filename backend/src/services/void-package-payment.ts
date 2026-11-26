// ============================================================
// HỦY GHI NHẬN một khoản thanh toán gói do HQ XÁC NHẬN TAY (26/11/2026).
//
// Vì sao có: HQ bấm "Xác nhận đã nhận tiền" cho một khách mà cổng payOS ĐÃ tự ghi
// khoản đó rồi → cùng một lần chuyển khoản thành HAI khoản thu. Dòng sổ quỹ của khoản
// ghi tay mang packagePaymentId nên không xóa được như bút toán ghi tay — và xóa lẻ
// dòng sổ cũng SAI, vì một lần ghi nhận sinh ra nhiều thứ (subscription-service.ts):
// gia hạn thuê bao, chứng từ PackagePayment, bút toán THU, tờ nháp hóa đơn trên
// meinvoice.vn, hoa hồng giới thiệu. Hủy ghi nhận = gỡ lại ĐỦ các thứ đó.
//
// Phạm vi CỐ Ý hẹp:
//   · Chỉ khoản kind PLAN, method BANK_TRANSFER, có người xác nhận (HQ bấm tay).
//     Khoản payOS / Apple / Ví là tiền thật do máy ghi — không hủy ở đây.
//   · Chỉ khi CHƯA có hóa đơn (chưa có số, chưa ký trên meinvoice.vn). Tờ đã ký là
//     chứng từ thuế — phải hủy / điều chỉnh hóa đơn theo luật trước.
//   · Chỉ khi máy DỰNG LẠI ĐƯỢC CHẮC CHẮN hạn gói như chưa từng có khoản này
//     (computePeriodRollback). Không chắc thì TỪ CHỐI kèm lý do — không đoán hạn gói
//     của khách đang trả tiền.
//
// Không gỡ được (và không cố): thư "gói đã kích hoạt" đã gửi khách, yêu cầu mua gói
// đã tự đóng, trạng thái chăm sóc "Đang dùng ổn định".
// ============================================================

import {
  BillingCycle,
  LedgerDirection,
  LedgerInvoiceStatus,
  PackagePaymentKind,
  PackagePaymentMethod,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  inspectHqWebDraft,
  LOCK_TTL_MS,
  type HqWebDraftState,
} from "../integrations/invoice/hq-auto-invoice";
import { invalidatePlanState } from "./plan-enforcement";
import { addBillingPeriod } from "./subscription-service";

type Db = Prisma.TransactionClient;

export class VoidPaymentError extends Error {
  constructor(message: string, readonly httpStatus = 400) {
    super(message);
    this.name = "VoidPaymentError";
  }
}

// ---------------- Dựng lại hạn gói (thuần, không chạm DB) ----------------

export interface PlanPaymentRow {
  id: string;
  planCode: string;
  cycle: BillingCycle;
  occurredAt: Date;
  periodStart: Date;
  periodEnd: Date;
}

export type PeriodRollback =
  | {
      ok: true;
      /** Kỳ hiện tại của thuê bao sau khi gỡ khoản. */
      periodStart: Date;
      periodEnd: Date;
      /** Khoản ghi SAU khoản bị gỡ phải dời kỳ (đã nối tiếp lên nó). */
      shifted: { id: string; periodStart: Date; periodEnd: Date }[];
    }
  | { ok: false; reason: string };

/**
 * Hạn gói sẽ ra sao nếu khoản `target` chưa từng được ghi — chạy lại ĐÚNG luật
 * kỳ hạn của recordPackagePaymentTx (cùng gói còn hạn → nối tiếp từ cuối kỳ; đổi
 * gói / đã hết hạn → kỳ mới từ ngày thu) cho các khoản ghi sau nó.
 * `earlier` / `later`: các khoản kind PLAN cùng thuê bao, xếp theo lúc ghi tăng dần.
 */
export function computePeriodRollback(
  target: PlanPaymentRow,
  earlier: PlanPaymentRow[],
  later: PlanPaymentRow[]
): PeriodRollback {
  // Khoản nối tiếp kỳ cũ thì kỳ của nó bắt đầu ở cuối kỳ cũ (sau ngày thu);
  // khoản mở kỳ mới thì bắt đầu đúng ngày thu.
  const chained = target.periodStart.getTime() !== target.occurredAt.getTime();

  if (later.length === 0) {
    const prev = earlier[earlier.length - 1];
    if (
      chained &&
      prev &&
      prev.planCode === target.planCode &&
      prev.periodEnd.getTime() === target.periodStart.getTime()
    ) {
      return { ok: true, periodStart: prev.periodStart, periodEnd: prev.periodEnd, shifted: [] };
    }
    return {
      ok: false,
      reason:
        "Khoản này mở kỳ gói đầu tiên (hoặc đổi gói / nối sau kỳ dùng thử) của khách — máy không còn giữ trạng thái gói trước đó nên không tự trả lại được",
    };
  }

  // Trạng thái thuê bao ngay TRƯỚC khoản bị gỡ: biết chắc khi nó nối tiếp (cùng
  // gói, hết hạn đúng lúc kỳ của nó bắt đầu); không nối tiếp thì chỉ biết là
  // "không phải cùng gói còn hạn".
  let state: { planCode: string; end: Date } | null = chained
    ? { planCode: target.planCode, end: target.periodStart }
    : null;
  let lastStart = target.periodStart;
  const shifted: { id: string; periodStart: Date; periodEnd: Date }[] = [];

  for (const l of later) {
    let chains: boolean;
    if (state === null) {
      // Trước khoản bị gỡ là gói khác, hoặc cùng gói đã hết hạn. Khoản kế tiếp CÙNG
      // gói và thu không sớm hơn → chắc chắn không nối tiếp gì cả. Còn lại không suy được.
      if (l.planCode !== target.planCode || l.occurredAt.getTime() < target.occurredAt.getTime()) {
        return {
          ok: false,
          reason:
            "Sau khoản này khách còn khoản thanh toán gói khác / lùi ngày — máy không suy lại chắc chắn được hạn gói",
        };
      }
      chains = false;
    } else {
      chains = state.planCode === l.planCode && state.end.getTime() > l.occurredAt.getTime();
    }
    const start: Date = chains ? state!.end : l.occurredAt;
    const end = addBillingPeriod(start, l.cycle);
    if (start.getTime() !== l.periodStart.getTime() || end.getTime() !== l.periodEnd.getTime()) {
      shifted.push({ id: l.id, periodStart: start, periodEnd: end });
    }
    state = { planCode: l.planCode, end };
    lastStart = start;
  }
  return { ok: true, periodStart: lastStart, periodEnd: state!.end, shifted };
}

// ---------------- Đọc + kiểm một khoản có hủy được không ----------------

const ENTRY_SELECT = {
  id: true,
  direction: true,
  amount: true,
  note: true,
  occurredAt: true,
  invoiceStatus: true,
  invoiceNo: true,
  einvoiceTransactionId: true,
  appleSettlementId: true,
  createdByName: true,
  customer: { select: { id: true, email: true, fullName: true, referredById: true } },
  packagePayment: true,
} as const;

/** Hoa hồng giới thiệu đã cộng cho khoản này (nếu có) và có thu hồi được không. */
export interface VoidCommission {
  walletTxnId: string;
  referrerId: string;
  referrerLabel: string;
  amount: number;
  /** false = ví người giới thiệu không còn đủ (đã rút / đã dùng) → KHÔNG trừ, báo HQ. */
  recoverable: boolean;
}

interface VoidPlan {
  entry: Prisma.PlatformLedgerEntryGetPayload<{ select: typeof ENTRY_SELECT }>;
  payment: NonNullable<Prisma.PlatformLedgerEntryGetPayload<{ select: typeof ENTRY_SELECT }>["packagePayment"]>;
  subscriptionId: string;
  periodEndBefore: Date | null;
  rollback: Extract<PeriodRollback, { ok: true }>;
  commission: VoidCommission | null;
}

const COMMISSION_WINDOW_MS = 10 * 60 * 1000;
/** Dấu nối bút toán thu hồi ↔ bút toán hoa hồng gốc (sổ ví không có cột liên kết). */
const reversalMark = (walletTxnId: string) => `(mã ${walletTxnId})`;

function toRow(p: {
  id: string;
  planCode: string;
  cycle: BillingCycle;
  occurredAt: Date;
  periodStart: Date;
  periodEnd: Date;
}): PlanPaymentRow {
  return {
    id: p.id,
    planCode: p.planCode,
    cycle: p.cycle,
    occurredAt: p.occurredAt,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
  };
}

async function findCommission(
  db: Db,
  payment: { userId: string; amount: Prisma.Decimal; createdAt: Date },
  referrerId: string | null
): Promise<VoidCommission | null> {
  const amount = Number(payment.amount);
  if (!referrerId || amount <= 0) return null;
  // creditReferralCommission chạy ngay sau khi ghi nhận và ghi số tiền vào diễn giải.
  const candidates = await db.walletTransaction.findMany({
    where: {
      userId: referrerId,
      type: "COMMISSION",
      sourceUserId: payment.userId,
      createdAt: {
        gte: payment.createdAt,
        lte: new Date(payment.createdAt.getTime() + COMMISSION_WINDOW_MS),
      },
      note: { contains: `${amount.toLocaleString("vi-VN")}₫` },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, amount: true },
  });
  for (const c of candidates) {
    const reversed = await db.walletTransaction.findFirst({
      where: { userId: referrerId, type: "ADJUSTMENT", note: { contains: reversalMark(c.id) } },
      select: { id: true },
    });
    if (reversed) continue;
    const [wallet, referrer] = await Promise.all([
      db.hubsellWallet.findUnique({ where: { userId: referrerId }, select: { balance: true } }),
      db.user.findUnique({ where: { id: referrerId }, select: { email: true, fullName: true } }),
    ]);
    const value = Number(c.amount);
    return {
      walletTxnId: c.id,
      referrerId,
      referrerLabel: referrer ? (referrer.email ?? referrer.fullName) : referrerId,
      amount: value,
      recoverable: Number(wallet?.balance ?? 0) >= value,
    };
  }
  return null;
}

async function buildVoidPlan(db: Db, entryId: string): Promise<VoidPlan> {
  const entry = await db.platformLedgerEntry.findUnique({
    where: { id: entryId },
    select: ENTRY_SELECT,
  });
  if (!entry) throw new VoidPaymentError("Không tìm thấy bút toán", 404);
  const payment = entry.packagePayment;
  if (entry.direction !== LedgerDirection.IN || !payment) {
    throw new VoidPaymentError("Dòng này không phải khoản thu phí gói — bút toán ghi tay thì xoá bằng nút thùng rác");
  }
  if (entry.appleSettlementId) {
    throw new VoidPaymentError("Khoản bán qua App Store đã vào một đợt Apple chuyển — không hủy ở đây");
  }
  if (payment.method !== PackagePaymentMethod.BANK_TRANSFER || !payment.confirmedById) {
    throw new VoidPaymentError(
      "Khoản này do máy ghi từ tiền thật đã về (payOS / App Store) — chỉ hủy được khoản HQ tự bấm xác nhận"
    );
  }
  if (payment.kind !== PackagePaymentKind.PLAN) {
    throw new VoidPaymentError("Chỉ hủy được khoản mua / gia hạn gói — phí vượt và giờ quay chưa hủy ở đây");
  }
  if (
    entry.invoiceStatus === LedgerInvoiceStatus.ISSUED ||
    entry.einvoiceTransactionId ||
    entry.invoiceNo
  ) {
    throw new VoidPaymentError(
      `Dòng này đã có hóa đơn${entry.invoiceNo ? ` số ${entry.invoiceNo}` : ""} — hóa đơn đã lập phải hủy / điều chỉnh theo luật trước, không gỡ khoản thu được`,
      409
    );
  }

  const sub = await db.subscription.findUnique({
    where: { id: payment.subscriptionId },
    select: { id: true, currentPeriodEnd: true, plan: { select: { code: true } } },
  });
  if (!sub) throw new VoidPaymentError("Không tìm thấy thuê bao của khoản này", 404);

  const all = await db.packagePayment.findMany({
    where: { subscriptionId: sub.id, kind: PackagePaymentKind.PLAN },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, planCode: true, cycle: true, occurredAt: true, periodStart: true, periodEnd: true },
  });
  const idx = all.findIndex((p) => p.id === payment.id);
  if (idx < 0) throw new VoidPaymentError("Không tìm thấy chứng từ thanh toán của dòng này", 404);
  const earlier = all.slice(0, idx).map(toRow);
  const later = all.slice(idx + 1).map(toRow);

  // Hạn gói đang lưu phải còn là hệ quả của khoản thanh toán gần nhất — HQ đã đổi
  // gói / chỉnh hạn sau đó thì phép dựng lại bên dưới không còn đúng.
  const latest = all[all.length - 1];
  if (
    sub.plan.code !== latest.planCode ||
    !sub.currentPeriodEnd ||
    sub.currentPeriodEnd.getTime() !== latest.periodEnd.getTime()
  ) {
    throw new VoidPaymentError(
      "Hạn gói hiện tại của khách không còn khớp khoản thanh toán gần nhất (đã đổi gói / chỉnh hạn sau đó) — máy không tự trả hạn gói được",
      409
    );
  }

  const rollback = computePeriodRollback(toRow(payment), earlier, later);
  if (!rollback.ok) throw new VoidPaymentError(rollback.reason, 409);

  const commission = await findCommission(db, payment, entry.customer?.referredById ?? null);
  return {
    entry,
    payment,
    subscriptionId: sub.id,
    periodEndBefore: sub.currentPeriodEnd,
    rollback,
    commission,
  };
}

// ---------------- Xem trước + thực hiện ----------------

export interface VoidPaymentSummary {
  entryId: string;
  customer: { id: string; email: string | null; fullName: string } | null;
  amount: number;
  note: string | null;
  occurredAt: string;
  planName: string;
  cycle: BillingCycle;
  /** Hạn gói của khách trước → sau khi gỡ. */
  periodEndBefore: string | null;
  periodEndAfter: string;
  /** Số khoản thanh toán ghi sau phải dời kỳ theo. */
  shiftedPayments: number;
  /** Tờ của dòng này trên meinvoice.vn. "UNKNOWN" = chưa hỏi được MISA (chỉ ở bản xem trước). */
  invoiceDraft: HqWebDraftState | "UNKNOWN";
  commission: { amount: number; referrerLabel: string; recoverable: boolean } | null;
}

function summarize(plan: VoidPlan, invoiceDraft: VoidPaymentSummary["invoiceDraft"]): VoidPaymentSummary {
  const c = plan.entry.customer;
  return {
    entryId: plan.entry.id,
    customer: c ? { id: c.id, email: c.email, fullName: c.fullName } : null,
    amount: Number(plan.payment.amount),
    note: plan.entry.note,
    occurredAt: plan.entry.occurredAt.toISOString(),
    planName: plan.payment.planName,
    cycle: plan.payment.cycle,
    periodEndBefore: plan.periodEndBefore?.toISOString() ?? null,
    periodEndAfter: plan.rollback.periodEnd.toISOString(),
    shiftedPayments: plan.rollback.shifted.length,
    invoiceDraft,
    commission: plan.commission
      ? {
          amount: plan.commission.amount,
          referrerLabel: plan.commission.referrerLabel,
          recoverable: plan.commission.recoverable,
        }
      : null,
  };
}

const SIGNED_MESSAGE =
  "Tờ hóa đơn của dòng này ĐÃ KÝ trên meinvoice.vn — không gỡ khoản thu được nữa. Hóa đơn đã lập phải hủy / điều chỉnh theo luật trước";

/** Xem trước: gỡ khoản này thì đổi những gì. Không ghi gì, không xóa gì. */
export async function previewVoidPackagePayment(entryId: string): Promise<VoidPaymentSummary> {
  const plan = await buildVoidPlan(prisma, entryId);
  let draft: VoidPaymentSummary["invoiceDraft"];
  try {
    draft = await inspectHqWebDraft(entryId, { remove: false });
  } catch (err) {
    console.warn(`[void-payment] Chưa hỏi được meinvoice.vn về tờ của ${entryId}: ${(err as Error).message}`);
    draft = "UNKNOWN";
  }
  if (draft === "SIGNED") throw new VoidPaymentError(SIGNED_MESSAGE, 409);
  return summarize(plan, draft);
}

/**
 * Thực hiện. Thứ tự cố ý: (1) kiểm, (2) giành khóa hóa đơn của bút toán để vòng tự
 * xuất hóa đơn không đẩy lại tờ nháp giữa chừng, (3) xóa tờ nháp trên meinvoice.vn —
 * hỏng thì DỪNG, chưa gỡ gì, (4) một giao dịch: trả hạn gói + xóa bút toán + xóa
 * chứng từ + thu hồi hoa hồng. Bước 4 hỏng thì bút toán còn nguyên (PENDING), máy
 * tự đẩy lại tờ nháp ở vòng sau — không có trạng thái lơ lửng.
 */
export async function voidPackagePayment(entryId: string): Promise<VoidPaymentSummary> {
  await buildVoidPlan(prisma, entryId);

  const now = new Date();
  const locked = await prisma.platformLedgerEntry.updateMany({
    where: {
      id: entryId,
      OR: [
        { einvoiceAutoLockedAt: null },
        { einvoiceAutoLockedAt: { lt: new Date(now.getTime() - LOCK_TTL_MS) } },
      ],
    },
    data: { einvoiceAutoLockedAt: now },
  });
  if (locked.count !== 1) {
    throw new VoidPaymentError("Máy đang xử lý hóa đơn của dòng này — đợi vài phút rồi bấm lại", 409);
  }
  const unlock = () =>
    prisma.platformLedgerEntry
      .updateMany({ where: { id: entryId }, data: { einvoiceAutoLockedAt: null } })
      .catch(() => undefined);

  let draft: HqWebDraftState;
  try {
    draft = await inspectHqWebDraft(entryId, { remove: true });
  } catch (err) {
    await unlock();
    throw new VoidPaymentError(
      `Chưa xóa được tờ nháp hóa đơn trên meinvoice.vn (${(err as Error).message}). Chưa gỡ gì cả — thử lại, hoặc xóa tay tờ nháp của dòng này trên meinvoice.vn rồi bấm lại.`,
      502
    );
  }
  if (draft === "SIGNED") {
    await unlock();
    throw new VoidPaymentError(SIGNED_MESSAGE, 409);
  }

  let plan: VoidPlan;
  try {
    plan = await prisma.$transaction(async (tx) => {
      // Dựng lại TRONG giao dịch — dữ liệu có thể đã đổi từ lúc kiểm ở trên.
      const p = await buildVoidPlan(tx, entryId);
      for (const s of p.rollback.shifted) {
        await tx.packagePayment.update({
          where: { id: s.id },
          data: { periodStart: s.periodStart, periodEnd: s.periodEnd },
        });
      }
      await tx.subscription.update({
        where: { id: p.subscriptionId },
        data: { currentPeriodStart: p.rollback.periodStart, currentPeriodEnd: p.rollback.periodEnd },
      });
      await tx.platformLedgerEntry.delete({ where: { id: p.entry.id } });
      await tx.packagePayment.delete({ where: { id: p.payment.id } });

      if (p.commission?.recoverable) {
        const c = p.commission;
        // Trừ có điều kiện: ví vừa bị rút mất giữa chừng thì thôi, không để âm.
        const taken = await tx.hubsellWallet.updateMany({
          where: { userId: c.referrerId, balance: { gte: c.amount } },
          data: { balance: { decrement: c.amount } },
        });
        if (taken.count === 1) {
          await tx.walletTransaction.create({
            data: {
              userId: c.referrerId,
              type: "ADJUSTMENT",
              amount: -c.amount,
              status: "COMPLETED",
              sourceUserId: p.payment.userId,
              note: `Thu hồi hoa hồng — Hubsell hủy một khoản thanh toán ghi trùng ${reversalMark(c.walletTxnId)}`,
            },
          });
        } else {
          p.commission = { ...c, recoverable: false };
        }
      }
      return p;
    });
  } catch (err) {
    await unlock();
    throw err;
  }

  invalidatePlanState(plan.payment.userId);
  return summarize(plan, draft);
}
