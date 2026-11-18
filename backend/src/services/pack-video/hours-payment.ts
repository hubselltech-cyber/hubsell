// ============================================================
// VIDEO ĐÓNG HÀNG — GHI NHẬN MỘT KHOẢN MUA GIỜ QUAY ĐÃ THU (18/11/2026 tối,
// docs/VIDEO-DONG-HANG-THIET-KE.md mục 20). Anh Trung 18/11: "Làm phần mua giờ".
//
// Đi chung lõi của thanh toán gói / phí vượt: chứng từ PackagePayment (kind PACK_HOURS) → sổ quỹ
// HQ → hóa đơn tự xuất, nhưng KHÔNG gia hạn thuê bao — thay vào đó CỘNG GIỜ vào pack_hour_grants.
// Ba việc nằm trong MỘT giao dịch: hoặc có đủ chứng từ + sổ quỹ + giờ, hoặc không có gì.
//
// Chống thu / cộng đôi (webhook bắn lặp, poll đua webhook) bằng HAI chỉ mục duy nhất trên cùng một
// mã khoản tiền: package_payments.externalRef và pack_hour_grants.paymentRef — không "đọc rồi ghi".
//
// Hoa hồng giới thiệu 10 %: CHƯA cộng cho khoản mua giờ — chờ anh Trung quyết (mục 20.6).
// ============================================================

import {
  BillingCycle,
  LedgerDirection,
  LedgerInvoiceStatus,
  LedgerSource,
  PackagePaymentMethod,
  Prisma,
} from "@prisma/client";
import { kickHqAutoInvoice } from "../../integrations/invoice/hq-auto-invoice";
import { prisma } from "../../lib/prisma";
import { grantPurchasedHoursTx, HourPurchaseError } from "./hours";

type Tx = Prisma.TransactionClient;

export interface RecordHoursPaymentInput {
  ownerId: string;
  /** Số giờ khách mua (số nguyên). */
  hours: number;
  /** Số tiền THỰC THU (đồng) — phải đúng bằng số giờ × đơn giá, lệch là không ghi gì. */
  amountVnd: number;
  method: PackagePaymentMethod;
  /** Mã khoản tiền, vd "payos:<mã GD ngân hàng>" — BẮT BUỘC, duy nhất. */
  externalRef: string;
  occurredAt?: Date;
  note?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

export type RecordHoursPaymentResult = Awaited<ReturnType<typeof recordHoursPaymentTx>>;

/** Phần lõi chạy TRONG giao dịch của người gọi (cổng gắn thêm việc đánh dấu đơn PAID). */
export async function recordHoursPaymentTx(tx: Tx, input: RecordHoursPaymentInput) {
  const occurredAt = input.occurredAt ?? new Date();
  const externalRef = input.externalRef.trim();
  if (!externalRef) throw new HourPurchaseError("Thiếu mã khoản thanh toán");

  const subscription = await tx.subscription.findUnique({
    where: { userId: input.ownerId },
    select: { id: true, plan: { select: { code: true, name: true } } },
  });
  if (!subscription) throw new HourPurchaseError("Tài khoản không còn thuê bao để ghi chứng từ");

  // Cộng giờ TRƯỚC: hàm này kiểm "tiền đúng bằng giờ × đơn giá" và ném lỗi khi lệch — chưa ghi gì cả.
  const grant = await grantPurchasedHoursTx(tx, {
    ownerId: input.ownerId,
    hours: input.hours,
    amountVnd: input.amountVnd,
    paymentRef: externalRef,
    note: input.note ?? null,
    createdById: input.actorId ?? null,
  });

  const confirmedByName = input.actorName ?? "Hệ thống";
  const hoursText = input.hours.toLocaleString("vi-VN");
  const payment = await tx.packagePayment.create({
    data: {
      subscriptionId: subscription.id,
      userId: input.ownerId,
      kind: "PACK_HOURS",
      packHours: input.hours,
      // Cột bắt buộc của chứng từ: gói đang dùng lúc mua chỉ là ảnh chụp; khoản này không có kỳ hạn
      // nên hai đầu kỳ = lúc thu. Mọi truy vấn kỳ hạn gói lọc kind PLAN.
      planCode: subscription.plan.code,
      planName: subscription.plan.name,
      cycle: BillingCycle.MONTHLY,
      periodStart: occurredAt,
      periodEnd: occurredAt,
      amount: input.amountVnd,
      method: input.method,
      occurredAt,
      externalRef,
      note: input.note?.trim() ? input.note.trim() : null,
      confirmedById: input.actorId ?? null,
      confirmedByName,
    },
  });

  // Sổ quỹ chỉ ghi khi có TIỀN THẬT vào (cùng luật với thanh toán gói: Ví là bù trừ).
  if (input.method !== PackagePaymentMethod.WALLET && input.amountVnd > 0) {
    await tx.platformLedgerEntry.create({
      data: {
        direction: LedgerDirection.IN,
        source: LedgerSource.SUBSCRIPTION,
        amount: input.amountVnd,
        note: `Thu tiền mua ${hoursText} giờ quay video đóng hàng`,
        customerId: input.ownerId,
        packagePaymentId: payment.id,
        occurredAt,
        invoiceStatus: LedgerInvoiceStatus.PENDING,
        createdById: input.actorId ?? null,
        createdByName: confirmedByName,
      },
    });
  }
  return { payment, grantId: grant.id, hours: input.hours };
}

/** Bản đầy đủ: giao dịch + hóa đơn tự xuất (sau khi giao dịch đã ghi xong). */
export async function recordHoursPayment(
  input: RecordHoursPaymentInput,
  alsoInTx?: (tx: Tx, result: RecordHoursPaymentResult) => Promise<void>
): Promise<RecordHoursPaymentResult> {
  const result = await prisma.$transaction(async (tx) => {
    const r = await recordHoursPaymentTx(tx, input);
    if (alsoInTx) await alsoInTx(tx, r);
    return r;
  });
  kickHqAutoInvoice(result.payment.id);
  return result;
}
