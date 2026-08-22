// ============================================================
// GÓI CỦA TÔI — endpoint cho PHÍA KHÁCH (khác admin-plans.ts của khu HQ).
//
// GET /api/subscription/me: gói + kỳ hạn + mức dùng so với trần của CHỦ SHOP
// (nhân viên gọi cũng nhận trạng thái của chủ — cần để màn khóa giải thích
// vì sao bị chặn). Nguồn số liệu duy nhất: getOwnerPlanState (plan-enforcement).
// ============================================================

import { Router } from "express";
import { BillingCycle, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAdmin, type AuthRequest } from "../auth";
import { getOwnerPlanState } from "../plan-enforcement";
import { planPriceFor } from "../subscription-service";

const router = Router();

/**
 * Số tài khoản nhận tiền nâng gói — CỔNG CHỜ (anh Trung chưa đưa STK 22/08):
 * đủ 3 biến env thì popup nâng gói hiện hướng dẫn chuyển khoản, chưa đặt thì
 * FE hiện lời mời liên hệ. Thêm STK sau này = đặt env trên Render, không sửa code.
 */
function paymentInfo() {
  const bankName = process.env.PLAN_PAYMENT_BANK_NAME?.trim();
  const bankAccount = process.env.PLAN_PAYMENT_BANK_ACCOUNT?.trim();
  const bankHolder = process.env.PLAN_PAYMENT_BANK_HOLDER?.trim();
  if (!bankName || !bankAccount || !bankHolder) return null;
  return { bankName, bankAccount, bankHolder };
}

router.get("/me", async (req: AuthRequest, res, next) => {
  try {
    const state = await getOwnerPlanState(req.ownerId!);
    const isShopAdmin = req.userRole === "ADMIN";

    // Yêu cầu mua đang chờ + số dư Ví — nuôi khối "Chọn gói" của /settings/plan.
    // Chỉ trả cho CHỦ SHOP: số dư ví và ý định mua gói là chuyện tiền nong của
    // chủ, nhân viên gọi /me chỉ cần trạng thái khóa/trần.
    const [pendingRequest, wallet] = isShopAdmin
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
        ])
      : [null, null];

    // Gói ĐANG BÁN từ bậc hiện tại trở lên (gte, KỂ CẢ gói đang dùng — anh
    // Trung 22/08: popup phải bày từng gói cho khách so sánh, card gói hiện
    // tại gắn badge "Đang dùng" làm mốc đối chiếu). Chưa có thuê bao thì chào
    // cả thang. FE nhận diện gói hiện tại qua id === plan.id.
    const upgradePlans = await prisma.servicePlan.findMany({
      where: { isActive: true, ...(state.plan ? { tier: { gte: state.plan.tier } } : {}) },
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
      pendingUpgradeRequest: pendingRequest
        ? { ...pendingRequest, listedPrice: Number(pendingRequest.listedPrice) }
        : null,
      walletBalance: wallet ? Number(wallet.balance) : null,
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
    const { planId, cycle: cycleRaw } = req.body ?? {};
    const cycle = (Object.values(BillingCycle) as string[]).includes(String(cycleRaw))
      ? (cycleRaw as BillingCycle)
      : null;
    const plan =
      typeof planId === "string" && planId
        ? await prisma.servicePlan.findFirst({
            where: { id: planId, isActive: true },
          })
        : null;
    if (!plan || !cycle) {
      res.status(400).json({ error: "Gói hoặc kỳ mua không hợp lệ" });
      return;
    }
    const price = planPriceFor(plan, cycle);
    if (price <= 0) {
      res.status(400).json({ error: "Gói này không bán kỳ đã chọn" });
      return;
    }

    const data = {
      planId: plan.id,
      planCode: plan.code,
      planName: plan.name,
      cycle,
      listedPrice: new Prisma.Decimal(price),
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

    res.status(existing ? 200 : 201).json({
      request: { ...request, listedPrice: Number(request.listedPrice) },
    });
  } catch (err) {
    next(err);
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

export default router;
