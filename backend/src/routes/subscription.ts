// ============================================================
// GÓI CỦA TÔI — endpoint cho PHÍA KHÁCH (khác admin-plans.ts của khu HQ).
//
// GET /api/subscription/me: gói + kỳ hạn + mức dùng so với trần của CHỦ SHOP
// (nhân viên gọi cũng nhận trạng thái của chủ — cần để màn khóa giải thích
// vì sao bị chặn). Nguồn số liệu duy nhất: getOwnerPlanState (plan-enforcement).
// ============================================================

import { Router } from "express";
import { BillingCycle, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin, type AuthRequest } from "../middleware/auth";
import { isMailerConfigured, sendMail } from "../lib/mailer";
import { getOwnerPlanState } from "../services/plan-enforcement";
import { TAX_CODE_RE } from "../integrations/invoice/misa-einvoice";
import { CYCLE_LABEL, planPriceFor } from "../services/subscription-service";
import {
  cancelCheckout,
  CheckoutError,
  createCheckout,
  findOpenCheckout,
  gatewayInfo,
  getCheckoutStatus,
} from "../services/gateway-checkout";
import { localPhone } from "../integrations/invoice/hq-auto-invoice";
import { AppleIapError, appleCatalogFor, redeemAppleJws } from "../services/apple-iap";
import { AppleVerifyError } from "../integrations/apple-iap/verifier";

const router = Router();

