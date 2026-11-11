// ============================================================
// THU / MIỄN PHIẾU PHÍ VƯỢT TRẦN ĐƠN — khách trả một phiếu = "MUA THÊM N ĐƠN HÀNG" (anh
// Trung chốt 11/11/2026: hóa đơn xuất lúc tiền về như mua gói, không công nợ).
//
// Đi chung lõi của thanh toán gói: chứng từ PackagePayment → sổ quỹ → HĐĐT → hoa hồng giới
// thiệu 10 %, nhưng KHÔNG gia hạn thuê bao, không đánh thức gian ngủ đông, không đóng yêu
// cầu mua gói — vì vậy tách khỏi subscription-service (nơi mỗi khoản thu là một kỳ hạn).
//
// Ba cửa gọi: cổng payOS (gateway-checkout.ts → settleGatewayOrder), HQ ghi nhận chuyển
// khoản tay và HQ miễn (routes/admin-plans.ts). Phép tính ra phiếu: plan-overage.ts.
// ============================================================

import {
  BillingCycle,
  LedgerDirection,
  LedgerInvoiceStatus,
  LedgerSource,
  PackagePaymentMethod,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { kickHqAutoInvoice } from "../integrations/invoice/hq-auto-invoice";
import { invalidatePlanState } from "./plan-enforcement";
import { monthLabel, vnMonthBounds } from "./plan-overage";
import { creditReferralCommission } from "./referral-wallet";

type Tx = Prisma.TransactionClient;

/** Lỗi nói được với người dùng (phiếu đã đóng, thiếu lý do miễn…) — route trả 400. */
export class OverageChargeError extends Error {}

export interface RecordOveragePaymentInput {
  chargeId: string;
  /** Số tiền THỰC THU — vắng mặt = đúng số trên phiếu. */
  amount?: number;
  method: PackagePaymentMethod;
  occurredAt?: Date;
  note?: string | null;
  externalRef?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

/** Phần lõi chạy TRONG transaction của người gọi (cổng gắn thêm việc đánh dấu đơn PAID). */
export async function recordOveragePaymentTx(tx: Tx, input: RecordOveragePaymentInput) {
  const occurredAt = input.occurredAt ?? new Date();
  // Giành phiếu bằng một câu UPDATE có điều kiện: webhook + poll + HQ ghi tay đua nhau
  // thì đúng MỘT bên thắng, bên thua nhận lỗi tiếng người (không thu đôi).
  const claimed = await tx.planOverageCharge.updateMany({
    where: { id: input.chargeId, status: "OPEN" },
    data: { status: "PAID", paidAt: occurredAt },
  });
  if (claimed.count === 0) {
    throw new OverageChargeError("Phiếu phí vượt không tồn tại, đã được thanh toán hoặc đã được miễn");
  }
  const charge = await tx.planOverageCharge.findUniqueOrThrow({ where: { id: input.chargeId } });
  const subscription = await tx.subscription.findUnique({ where: { userId: charge.ownerId } });
  if (!subscription) throw new OverageChargeError("Tài khoản không còn thuê bao để ghi chứng từ");

  const amount = input.amount ?? Number(charge.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new OverageChargeError("Số tiền thanh toán không hợp lệ");

  const { start, end } = vnMonthBounds(charge.month);
  const confirmedByName =
    input.actorName ??
    (input.method === PackagePaymentMethod.WALLET ? "Hệ thống (Ví Hubsell)" : "Hệ thống");

  const payment = await tx.packagePayment.create({
    data: {
      subscriptionId: subscription.id,
      userId: charge.ownerId,
      kind: "OVERAGE",
      overageChargeId: charge.id,
      planCode: charge.planCode,
      planName: charge.planName,
      // Cột bắt buộc của chứng từ: kỳ = tháng bị vượt; số đơn = số đơn MUA THÊM (tên dòng
      // hóa đơn đọc số này). Không phải kỳ hạn gói — mọi truy vấn kỳ hạn lọc kind PLAN.
      cycle: BillingCycle.MONTHLY,
      periodStart: start,
      periodEnd: end,
      committedOrders: charge.overOrders,
      amount,
      method: input.method,
      occurredAt,
      externalRef: input.externalRef ?? null,
      note: input.note?.trim() ? input.note.trim() : null,
      confirmedById: input.actorId ?? null,
      confirmedByName,
    },
  });
  await tx.planOverageCharge.update({
    where: { id: charge.id },
    data: { packagePaymentId: payment.id },
  });

  // Sổ quỹ chỉ ghi khi có TIỀN THẬT vào (cùng luật với thanh toán gói: Ví là bù trừ).
  if (input.method !== PackagePaymentMethod.WALLET && amount > 0) {
    await tx.platformLedgerEntry.create({
      data: {
        direction: LedgerDirection.IN,
        source: LedgerSource.SUBSCRIPTION,
        amount,
        note: `Thu phí mua thêm ${charge.overOrders.toLocaleString("vi-VN")} đơn hàng tháng ${monthLabel(charge.month)} — gói ${charge.planName}`,
        customerId: charge.ownerId,
        packagePaymentId: payment.id,
        occurredAt,
        invoiceStatus: LedgerInvoiceStatus.PENDING,
        createdById: input.actorId ?? null,
        createdByName: confirmedByName,
      },
    });
  }
  return { payment, charge };
}

/** Bản đầy đủ: transaction + mở khóa ngay + HĐĐT + hoa hồng giới thiệu 10 %. */
export async function recordOveragePayment(
  input: RecordOveragePaymentInput,
  alsoInTx?: (tx: Tx, result: Awaited<ReturnType<typeof recordOveragePaymentTx>>) => Promise<void>
) {
  const result = await prisma.$transaction(async (tx) => {
    const r = await recordOveragePaymentTx(tx, input);
    if (alsoInTx) await alsoInTx(tx, r);
    return r;
  });
  invalidatePlanState(result.charge.ownerId); // trả xong là mở khóa ở request kế tiếp
  kickHqAutoInvoice(result.payment.id);
  const amount = Number(result.payment.amount);
  if (amount > 0) {
    await creditReferralCommission(result.charge.ownerId, amount, undefined).catch((err) =>
      console.error("[plan-overage] Cộng hoa hồng giới thiệu lỗi:", err)
    );
  }
  return result;
}

/** HQ MIỄN một phiếu (bắt buộc lý do) — không thu, không hóa đơn; mở khóa ngay. */
export async function waiveOverageCharge(input: { chargeId: string; note: string; actorName: string }) {
  const note = input.note.trim();
  if (!note) throw new OverageChargeError("Vui lòng ghi lý do miễn");
  const done = await prisma.planOverageCharge.updateMany({
    where: { id: input.chargeId, status: "OPEN" },
    data: { status: "WAIVED", waivedAt: new Date(), waivedByName: input.actorName, waivedNote: note },
  });
  if (done.count === 0) {
    throw new OverageChargeError("Phiếu phí vượt không tồn tại, đã được thanh toán hoặc đã được miễn");
  }
  const charge = await prisma.planOverageCharge.findUniqueOrThrow({ where: { id: input.chargeId } });
  invalidatePlanState(charge.ownerId);
  return charge;
}
