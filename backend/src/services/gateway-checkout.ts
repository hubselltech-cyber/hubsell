// ============================================================
// THANH TOÁN GÓI QUA CỔNG (payOS) — nghiệp vụ dùng chung cho route khách,
// webhook và poll tự chữa lành (09/09/2026).
//
// Luồng: khách bấm "Thanh toán ngay" → createCheckout tạo dòng
// GatewayPaymentOrder (orderCode ↔ khách/gói/kỳ/số tiền) + link/QR payOS →
// khách quét → payOS bắn webhook → settleGatewayOrder gọi lõi
// recordPackagePayment (method GATEWAY, externalRef = "payos:<reference>") —
// đúng MỘT lõi như kế toán ghi nhận tay: gia hạn + chứng từ + sổ quỹ + đóng
// yêu cầu + hoa hồng giới thiệu. Idempotent 2 lớp: trạng thái đơn PAID +
// externalRef unique trên PackagePayment.
//
// Tự chữa lành: FE poll GET /checkout/:orderCode 3s/lần; đơn còn PENDING thì
// hỏi thẳng payOS — webhook lạc (Render restart, mạng) vẫn mở gói đúng lúc.
// ============================================================

import { BillingCycle, GatewayOrderStatus, PackagePaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { isMailerConfigured, sendMail } from "../lib/mailer";
import {
  bankNameFromBin,
  buildPayosDescription,
  cancelPayosPaymentLink,
  createPayosPaymentLink,
  generateOrderCode,
  getPayosConfig,
  getPayosPaymentLink,
  PayosApiError,
  type PayosWebhookBody,
} from "../integrations/payos/client";
import { notify } from "./notifications";
import { CYCLE_LABEL, planPriceFor, recordPackagePayment } from "./subscription-service";

/** Link sống bao lâu — quét QR là chuyện vài phút, 60' đủ rộng cho khách mở app ngân hàng. */
const LINK_TTL_MINUTES = 60;

const FRONTEND_URL = (process.env.APP_FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

export interface CheckoutView {
  orderCode: string;
  status: GatewayOrderStatus;
  planId: string;
  planCode: string;
  planName: string;
  cycle: BillingCycle;
  amount: number;
  checkoutUrl: string | null;
  qrCode: string | null;
  /** Nội dung chuyển khoản khách phải ghi (khi chuyển tay). */
  transferContent: string;
  /** Tài khoản nhận tiền — null khi cổng chưa trả (link đang tạo). */
  bank: { bin: string; name: string | null; accountNumber: string; accountName: string } | null;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

type OrderRow = Prisma.GatewayPaymentOrderGetPayload<Record<string, never>>;

function toView(o: OrderRow): CheckoutView {
  return {
    orderCode: o.orderCode.toString(),
    status: o.status,
    planId: o.planId,
    planCode: o.planCode,
    planName: o.planName,
    cycle: o.cycle,
    amount: Number(o.amount),
    checkoutUrl: o.checkoutUrl,
    qrCode: o.qrCode,
    transferContent: o.description ?? buildPayosDescription(o.planCode),
    bank:
      o.bankBin && o.bankAccountNumber
        ? {
            bin: o.bankBin,
            name: bankNameFromBin(o.bankBin),
            accountNumber: o.bankAccountNumber,
            accountName: o.bankAccountName ?? "",
          }
        : null,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    paidAt: o.paidAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

/** Thông tin cổng cho FE quyết định bày nút "Thanh toán ngay" — null = cổng tắt. */
export function gatewayInfo(): { provider: "PAYOS"; label: string } | null {
  return getPayosConfig() ? { provider: "PAYOS", label: "payOS" } : null;
}

/** Đơn cổng ĐANG CHỜ của khách (chưa hết hạn) — FE mở lại QR khi khách quay lại trang. */
export async function findOpenCheckout(userId: string): Promise<CheckoutView | null> {
  const row = await prisma.gatewayPaymentOrder.findFirst({
    where: { userId, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return row ? toView(row) : null;
}

/**
 * Tạo (hoặc dùng lại) link thanh toán cho (gói, kỳ). Đơn PENDING còn hạn cùng
 * gói/kỳ/giá thì trả lại luôn — khách bấm 2 lần không đẻ 2 link. Đơn PENDING
 * khác (đổi ý gói) thì hủy ở payOS để khách không quét nhầm QR cũ.
 */
export async function createCheckout(input: {
  userId: string;
  planId: string;
  cycle: BillingCycle;
  buyer?: { name?: string | null; email?: string | null; phone?: string | null };
}): Promise<CheckoutView> {
  const cfg = getPayosConfig();
  if (!cfg) throw new CheckoutError("Cổng thanh toán chưa được kích hoạt", 503);

  const plan = await prisma.servicePlan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive) throw new CheckoutError("Gói này hiện không mở bán");
  if (plan.code === "ENTERPRISE") {
    throw new CheckoutError("Gói Enterprise bán theo báo giá riêng — vui lòng đăng ký tư vấn");
  }
  const price = planPriceFor(plan, input.cycle);
  if (!(price > 0)) throw new CheckoutError("Gói này không bán kỳ đã chọn");
  // payOS nhận số nguyên VND.
  const amount = Math.round(price);

  const now = new Date();
  const open = await prisma.gatewayPaymentOrder.findMany({
    where: { userId: input.userId, status: "PENDING", expiresAt: { gt: now } },
  });
  const reusable = open.find(
    (o) => o.planId === plan.id && o.cycle === input.cycle && Number(o.amount) === amount
  );
  if (reusable) return toView(reusable);

  // Đổi ý gói/kỳ: hủy link cũ (best-effort) để không có 2 QR sống song song.
  for (const o of open) {
    await cancelPayosPaymentLink(cfg, Number(o.orderCode), "Khách chọn gói khác").catch(() => {});
    await prisma.gatewayPaymentOrder.update({
      where: { id: o.id },
      data: { status: "CANCELLED" },
    });
  }

  const pendingRequest = await prisma.planUpgradeRequest.findFirst({
    where: { userId: input.userId, status: "PENDING" },
    select: { id: true },
  });

  const expiresAt = new Date(now.getTime() + LINK_TTL_MINUTES * 60_000);

  // orderCode unique — trúng số (cực hiếm) thì thử lại vài lần.
  for (let attempt = 0; attempt < 3; attempt++) {
    const orderCode = generateOrderCode();
    // Nội dung CK = tiền tố sản phẩm (env) + mã gói [+ đuôi mã đơn khi TK đã
    // liên kết, trần 25 ký tự] — lưu vào dòng để FE bày đúng chuỗi đã gửi.
    const description = buildPayosDescription(plan.code, {
      prefix: cfg.transferPrefix,
      maxLen: cfg.descriptionMaxLen,
      orderCode,
    });
    try {
      // Giữ chỗ trong DB TRƯỚC khi gọi payOS: webhook không bao giờ tới trước dòng.
      const row = await prisma.gatewayPaymentOrder.create({
        data: {
          orderCode: BigInt(orderCode),
          userId: input.userId,
          requestId: pendingRequest?.id ?? null,
          planId: plan.id,
          planCode: plan.code,
          planName: plan.name,
          cycle: input.cycle,
          amount: new Prisma.Decimal(amount),
          description,
          expiresAt,
        },
      });
      try {
        const link = await createPayosPaymentLink(cfg, {
          orderCode,
          amount,
          description,
          returnUrl: `${FRONTEND_URL}/settings/plan?checkout=${orderCode}&result=success`,
          cancelUrl: `${FRONTEND_URL}/settings/plan?checkout=${orderCode}&result=cancel`,
          expiredAt: Math.floor(expiresAt.getTime() / 1000),
          buyerName: input.buyer?.name ?? undefined,
          buyerEmail: input.buyer?.email ?? undefined,
          buyerPhone: input.buyer?.phone ?? undefined,
          items: [{ name: `Gói ${plan.name} — ${CYCLE_LABEL[input.cycle]}`, quantity: 1, price: amount }],
        });
        const updated = await prisma.gatewayPaymentOrder.update({
          where: { id: row.id },
          data: {
            paymentLinkId: link.paymentLinkId,
            checkoutUrl: link.checkoutUrl,
            qrCode: link.qrCode,
            bankBin: link.bin ?? null,
            bankAccountNumber: link.accountNumber ?? null,
            bankAccountName: link.accountName ?? null,
          },
        });
        return toView(updated);
      } catch (err) {
        // payOS từ chối → dọn dòng giữ chỗ, báo lỗi tiếng người.
        await prisma.gatewayPaymentOrder.delete({ where: { id: row.id } }).catch(() => {});
        if (err instanceof PayosApiError) {
          console.error("[payOS] Tạo link thất bại:", err.code, err.message);
          throw new CheckoutError(
            "Không tạo được mã thanh toán lúc này — thử lại sau ít phút hoặc dùng nút Đăng ký mua để Hubsell hỗ trợ",
            502
          );
        }
        throw err;
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < 2
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new CheckoutError("Không tạo được mã đơn thanh toán — thử lại", 500);
}

/**
 * Trạng thái đơn cho FE poll. Đơn PENDING: hỏi payOS để tự chữa lành khi
 * webhook lạc (PAID → chốt luôn; CANCELLED/EXPIRED → đồng bộ trạng thái).
 */
export async function getCheckoutStatus(userId: string, orderCode: string): Promise<CheckoutView> {
  const row = await prisma.gatewayPaymentOrder.findUnique({
    where: { orderCode: parseOrderCode(orderCode) },
  });
  if (!row || row.userId !== userId) throw new CheckoutError("Không tìm thấy đơn thanh toán", 404);
  if (row.status !== "PENDING") return toView(row);

  const cfg = getPayosConfig();
  if (cfg) {
    try {
      const info = await getPayosPaymentLink(cfg, Number(row.orderCode));
      if (info.status === "PAID") {
        const tx = info.transactions[0];
        const settled = await settleGatewayOrder({
          orderCode: Number(row.orderCode),
          reference: tx?.reference ?? `link:${info.id}`,
          paidAmount: info.amountPaid || tx?.amount || Number(row.amount),
          paidAt: tx?.transactionDateTime ? parsePayosTime(tx.transactionDateTime) : new Date(),
          raw: { source: "poll", info },
        });
        return toView(settled);
      }
      if (info.status === "CANCELLED" || info.status === "EXPIRED") {
        const updated = await prisma.gatewayPaymentOrder.update({
          where: { id: row.id },
          data: { status: info.status },
        });
        return toView(updated);
      }
    } catch (err) {
      // Không hỏi được payOS thì cứ trả trạng thái DB — webhook vẫn là đường chính.
      console.warn("[payOS] Poll trạng thái lỗi:", (err as Error).message);
    }
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    const updated = await prisma.gatewayPaymentOrder.update({
      where: { id: row.id },
      data: { status: "EXPIRED" },
    });
    return toView(updated);
  }
  return toView(row);
}

export async function cancelCheckout(userId: string, orderCode: string): Promise<CheckoutView> {
  const row = await prisma.gatewayPaymentOrder.findUnique({
    where: { orderCode: parseOrderCode(orderCode) },
  });
  if (!row || row.userId !== userId) throw new CheckoutError("Không tìm thấy đơn thanh toán", 404);
  if (row.status !== "PENDING") return toView(row);
  const cfg = getPayosConfig();
  if (cfg) {
    await cancelPayosPaymentLink(cfg, Number(row.orderCode), "Khách hủy").catch((err) =>
      console.warn("[payOS] Hủy link lỗi:", (err as Error).message)
    );
  }
  const updated = await prisma.gatewayPaymentOrder.update({
    where: { id: row.id },
    data: { status: "CANCELLED" },
  });
  return toView(updated);
}

// ---------------- Chốt đơn (webhook + poll dùng chung) ----------------

export interface SettleInput {
  orderCode: number;
  /** Mã giao dịch ngân hàng — thành externalRef "payos:<reference>" (unique). */
  reference: string;
  paidAmount: number;
  paidAt: Date;
  raw?: unknown;
}

/**
 * Tiền về cho orderCode → ghi nhận thanh toán. Trả về dòng đơn sau xử lý.
 * · Đã PAID → trả luôn (webhook bắn lặp).
 * · Thiếu tiền so với giá gói → MISMATCH, KHÔNG mở gói, mail HQ xử lý tay.
 * · Đủ/thừa → recordPackagePayment với số THỰC NHẬN (sổ quỹ đúng tiền thật).
 */
export async function settleGatewayOrder(input: SettleInput): Promise<OrderRow> {
  const row = await prisma.gatewayPaymentOrder.findUnique({
    where: { orderCode: BigInt(input.orderCode) },
  });
  if (!row) throw new CheckoutError("Không tìm thấy đơn thanh toán", 404);
  if (row.status === "PAID") return row;

  const expected = Number(row.amount);
  const rawJson = input.raw === undefined ? undefined : (JSON.parse(JSON.stringify(input.raw)) as Prisma.InputJsonValue);

  if (input.paidAmount + 0.5 < expected) {
    const updated = await prisma.gatewayPaymentOrder.update({
      where: { id: row.id },
      data: {
        status: "MISMATCH",
        gatewayReference: input.reference,
        paidAmount: new Prisma.Decimal(input.paidAmount),
        paidAt: input.paidAt,
        lastWebhook: rawJson,
      },
    });
    void mailHq({
      subject: `[Hubsell] ⚠️ payOS: tiền về LỆCH số — đơn ${row.orderCode}`,
      html: `<p>Khách ${row.userId} chuyển <b>${input.paidAmount.toLocaleString("vi-VN")}₫</b> cho gói ${row.planName} (${CYCLE_LABEL[row.cycle]}) giá <b>${expected.toLocaleString("vi-VN")}₫</b>.</p><p>Gói CHƯA được mở. Mã GD ngân hàng: ${input.reference}. Vào /admin/plans ghi nhận tay sau khi liên hệ khách.</p>`,
    });
    return updated;
  }

  const externalRef = `payos:${input.reference}`;
  let settled: OrderRow = row;
  try {
    await recordPackagePayment(
      {
        userId: row.userId,
        planId: row.planId,
        cycle: row.cycle,
        amount: input.paidAmount,
        method: PackagePaymentMethod.GATEWAY,
        occurredAt: input.paidAt,
        externalRef,
        note: `payOS đơn ${row.orderCode}`,
        actorName: "Hệ thống (payOS)",
      },
      async (tx, result) => {
        settled = await tx.gatewayPaymentOrder.update({
          where: { id: row.id },
          data: {
            status: "PAID",
            gatewayReference: input.reference,
            paidAmount: new Prisma.Decimal(input.paidAmount),
            paidAt: input.paidAt,
            packagePaymentId: result.payment.id,
            lastWebhook: rawJson,
          },
        });
      }
    );
  } catch (err) {
    // externalRef đã có (webhook + poll đua nhau) → khoản này đã ghi rồi; đồng
    // bộ trạng thái đơn và trả về, không ném lỗi để cổng khỏi retry vô ích.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.packagePayment.findUnique({ where: { externalRef } });
      settled = await prisma.gatewayPaymentOrder.update({
        where: { id: row.id },
        data: {
          status: "PAID",
          gatewayReference: input.reference,
          paidAmount: new Prisma.Decimal(input.paidAmount),
          paidAt: input.paidAt,
          packagePaymentId: existing?.id ?? null,
          lastWebhook: rawJson,
        },
      });
      return settled;
    }
    throw err;
  }

  void notify(row.userId, {
    type: "subscription",
    title: `Thanh toán thành công — gói ${row.planName} đã kích hoạt`,
    body: `Đã nhận ${input.paidAmount.toLocaleString("vi-VN")}₫ cho kỳ ${CYCLE_LABEL[row.cycle]}. Cảm ơn bạn đã đồng hành cùng Hubsell.`,
    link: "/settings/plan",
  });
  void mailHq({
    subject: `[Hubsell] 💰 payOS: +${input.paidAmount.toLocaleString("vi-VN")}₫ — gói ${row.planName} (${CYCLE_LABEL[row.cycle]})`,
    html: `<p>Tiền về qua payOS, gói đã tự kích hoạt và ghi sổ quỹ.</p><p>Khách: ${row.userId}<br/>Đơn: ${row.orderCode} — mã GD: ${input.reference}</p><p><a href="https://app.hubsell.tech/admin/plans">Xem chứng từ ở HQ</a></p>`,
  });
  return settled;
}

/** Webhook payOS đã qua xác thực chữ ký → chốt đơn. code ≠ "00" = giao dịch lỗi, bỏ qua. */
export async function handlePayosWebhook(body: PayosWebhookBody): Promise<{ handled: boolean; status?: GatewayOrderStatus }> {
  const d = body.data;
  if (d.code !== "00") return { handled: false };
  const settled = await settleGatewayOrder({
    orderCode: Number(d.orderCode),
    reference: d.reference,
    paidAmount: Number(d.amount),
    paidAt: parsePayosTime(d.transactionDateTime),
    raw: { source: "webhook", body },
  });
  return { handled: true, status: settled.status };
}

// ---------------- Tiện ích ----------------

export function parseOrderCode(s: string): bigint {
  if (!/^\d{1,19}$/.test(s)) throw new CheckoutError("Mã đơn không hợp lệ");
  return BigInt(s);
}

/** payOS trả "YYYY-MM-DD HH:mm:ss" giờ Việt Nam (không có múi giờ). */
export function parsePayosTime(s: string | null | undefined): Date {
  if (!s) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (m) {
    return new Date(
      Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +m[6])
    );
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function mailHq(input: { subject: string; html: string }): Promise<void> {
  try {
    if (!isMailerConfigured()) return;
    const admins = await prisma.user.findMany({
      where: { isPlatformAdmin: true, email: { not: null } },
      select: { email: true },
    });
    await Promise.allSettled(
      admins.map((a) =>
        sendMail({
          to: a.email!,
          subject: input.subject,
          html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">${input.html}</div>`,
        })
      )
    );
  } catch (err) {
    console.error("[payOS] Mail HQ lỗi:", (err as Error).message);
  }
}