// Link về app trong email báo HQ — theo env để đổi tên miền (.tech → .vn) chỉ
// cần sửa APP_FRONTEND_URL trên Render.
const FRONTEND_URL = (process.env.APP_FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/**
 * Số tài khoản nhận tiền nâng gói (đường CHUYỂN KHOẢN TAY, song song cổng payOS):
 * đủ 3 biến env thì popup nâng gói hiện hướng dẫn chuyển khoản, chưa đặt thì
 * FE hiện lời mời liên hệ. 17/09/2026 đã có TK MB doanh nghiệp 55995995995 —
 * giá trị đặt ở env Render (xem .env.example), trùng số in ở trang /payment landing.
 * Nội dung CK hướng dẫn khách ghi SĐT chứ không ghi email: app ngân hàng không
 * cho gõ ký tự @.
 */
function paymentInfo() {
  const bankName = process.env.PLAN_PAYMENT_BANK_NAME?.trim();
  const bankAccount = process.env.PLAN_PAYMENT_BANK_ACCOUNT?.trim();
  const bankHolder = process.env.PLAN_PAYMENT_BANK_HOLDER?.trim();
  if (!bankName || !bankAccount || !bankHolder) return null;
  return { bankName, bankAccount, bankHolder };
}

/**
 * BÁO HQ có yêu cầu mua/tư vấn mới — email tới mọi tài khoản điều hành nền
 * tảng (khách bấm mua mà không ai biết là mất deal; HQ không có chuông nên
 * email là kênh chạm tới điện thoại anh Trung). Fire-and-forget: lỗi SMTP hay
 * chưa cấu hình đều không được làm hỏng yêu cầu của khách.
 */
async function notifyHqUpgradeRequest(input: {
  customerName: string;
  customerEmail: string | null;
  contactPhone: string;
  planName: string;
  cycleLabel: string;
  /** 0 = tư vấn báo giá riêng. */
  listedPrice: number;
}): Promise<void> {
  try {
    if (!isMailerConfigured()) return;
    const admins = await prisma.user.findMany({
      where: { isPlatformAdmin: true, email: { not: null } },
      select: { email: true },
    });
    if (admins.length === 0) return;
    const isConsult = input.listedPrice === 0;
    const subject = isConsult
      ? `[Hubsell] Yêu cầu TƯ VẤN ${input.planName}: ${input.customerName}`
      : `[Hubsell] Yêu cầu MUA ${input.planName} (${input.cycleLabel}): ${input.customerName}`;
    const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">${isConsult ? "Yêu cầu tư vấn gói" : "Yêu cầu mua gói"} mới</h2>
      <p style="color:#444;margin:4px 0"><b>Khách:</b> ${input.customerName} (${input.customerEmail ?? "—"})</p>
      <p style="color:#444;margin:4px 0"><b>SĐT liên hệ:</b> ${input.contactPhone}</p>
      <p style="color:#444;margin:4px 0"><b>Gói:</b> ${input.planName}${isConsult ? " — báo giá riêng" : ` — ${input.cycleLabel}, giá niêm yết ${input.listedPrice.toLocaleString("vi-VN")}₫`}</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${FRONTEND_URL}/admin/plans"
           style="background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">
          Mở hàng chờ xử lý
        </a>
      </p>
      <p style="color:#888;font-size:13px">Gọi khách hướng dẫn thanh toán — tiền về thì Ghi nhận thanh toán, yêu cầu tự đóng.</p>
    </div>`;
    await Promise.allSettled(
      admins.map((a) => sendMail({ to: a.email!, subject, html }))
    );
  } catch (err) {
    console.error("[subscription] Báo HQ yêu cầu mua gói lỗi:", (err as Error).message);
  }
}

// ---- Hồ sơ XUẤT HÓA ĐƠN của khách mua gói (06/10/2026) ----
// Khách khai một lần ở /settings/plan; mỗi lần thanh toán, Hubsell tự phát
// hành HĐĐT theo hồ sơ này (integrations/invoice/hq-auto-invoice.ts). Trống =
// hóa đơn ghi tên tài khoản + email đăng nhập (khách lẻ không MST).
const BILLING_PROFILE_SELECT = {
  billingName: true,
  billingTaxCode: true,
  billingAddress: true,
  billingEmail: true,
  billingPhone: true,
  billingIdNumber: true,
} as const;

function billingProfileOf(u: {
  billingName: string | null;
  billingTaxCode: string | null;
  billingAddress: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingIdNumber: string | null;
}) {
  return {
    name: u.billingName,
    taxCode: u.billingTaxCode,
    address: u.billingAddress,
    email: u.billingEmail,
    phone: u.billingPhone,
    idNumber: u.billingIdNumber,
  };
}

// PUT /api/subscription/billing-profile — { name?, taxCode?, address?, email?,
// phone?, idNumber? } (chuỗi rỗng = xóa). Có MST thì tên đơn vị + địa chỉ bắt
// buộc (hóa đơn theo đơn vị thiếu địa chỉ là cơ quan thuế từ chối). idNumber =
// số định danh cá nhân 12 số (khách lẻ muốn hóa đơn ghi định danh, NĐ 254/2026);
// phone chuẩn hóa bằng localPhone của hq-auto-invoice (+84 → 0).
router.put("/billing-profile", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const b = req.body ?? {};
    const text = (v: unknown, max: number) => {
      if (v === undefined || v === null) return null;
      if (typeof v !== "string") return undefined;
      const t = v.trim();
      if (t.length > max) return undefined;
      return t || null;
    };
    const name = text(b.name, 200);
    const taxCodeRaw = text(b.taxCode, 20);
    const address = text(b.address, 300);
    const email = text(b.email, 200);
    const phoneRaw = text(b.phone, 30);
    const idNumberRaw = text(b.idNumber, 20);
    if ([name, taxCodeRaw, address, email, phoneRaw, idNumberRaw].some((v) => v === undefined)) {
      res.status(400).json({ error: "Dữ liệu không hợp lệ hoặc quá dài" });
      return;
    }
    // Khách hay dán MST có dấu chấm / khoảng trắng — bỏ trước khi kiểm dạng.
    const taxCode = taxCodeRaw ? taxCodeRaw.replace(/[\s.]/g, "") : null;
    if (taxCode && !TAX_CODE_RE.test(taxCode)) {
      res.status(400).json({ error: "Mã số thuế không hợp lệ (10 số, 10-3 số chi nhánh, hoặc 12/13 số)" });
      return;
    }
    if (taxCode && (!name || !address)) {
      res.status(400).json({ error: "Xuất hóa đơn theo đơn vị cần đủ tên đơn vị và địa chỉ" });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Email nhận hóa đơn không hợp lệ" });
      return;
    }
    const phone = phoneRaw ? localPhone(phoneRaw) : null;
    if (phoneRaw && !phone) {
      res.status(400).json({ error: "Số điện thoại trên hóa đơn không hợp lệ (9–11 chữ số)" });
      return;
    }
    const idNumber = idNumberRaw ? idNumberRaw.replace(/[\s.]/g, "") : null;
    if (idNumber && !/^\d{12}$/.test(idNumber)) {
      res.status(400).json({ error: "Số định danh cá nhân/CCCD phải đủ 12 chữ số" });
      return;
    }
    if (idNumber && !name) {
      res.status(400).json({ error: "Ghi số định danh cá nhân thì cần họ tên người mua" });
      return;
    }
    const updated = await prisma.user.update({
      where: { id: req.ownerId! },
      data: {
        billingName: name,
        billingTaxCode: taxCode,
        billingAddress: address,
        billingEmail: email,
        billingPhone: phone,
        billingIdNumber: idNumber,
      },
      select: BILLING_PROFILE_SELECT,
    });
    res.json({ billingProfile: billingProfileOf(updated) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", async (req: AuthRequest, res, next) => {
  try {
    const state = await getOwnerPlanState(req.ownerId!);
    const isShopAdmin = req.userRole === "ADMIN";

    // Yêu cầu mua đang chờ + số dư Ví + SĐT hồ sơ (điền sẵn ô "để lại SĐT") —
    // nuôi khối "Chọn gói" của /settings/plan. Chỉ trả cho CHỦ SHOP: số dư ví
    // và ý định mua gói là chuyện tiền nong của chủ, nhân viên gọi /me chỉ cần
    // trạng thái khóa/trần.
    const [pendingRequest, wallet, ownerProfile, openCheckout] = isShopAdmin
      ? await Promise.all([
          prisma.planUpgradeRequest.findFirst({
            where: { userId: req.ownerId!, status: "PENDING" },
            select: {
              id: true,
              planId: true,
              planName: true,
              cycle: true,
              listedPrice: true,
              createdAt: true,
            },
          }),
          prisma.hubsellWallet.findUnique({
            where: { userId: req.ownerId! },
            select: { balance: true },
          }),
          prisma.user.findUnique({
            where: { id: req.ownerId! },
            select: { ...BILLING_PROFILE_SELECT, phone: true },
          }),
          // Đơn cổng đang chờ (QR còn hạn) — khách quay lại trang là mở lại được.
          findOpenCheckout(req.ownerId!),
        ])
      : [null, null, null, null];

    // Gói Enterprise "Liên hệ báo giá" — hiện card khi gói tồn tại, KỂ CẢ đang
    // nháp/giá 0: bán bằng tư vấn chứ không bằng bảng giá (anh Trung 22/08 khuya).
    const enterprisePlan = await prisma.servicePlan.findUnique({
      where: { code: "ENTERPRISE" },
      select: { id: true, name: true },
    });

    // CẢ THANG gói đang bán (25/09 anh Trung: bỏ luật "chỉ bậc từ gói hiện
    // tại trở lên" của 22/08 — khách dùng thử gói cao (mặc định nay là Scale)
    // hết hạn phải mua được gói thấp hơn, khách trả tiền muốn hạ gói lúc gia
    // hạn cũng vậy). Tên trường giữ upgradePlans để FE không đổi; popup Nâng
    // gói khi chạm trần tự lọc bậc cao hơn ở FE. FE nhận diện gói hiện tại
    // qua id === plan.id; hạ gói giữa kỳ đã trả tiền thì FE cảnh báo mất ngày.
    const upgradePlans = await prisma.servicePlan.findMany({
      where: { isActive: true },
      orderBy: [{ tier: "asc" }, { priceMonthly: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        tier: true,
        maxChannels: true,
        maxOrdersPerMonth: true,
        maxStaff: true,
        priceMonthly: true,
        priceQuarterly: true,
        priceSemiannual: true,
        priceYearly: true,
      },
    });

    res.json({
      // Tài khoản điều hành nền tảng: FE ẩn banner/màn khóa (backend cũng đã
      // miễn ở middleware requirePlanUnlocked).
      exempt: req.isPlatformAdmin === true,
      hasSubscription: state.hasSubscription,
      plan: state.plan,
      subscription: state.subscription,
      usage: state.usage,
      orders: state.orders,
      expiry: state.expiry,
      locked: state.locked,
      lockedReason: state.lockedReason,
      upgradePlans: upgradePlans.map((p) => ({
        ...p,
        priceMonthly: Number(p.priceMonthly),
        priceQuarterly: Number(p.priceQuarterly),
        priceSemiannual: Number(p.priceSemiannual),
        priceYearly: Number(p.priceYearly),
      })),
      payment: paymentInfo(),
      // Cổng thanh toán (payOS) — null khi chưa đặt PAYOS_* trên Render → FE
      // giữ luồng "Đăng ký mua → HQ liên hệ".
      gateway: gatewayInfo(),
      openCheckout,
      pendingUpgradeRequest: pendingRequest
        ? { ...pendingRequest, listedPrice: Number(pendingRequest.listedPrice) }
        : null,
      walletBalance: wallet ? Number(wallet.balance) : null,
      contactPhone: ownerProfile?.phone ?? null,
      // Hồ sơ xuất hóa đơn (06/10) — chỉ chủ shop; nhân viên nhận null.
      billingProfile: ownerProfile ? billingProfileOf(ownerProfile) : null,
      enterprisePlan,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/upgrade-request — khách bấm "Đăng ký mua" trên
// /settings/plan: { planId, cycle }. Mỗi khách một yêu cầu PENDING — gửi lại
// là CẬP NHẬT gói/kỳ trên yêu cầu cũ (khách đổi ý không đẻ hàng đợi rác).
// HQ thấy trong /admin/plans; "Ghi nhận thanh toán" tự đóng DONE.
router.post("/upgrade-request", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { planId, cycle: cycleRaw, contactPhone: phoneRaw } = req.body ?? {};

    // SĐT liên hệ BẮT BUỘC (anh Trung 22/08 khuya: HQ phải gọi lại được).
    // Nhận dạng dễ dãi: bỏ khoảng trắng/chấm/gạch, chấp nhận +84 lẫn 0.
    const contactPhone =
      typeof phoneRaw === "string" ? phoneRaw.replace(/[\s.\-()]/g, "") : "";
    if (!/^\+?\d{8,15}$/.test(contactPhone)) {
      res.status(400).json({ error: "Vui lòng để lại số điện thoại hợp lệ để Hubsell liên hệ" });
      return;
    }

    const plan =
      typeof planId === "string" && planId
        ? await prisma.servicePlan.findUnique({ where: { id: planId } })
        : null;
    if (!plan) {
      res.status(400).json({ error: "Gói không hợp lệ" });
      return;
    }

    // Enterprise "Liên hệ báo giá": nhận yêu cầu TƯ VẤN kể cả khi gói đang
    // nháp/giá 0 — bán bằng tư vấn, listedPrice 0 để HQ hiện "Báo giá riêng".
    const isConsult = plan.code === "ENTERPRISE";
    const cycle = (Object.values(BillingCycle) as string[]).includes(String(cycleRaw))
      ? (cycleRaw as BillingCycle)
      : isConsult
        ? BillingCycle.MONTHLY
        : null;
    if (!cycle) {
      res.status(400).json({ error: "Kỳ mua không hợp lệ" });
      return;
    }
    const price = isConsult ? 0 : planPriceFor(plan, cycle);
    if (!isConsult) {
      if (!plan.isActive) {
        res.status(400).json({ error: "Gói này hiện không mở bán" });
        return;
      }
      if (price <= 0) {
        res.status(400).json({ error: "Gói này không bán kỳ đã chọn" });
        return;
      }
    }

    // Tiện thể bồi hồ sơ CRM: tài khoản chưa có SĐT thì lưu luôn số vừa để lại.
    prisma.user
      .updateMany({
        where: { id: req.ownerId!, OR: [{ phone: null }, { phone: "" }] },
        data: { phone: contactPhone },
      })
      .catch(() => {});

    const data = {
      planId: plan.id,
      planCode: plan.code,
      planName: plan.name,
      cycle,
      listedPrice: new Prisma.Decimal(price),
      contactPhone,
    };
    const existing = await prisma.planUpgradeRequest.findFirst({
      where: { userId: req.ownerId!, status: "PENDING" },
      select: { id: true },
    });
    const request = existing
      ? await prisma.planUpgradeRequest.update({ where: { id: existing.id }, data })
      : await prisma.planUpgradeRequest.create({
          data: { ...data, userId: req.ownerId! },
        });

    // Báo HQ ngay (email) — không chờ, không để lỗi gửi mail chạm vào response.
    const requester = await prisma.user.findUnique({
      where: { id: req.ownerId! },
      select: { fullName: true, email: true },
    });
    void notifyHqUpgradeRequest({
      customerName: requester?.fullName ?? "Khách Hubsell",
      customerEmail: requester?.email ?? null,
      contactPhone,
      planName: plan.name,
      cycleLabel: CYCLE_LABEL[cycle],
      listedPrice: price,
    });

    res.status(existing ? 200 : 201).json({
      request: { ...request, listedPrice: Number(request.listedPrice) },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// THANH TOÁN QUA CỔNG payOS (09/09) — khách tự trả, gói mở ngay khi tiền về.
//   POST   /checkout                 { planId, cycle } → link + QR
//   GET    /checkout/:orderCode      trạng thái (FE poll 3s; tự hỏi payOS khi webhook lạc)
//   POST   /checkout/:orderCode/cancel
// Chỉ CHỦ SHOP (requireAdmin) — tiền nong của chủ.
// ============================================================
function sendCheckoutError(res: import("express").Response, err: unknown, next: import("express").NextFunction) {
  if (err instanceof CheckoutError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

router.post("/checkout", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { planId, cycle: cycleRaw } = req.body ?? {};
    const cycle = (Object.values(BillingCycle) as string[]).includes(String(cycleRaw))
      ? (cycleRaw as BillingCycle)
      : null;
    if (typeof planId !== "string" || !planId || !cycle) {
      res.status(400).json({ error: "Gói hoặc kỳ mua không hợp lệ" });
      return;
    }
    const buyer = await prisma.user.findUnique({
      where: { id: req.ownerId! },
      select: { fullName: true, email: true, phone: true },
    });
    const checkout = await createCheckout({
      userId: req.ownerId!,
      planId,
      cycle,
      buyer: { name: buyer?.fullName, email: buyer?.email, phone: buyer?.phone },
    });
    res.status(201).json({ checkout });
  } catch (err) {
    sendCheckoutError(res, err, next);
  }
});

router.get("/checkout/:orderCode", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const checkout = await getCheckoutStatus(req.ownerId!, String(req.params.orderCode));
    res.json({ checkout });
  } catch (err) {
    sendCheckoutError(res, err, next);
  }
});

router.post("/checkout/:orderCode/cancel", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const checkout = await cancelCheckout(req.ownerId!, String(req.params.orderCode));
    res.json({ checkout });
  } catch (err) {
    sendCheckoutError(res, err, next);
  }
});

// DELETE /api/subscription/upgrade-request — khách tự rút yêu cầu đang chờ.
router.delete("/upgrade-request", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    await prisma.planUpgradeRequest.updateMany({
      where: { userId: req.ownerId!, status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: new Date(), resolvedByName: "Khách tự hủy" },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Lịch sử thanh toán CỐ TÌNH không có endpoint phía khách (anh Trung bỏ
// 22/08 khuya: đừng nhắc khách họ đã mất tiền) — chứng từ chỉ xem ở HQ
// (/admin/plans, bảng "Thanh toán gần đây" + export kế toán).

// ============================================================
// MUA GÓI TRONG APP iOS QUA APP STORE (10/10/2026) — chỉ CHỦ SHOP.
// Giá hiển thị là của StoreKit (app tự tải), backend chỉ phát danh mục mã sản
// phẩm + appAccountToken, rồi nhận JWS giao dịch về ghi nhận. Chi tiết luồng:
// services/apple-iap.ts. Đường web KHÔNG dùng hai endpoint này.
// ============================================================

// GET /api/subscription/apple-iap/catalog → { appAccountToken, items[] }
router.get("/apple-iap/catalog", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    res.json(await appleCatalogFor(req.ownerId!));
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/apple-iap/redeem { jws } → ghi nhận khoản mua.
// Idempotent: cùng giao dịch gửi lại trả outcome "duplicate" + 200, app cứ
// finishTransaction. Lỗi xác minh/khớp chủ → 4xx có message tiếng Việt.
router.post("/apple-iap/redeem", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const jws = typeof req.body?.jws === "string" ? req.body.jws.trim() : "";
    if (!jws || jws.split(".").length !== 3 || jws.length > 20_000) {
      res.status(400).json({ error: "Thiếu dữ liệu giao dịch Apple" });
      return;
    }
    const r = await redeemAppleJws(req.ownerId!, jws);
    res.json({
      ok: true,
      outcome: r.outcome,
      planName: r.planName,
      cycle: r.cycle,
      periodEnd: r.periodEnd ? r.periodEnd.toISOString() : null,
      sandbox: r.env === "Sandbox",
    });
  } catch (err) {
    if (err instanceof AppleIapError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    if (err instanceof AppleVerifyError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
