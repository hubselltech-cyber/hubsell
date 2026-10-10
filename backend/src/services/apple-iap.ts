// ============================================================
// MUA GÓI TRONG APP iOS QUA APP STORE — 10/10/2026
//
// Bối cảnh: Apple từ chối 3.1.1 ba lần (06, 08, 09/10) vì gói mua trên web mà
// không mua được trong app. Anh Trung chốt bán qua In-App Purchase; kiểu sản
// phẩm Non-Renewing Subscription (trả trước theo kỳ, KHÔNG tự gia hạn) khớp
// đúng mô hình PackagePayment hiện có — Apple chỉ là một "cổng" nữa bên cạnh
// chuyển khoản / Ví / payOS.
//
// Luồng:
//   app  → fetchProducts(catalog) → requestPurchase(sku, appAccountToken)
//        → StoreKit trả giao dịch (JWS) → POST /api/subscription/apple-iap/redeem
//   server → xác minh chữ ký (verifier.ts) → đối chiếu appAccountToken với chủ
//          shop → recordPackagePayment(method APPLE_IAP, externalRef
//          "apple:<transactionId>") → app finishTransaction.
//   Apple → POST /api/webhooks/apple-iap (ONE_TIME_CHARGE / REFUND / TEST):
//          lưới an toàn khi app chết trước khi kịp redeem, và báo HQ khi hoàn tiền.
//
// Chống trùng: externalRef unique — redeem lặp (app retry, webhook + app đua
// nhau) trả về khoản đã ghi, không ném lỗi. Sandbox (người duyệt Apple) ghi
// amount 0 → không vào sổ quỹ, không hoa hồng, nhưng gói vẫn mở để người
// duyệt thấy luồng chạy trọn.
// ============================================================

import { randomUUID } from "node:crypto";
import { PackagePaymentMethod, Prisma } from "@prisma/client";
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { prisma } from "../lib/prisma";
import { mailHq } from "./hq-mail";
import { notify } from "./notifications";
import { CYCLE_LABEL, planPriceFor, recordPackagePayment } from "./subscription-service";
import { appleProductId, parseAppleProductId } from "../integrations/apple-iap/products";
import {
  type AppleEnv,
  verifyAppleNotification,
  verifyAppleTransaction,
} from "../integrations/apple-iap/verifier";

export class AppleIapError extends Error {
  constructor(message: string, readonly httpStatus = 400) {
    super(message);
    this.name = "AppleIapError";
  }
}

// ---------------- Danh mục cho app ----------------

export interface AppleCatalogItem {
  productId: string;
  planId: string;
  planCode: string;
  planName: string;
  tier: number;
  cycle: "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "YEARLY";
  /** Giá web (VND) — app KHÔNG hiển thị, chỉ để đối chiếu/log; giá bán là của StoreKit. */
  webPrice: number;
  maxOrdersPerMonth: number | null;
  maxChannels: number | null;
  maxStaff: number | null;
}

/**
 * Danh mục sản phẩm Apple của các gói đang bán: mỗi kỳ có giá > 0 là một mã.
 * Kèm appAccountToken của chủ shop (sinh lười, bất biến) để app gửi StoreKit.
 */
export async function appleCatalogFor(ownerId: string): Promise<{
  appAccountToken: string;
  items: AppleCatalogItem[];
}> {
  const [plans, user] = await Promise.all([
    prisma.servicePlan.findMany({
      where: { isActive: true },
      orderBy: [{ tier: "asc" }, { priceMonthly: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        tier: true,
        priceMonthly: true,
        priceQuarterly: true,
        priceSemiannual: true,
        priceYearly: true,
        maxOrdersPerMonth: true,
        maxChannels: true,
        maxStaff: true,
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { appleAppAccountToken: true },
    }),
  ]);

  let token = user.appleAppAccountToken;
  if (!token) {
    token = randomUUID();
    // Đua: hai máy cùng mở màn lần đầu → chỉ ghi khi cột còn trống, rồi đọc lại.
    await prisma.user.updateMany({
      where: { id: ownerId, appleAppAccountToken: null },
      data: { appleAppAccountToken: token },
    });
    const again = await prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { appleAppAccountToken: true },
    });
    token = again.appleAppAccountToken ?? token;
  }

  const items: AppleCatalogItem[] = [];
  for (const p of plans) {
    for (const cycle of ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "YEARLY"] as const) {
      const webPrice = planPriceFor(p, cycle);
      if (!(webPrice > 0)) continue;
      const productId = appleProductId(p.code, cycle);
      if (!productId) continue;
      items.push({
        productId,
        planId: p.id,
        planCode: p.code,
        planName: p.name,
        tier: p.tier,
        cycle,
        webPrice,
        maxOrdersPerMonth: p.maxOrdersPerMonth,
        maxChannels: p.maxChannels,
        maxStaff: p.maxStaff,
      });
    }
  }
  return { appAccountToken: token, items };
}

