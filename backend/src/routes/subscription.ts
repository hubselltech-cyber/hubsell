// ============================================================
// GÓI CỦA TÔI — endpoint cho PHÍA KHÁCH (khác admin-plans.ts của khu HQ).
//
// GET /api/subscription/me: gói + kỳ hạn + mức dùng so với trần của CHỦ SHOP
// (nhân viên gọi cũng nhận trạng thái của chủ — cần để màn khóa giải thích
// vì sao bị chặn). Nguồn số liệu duy nhất: getOwnerPlanState (plan-enforcement).
// ============================================================

import { Router } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../auth";
import { getOwnerPlanState } from "../plan-enforcement";

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

    // Gói ĐANG BÁN bậc cao hơn gói hiện tại — nội dung bảng chọn của popup
    // nâng gói. Chưa có thuê bao thì chào cả thang (trường hợp hiếm: khách cũ
    // chưa backfill; họ không bị giới hạn nhưng vẫn được xem bảng giá).
    const upgradePlans = await prisma.servicePlan.findMany({
      where: { isActive: true, ...(state.plan ? { tier: { gt: state.plan.tier } } : {}) },
      orderBy: { tier: "asc" },
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
    });
  } catch (err) {
    next(err);
  }
});

export default router;