// ---------------- Ghi nhận giao dịch ----------------

export interface RedeemResult {
  /** "recorded" = vừa ghi; "duplicate" = đã ghi từ trước (app retry/webhook đua). */
  outcome: "recorded" | "duplicate";
  externalRef: string;
  env: AppleEnv;
  planName: string;
  cycle: string;
  periodEnd: Date | null;
}

function externalRefOf(txn: JWSTransactionDecodedPayload): string {
  return `apple:${txn.transactionId}`;
}

/**
 * Lõi: giao dịch ĐÃ XÁC MINH → tìm chủ shop qua appAccountToken → ghi nhận.
 * `expectedOwnerId` (đường app) phải khớp chủ của token — app của người này
 * không ghi được khoản cho người khác.
 */
export async function applyAppleTransaction(
  txn: JWSTransactionDecodedPayload,
  env: AppleEnv,
  expectedOwnerId?: string
): Promise<RedeemResult> {
  if (!txn.transactionId) throw new AppleIapError("Giao dịch Apple thiếu transactionId");
  if (txn.revocationDate) throw new AppleIapError("Giao dịch Apple đã bị thu hồi/hoàn tiền");
  if (txn.type && txn.type !== "Non-Renewing Subscription" && txn.type !== "Consumable") {
    throw new AppleIapError(`Loại sản phẩm Apple không hỗ trợ: ${txn.type}`);
  }

  const parsed = parseAppleProductId(txn.productId);
  if (!parsed) throw new AppleIapError(`Mã sản phẩm Apple không thuộc Hubsell: ${txn.productId ?? "?"}`);

  if (!txn.appAccountToken) {
    throw new AppleIapError("Giao dịch Apple không mang appAccountToken — không biết thuộc shop nào", 422);
  }
  const owner = await prisma.user.findUnique({
    where: { appleAppAccountToken: txn.appAccountToken.toLowerCase() },
    select: { id: true, role: true },
  });
  if (!owner) throw new AppleIapError("Không tìm thấy chủ shop ứng với giao dịch Apple", 422);
  if (expectedOwnerId && owner.id !== expectedOwnerId) {
    throw new AppleIapError("Giao dịch Apple thuộc tài khoản khác", 403);
  }

  const plan = await prisma.servicePlan.findFirst({
    where: { code: { equals: parsed.planCodeLower, mode: "insensitive" } },
  });
  if (!plan) throw new AppleIapError(`Không có gói ứng với sản phẩm Apple ${txn.productId}`);

  const externalRef = externalRefOf(txn);
  const existing = await prisma.packagePayment.findUnique({
    where: { externalRef },
    select: { planName: true, cycle: true, periodEnd: true },
  });
  if (existing) {
    return {
      outcome: "duplicate",
      externalRef,
      env,
      planName: existing.planName,
      cycle: existing.cycle,
      periodEnd: existing.periodEnd,
    };
  }

  // Tiền THỰC THU: StoreKit 2 trả price theo milli-đơn vị (99000000 = 99.000₫).
  // Khác VND (khách mua ở storefront khác) → ghi giá web để sổ không lệch tiền tệ;
  // sandbox → 0 (không vào sổ quỹ, không hoa hồng).
  const webPrice = planPriceFor(plan, parsed.cycle);
  const storePrice =
    typeof txn.price === "number" && txn.currency === "VND" ? Math.round(txn.price / 1000) : null;
  const amount = env === "Sandbox" ? 0 : (storePrice ?? webPrice) * (txn.quantity ?? 1);
  const occurredAt = txn.purchaseDate ? new Date(txn.purchaseDate) : new Date();

  const noteParts = [
    `App Store ${env === "Sandbox" ? "SANDBOX" : ""}`.trim(),
    `sản phẩm ${txn.productId}`,
    txn.storefront ? `storefront ${txn.storefront}` : null,
    txn.currency && typeof txn.price === "number"
      ? `Apple báo ${(txn.price / 1000).toLocaleString("vi-VN")} ${txn.currency}`
      : null,
  ].filter(Boolean);

  let result;
  try {
    result = await recordPackagePayment({
      userId: owner.id,
      planId: plan.id,
      cycle: parsed.cycle,
      amount,
      method: PackagePaymentMethod.APPLE_IAP,
      occurredAt,
      externalRef,
      note: noteParts.join(" · "),
      actorName: "Hệ thống (App Store)",
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const dup = await prisma.packagePayment.findUniqueOrThrow({
        where: { externalRef },
        select: { planName: true, cycle: true, periodEnd: true },
      });
      return { outcome: "duplicate", externalRef, env, planName: dup.planName, cycle: dup.cycle, periodEnd: dup.periodEnd };
    }
    throw err;
  }

  const cycleLabel = CYCLE_LABEL[parsed.cycle];
  void notify(owner.id, {
    type: "subscription",
    title: `Thanh toán qua App Store thành công — gói ${plan.name} đã kích hoạt`,
    body: `Kỳ ${cycleLabel}, hiệu lực tới ${result.payment.periodEnd.toLocaleDateString("vi-VN")}. Cảm ơn bạn đã đồng hành cùng Hubsell.`,
    link: "/settings/plan",
  });
  void mailHq({
    subject: `[Hubsell] 🍎 App Store${env === "Sandbox" ? " (sandbox)" : ""}: +${amount.toLocaleString("vi-VN")}₫ — gói ${plan.name} (${cycleLabel})`,
    html: `<p>Khách mua gói trong app iOS, gói đã tự kích hoạt${amount > 0 ? " và ghi sổ quỹ" : " (sandbox — không ghi sổ)"}.</p><p>Khách: ${owner.id}<br/>Giao dịch Apple: ${txn.transactionId} — sản phẩm ${txn.productId}<br/>Apple báo: ${typeof txn.price === "number" ? (txn.price / 1000).toLocaleString("vi-VN") : "?"} ${txn.currency ?? ""} (Apple giữ hoa hồng trước khi trả).</p>`,
  });

  return {
    outcome: "recorded",
    externalRef,
    env,
    planName: plan.name,
    cycle: parsed.cycle,
    periodEnd: result.payment.periodEnd,
  };
}

/** Đường app: JWS từ expo-iap (purchaseToken) + chủ shop đang đăng nhập. */
export async function redeemAppleJws(ownerId: string, jws: string): Promise<RedeemResult> {
  const { txn, env } = await verifyAppleTransaction(jws);
  return applyAppleTransaction(txn, env, ownerId);
}

// ---------------- Thông báo máy chủ App Store (V2) ----------------

export interface AppleNotificationOutcome {
  notificationType: string;
  handled: boolean;
  detail?: string;
}

/**
 * ONE_TIME_CHARGE: Apple báo khoản mua non-renewing/consumable (production từ
 * 2025) → ghi nhận như đường app (lưới an toàn khi app chết giữa chừng).
 * REFUND / REVOKE: báo HQ xử lý tay (thu hồi kỳ hạn là quyết định con người —
 * khách có thể đã dùng nửa kỳ). TEST: Apple gửi khi bấm thử URL. Còn lại: ghi log.
 */
export async function handleAppleNotification(signedPayload: string): Promise<AppleNotificationOutcome> {
  const { payload, env } = await verifyAppleNotification(signedPayload);
  const type = String(payload.notificationType ?? "UNKNOWN");
  const signedTxn = payload.data?.signedTransactionInfo;

  if (type === "TEST") return { notificationType: type, handled: true, detail: `env ${env}` };

  if (type === "ONE_TIME_CHARGE") {
    if (!signedTxn) return { notificationType: type, handled: false, detail: "thiếu signedTransactionInfo" };
    const { txn } = await verifyAppleTransaction(signedTxn);
    const r = await applyAppleTransaction(txn, env);
    return { notificationType: type, handled: true, detail: `${r.outcome} ${r.externalRef}` };
  }

  if (type === "REFUND" || type === "REVOKE" || type === "REFUND_REVERSED") {
    let detail = "";
    if (signedTxn) {
      try {
        const { txn } = await verifyAppleTransaction(signedTxn);
        const externalRef = externalRefOf(txn);
        const payment = await prisma.packagePayment.findUnique({
          where: { externalRef },
          select: { id: true, userId: true, planName: true, cycle: true, amount: true, periodStart: true, periodEnd: true },
        });
        detail = payment
          ? `Khách ${payment.userId} — gói ${payment.planName} (${CYCLE_LABEL[payment.cycle]}) ${Number(payment.amount).toLocaleString("vi-VN")}₫, kỳ ${payment.periodStart.toLocaleDateString("vi-VN")} → ${payment.periodEnd.toLocaleDateString("vi-VN")}, chứng từ ${payment.id}`
          : `Giao dịch ${txn.transactionId} (${txn.productId}) chưa từng ghi nhận ở Hubsell`;
      } catch (err) {
        detail = `Không đọc được giao dịch kèm theo: ${(err as Error).message}`;
      }
    }
    void mailHq({
      subject: `[Hubsell] ⚠️ App Store ${type}${env === "Sandbox" ? " (sandbox)" : ""} — cần xử lý tay`,
      html: `<p>Apple báo <b>${type}</b>${payload.subtype ? ` / ${payload.subtype}` : ""}.</p><p>${detail}</p><p>Apple đã ${type === "REFUND_REVERSED" ? "hủy hoàn tiền (khách giữ gói)" : "hoàn tiền/thu hồi cho khách"}. Hubsell KHÔNG tự cắt kỳ hạn — vào /admin/plans xem và quyết định (khách có thể đã dùng một phần kỳ).</p>`,
    });
    return { notificationType: type, handled: true, detail };
  }

  console.info(`[AppleIAP] Thông báo ${type}${payload.subtype ? `/${payload.subtype}` : ""} (${env}) — bỏ qua`);
  return { notificationType: type, handled: false };
}
