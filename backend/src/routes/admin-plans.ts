// ============================================================
// GÓI DỊCH VỤ & THUÊ BAO (/api/admin — GĐ1 thương mại hóa 22/08).
//
// Phân quyền 2 tầng có chủ đích:
//  - ĐỌC gói/thuê bao + GHI NHẬN THANH TOÁN: lá hq.finance (việc của kế toán).
//  - SỬA BẢNG GIÁ (tạo/sửa/xoá gói): CHỈ chủ nền tảng (requirePlatformAdmin)
//    — nhân viên kế toán không tự đổi giá bán được.
// ============================================================

import { Router } from "express";
import { BillingCycle, PackagePaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import {
  requirePlatformAdmin,
  requirePlatformPermission,
  type AuthRequest,
} from "../auth";
import { writeAuditLog } from "../platform-audit";
import {
  effectiveSubscriptionStatus,
  recordPackagePayment,
} from "../subscription-service";

const router = Router();

const toNumber = (d: Prisma.Decimal | number | null | undefined) => (d ? Number(d) : 0);

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  tier: true,
  priceMonthly: true,
  priceQuarterly: true,
  priceSemiannual: true,
  priceYearly: true,
  maxChannels: true,
  maxOrdersPerMonth: true,
  maxStaff: true,
  features: true,
  isActive: true,
  isDefault: true,
  trialDays: true,
  createdAt: true,
  _count: { select: { subscriptions: true } },
} as const;

function serializePlan(p: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: number;
  priceMonthly: Prisma.Decimal;
  priceQuarterly: Prisma.Decimal;
  priceSemiannual: Prisma.Decimal;
  priceYearly: Prisma.Decimal;
  maxChannels: number | null;
  maxOrdersPerMonth: number | null;
  maxStaff: number | null;
  features: Prisma.JsonValue;
  isActive: boolean;
  isDefault: boolean;
  trialDays: number;
  createdAt: Date;
  _count: { subscriptions: number };
}) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    tier: p.tier,
    priceMonthly: toNumber(p.priceMonthly),
    priceQuarterly: toNumber(p.priceQuarterly),
    priceSemiannual: toNumber(p.priceSemiannual),
    priceYearly: toNumber(p.priceYearly),
    maxChannels: p.maxChannels,
    maxOrdersPerMonth: p.maxOrdersPerMonth,
    maxStaff: p.maxStaff,
    features: p.features,
    isActive: p.isActive,
    isDefault: p.isDefault,
    trialDays: p.trialDays,
    createdAt: p.createdAt,
    subscriberCount: p._count.subscriptions,
  };
}

/** Đọc + kiểm tra các trường ghi của gói từ body (POST lẫn PATCH dùng chung). */
function parsePlanBody(body: Record<string, unknown>, partial: boolean) {
  const errors: string[] = [];
  const out: Prisma.ServicePlanUncheckedUpdateInput = {};

  const str = (key: "name" | "description") => {
    if (body[key] === undefined) return partial ? undefined : null;
    return typeof body[key] === "string" ? (body[key] as string).trim() : null;
  };
  const name = str("name");
  if (name !== undefined) {
    if (!name) errors.push("Tên gói không được trống");
    else out.name = name;
  }
  const description = str("description");
  if (description !== undefined) out.description = description || null;

  const int = (
    key:
      | "tier"
      | "priceMonthly"
      | "priceQuarterly"
      | "priceSemiannual"
      | "priceYearly"
      | "trialDays",
    min = 0
  ) => {
    if (body[key] === undefined) return;
    const v = Math.floor(Number(body[key]));
    if (!Number.isFinite(v) || v < min) errors.push(`Trường ${key} không hợp lệ`);
    else out[key] = v;
  };
  int("tier");
  int("priceMonthly");
  int("priceQuarterly");
  int("priceSemiannual");
  int("priceYearly");
  int("trialDays");

  // Giới hạn: null/rỗng = không giới hạn.
  for (const key of ["maxChannels", "maxOrdersPerMonth", "maxStaff"] as const) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === "") {
      out[key] = null;
      continue;
    }
    const v = Math.floor(Number(body[key]));
    if (!Number.isFinite(v) || v < 1) errors.push(`Trường ${key} phải ≥ 1 hoặc để trống`);
    else out[key] = v;
  }

  for (const key of ["isActive", "isDefault"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") errors.push(`Trường ${key} phải là true/false`);
    else out[key] = body[key] as boolean;
  }

  return { out, errors };
}

// GET /api/admin/plans — toàn bộ bảng giá (kể cả gói tắt) + số thuê bao mỗi gói.
router.get("/plans", requirePlatformPermission("hq.finance"), async (_req, res, next) => {
  try {
    const plans = await prisma.servicePlan.findMany({
      orderBy: [{ tier: "asc" }, { createdAt: "asc" }],
      select: PLAN_SELECT,
    });
    res.json({ plans: plans.map(serializePlan) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/plans — tạo gói mới (CHỈ chủ nền tảng).
router.post("/plans", requirePlatformAdmin, async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9_]{2,20}$/.test(code)) {
      res.status(400).json({ error: "Mã gói: 2-20 ký tự A-Z 0-9 _ (vd BETA, STARTER, PRO)" });
      return;
    }
    const { out, errors } = parsePlanBody(body, false);
    if (out.name === undefined) errors.push("Thiếu tên gói");
    if (errors.length) {
      res.status(400).json({ error: errors[0] });
      return;
    }

    const plan = await prisma.$transaction(async (tx) => {
      // Tối đa MỘT gói mặc định — bật ở gói này thì tắt ở mọi gói khác.
      if (out.isDefault === true) {
        await tx.servicePlan.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.servicePlan.create({
        data: { ...(out as Prisma.ServicePlanUncheckedCreateInput), code, name: out.name as string },
        select: PLAN_SELECT,
      });
    });

    await writeAuditLog(req, {
      action: "plan.create",
      detail: { code, name: plan.name, priceMonthly: toNumber(plan.priceMonthly) },
    });
    res.status(201).json({ plan: serializePlan(plan) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "Mã gói này đã tồn tại" });
      return;
    }
    next(err);
  }
});

// PATCH /api/admin/plans/:id — sửa gói (CHỈ chủ nền tảng). `code` bất biến —
// nó là snapshot trên chứng từ thanh toán, đổi là vỡ lịch sử đối chiếu.
router.patch("/plans/:id", requirePlatformAdmin, async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.code !== undefined) {
      res.status(400).json({ error: "Mã gói không đổi được sau khi tạo" });
      return;
    }
    const { out, errors } = parsePlanBody(body, true);
    if (errors.length) {
      res.status(400).json({ error: errors[0] });
      return;
    }

    const plan = await prisma.$transaction(async (tx) => {
      const existing = await tx.servicePlan.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!existing) return null;
      if (out.isDefault === true) {
        await tx.servicePlan.updateMany({
          where: { isDefault: true, id: { not: existing.id } },
          data: { isDefault: false },
        });
      }
      return tx.servicePlan.update({
        where: { id: existing.id },
        data: out,
        select: PLAN_SELECT,
      });
    });
    if (!plan) {
      res.status(404).json({ error: "Không tìm thấy gói" });
      return;
    }

    await writeAuditLog(req, {
      action: "plan.update",
      detail: JSON.parse(JSON.stringify({ id: plan.id, ...body })),
    });
    res.json({ plan: serializePlan(plan) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/plans/:id — chỉ xoá được gói CHƯA TỪNG có thuê bao (tạo
// nhầm); gói đã có người dùng thì tắt isActive thay vì xoá.
router.delete("/plans/:id", requirePlatformAdmin, async (req: AuthRequest, res, next) => {
  try {
    const plan = await prisma.servicePlan.findUnique({
      where: { id: req.params.id },
      select: { id: true, code: true, name: true, _count: { select: { subscriptions: true } } },
    });
    if (!plan) {
      res.status(404).json({ error: "Không tìm thấy gói" });
      return;
    }
    if (plan._count.subscriptions > 0) {
      res.status(400).json({
        error: `Gói đang có ${plan._count.subscriptions} thuê bao — hãy tắt "Đang bán" thay vì xoá`,
      });
      return;
    }
    await prisma.servicePlan.delete({ where: { id: plan.id } });
    await writeAuditLog(req, { action: "plan.delete", detail: { code: plan.code, name: plan.name } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const EXPIRING_SOON_DAYS = 7;

// GET /api/admin/subscriptions?filter=all|expiring|expired&q=<email/tên>
// Danh sách thuê bao (kèm khách + gói) + thẻ số + thanh toán gần đây.
router.get(
  "/subscriptions",
  requirePlatformPermission("hq.finance"),
  async (req, res, next) => {
    try {
      const now = new Date();
      const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
      const filter = String(req.query.filter ?? "all");
      const q = String(req.query.q ?? "").trim();

      const where: Prisma.SubscriptionWhereInput = {
        ...(filter === "expiring"
          ? { status: "ACTIVE", currentPeriodEnd: { gte: now, lte: soon } }
          : filter === "expired"
            ? { status: "ACTIVE", currentPeriodEnd: { lt: now } }
            : {}),
        ...(q
          ? {
              user: {
                OR: [
                  { email: { contains: q, mode: "insensitive" } },
                  { fullName: { contains: q, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      };

      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [subs, total, activeCount, trialingCount, expiringCount, expiredCount, monthAgg, recentPayments] =
        await Promise.all([
          prisma.subscription.findMany({
            where,
            // Sắp hết hạn lên đầu (null = vô thời hạn xuống cuối), mới tạo trước.
            orderBy: [{ currentPeriodEnd: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
            take: 100,
            select: {
              id: true,
              status: true,
              isTrial: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              createdAt: true,
              user: { select: { id: true, email: true, fullName: true } },
              plan: { select: { id: true, code: true, name: true, maxOrdersPerMonth: true } },
            },
          }),
          prisma.subscription.count({ where }),
          prisma.subscription.count({
            where: {
              status: "ACTIVE",
              OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gte: now } }],
            },
          }),
          prisma.subscription.count({
            where: { status: "ACTIVE", isTrial: true, currentPeriodEnd: { gte: now } },
          }),
          prisma.subscription.count({
            where: { status: "ACTIVE", currentPeriodEnd: { gte: now, lte: soon } },
          }),
          prisma.subscription.count({
            where: { status: "ACTIVE", currentPeriodEnd: { lt: now } },
          }),
          prisma.packagePayment.aggregate({
            where: { occurredAt: { gte: monthStart } },
            _sum: { amount: true },
            _count: true,
          }),
          prisma.packagePayment.findMany({
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              planName: true,
              cycle: true,
              amount: true,
              method: true,
              periodEnd: true,
              occurredAt: true,
              note: true,
              confirmedByName: true,
              user: { select: { id: true, email: true, fullName: true } },
            },
          }),
        ]);

      // %TRẦN ĐƠN THÁNG của từng thuê bao đang hiển thị (GĐ2) — để HQ gọi
      // khách chủ động mời nâng gói trước khi bị khóa. 1 findMany gian +
      // 1 groupBy đơn cho cả trang, không N+1.
      const ownerIds = [...new Set(subs.map((s) => s.user.id))];
      const ownerChannels = ownerIds.length
        ? await prisma.channel.findMany({
            where: { userId: { in: ownerIds } },
            select: { id: true, userId: true },
          })
        : [];
      const channelOwner = new Map(ownerChannels.map((c) => [c.id, c.userId]));
      const orderGroups = ownerChannels.length
        ? await prisma.order.groupBy({
            by: ["channelId"],
            where: {
              channelId: { in: ownerChannels.map((c) => c.id) },
              createdAt: { gte: monthStart },
            },
            _count: { _all: true },
          })
        : [];
      const ordersByOwner = new Map<string, number>();
      for (const g of orderGroups) {
        const owner = channelOwner.get(g.channelId);
        if (!owner) continue;
        ordersByOwner.set(owner, (ordersByOwner.get(owner) ?? 0) + g._count._all);
      }

      res.json({
        summary: {
          active: activeCount,
          trialing: trialingCount,
          expiringSoon: expiringCount,
          expired: expiredCount,
          revenueThisMonth: toNumber(monthAgg._sum.amount),
          paymentsThisMonth: monthAgg._count,
        },
        total,
        subscriptions: subs.map((s) => ({
          id: s.id,
          user: s.user,
          plan: { id: s.plan.id, code: s.plan.code, name: s.plan.name },
          ordersThisMonth: ordersByOwner.get(s.user.id) ?? 0,
          orderLimit: s.plan.maxOrdersPerMonth,
          status: effectiveSubscriptionStatus(s),
          isTrial: s.isTrial,
          currentPeriodStart: s.currentPeriodStart,
          currentPeriodEnd: s.currentPeriodEnd,
          daysLeft: s.currentPeriodEnd
            ? Math.ceil((s.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
            : null,
          createdAt: s.createdAt,
        })),
        recentPayments: recentPayments.map((p) => ({ ...p, amount: toNumber(p.amount) })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/admin/subscriptions/:userId/payment — KẾ TOÁN XÁC NHẬN đã nhận
// chuyển khoản: { planId, cycle, amount?, occurredAt?, note? }. Một lệnh tự
// sinh đủ: gia hạn thuê bao + chứng từ + bút toán THU (chờ hóa đơn) + hoa hồng.
router.post(
  "/subscriptions/:userId/payment",
  requirePlatformPermission("hq.finance"),
  async (req: AuthRequest, res, next) => {
    try {
      const { planId, cycle, amount, occurredAt, note } = req.body ?? {};

      const customer = await prisma.user.findFirst({
        where: { id: req.params.userId, ownerId: null },
        select: { id: true, email: true, fullName: true },
      });
      if (!customer) {
        res.status(404).json({ error: "Không tìm thấy chủ shop này" });
        return;
      }
      if (!(Object.values(BillingCycle) as string[]).includes(cycle)) {
        res.status(400).json({ error: "Chu kỳ không hợp lệ (MONTHLY/YEARLY)" });
        return;
      }
      const plan = await prisma.servicePlan.findUnique({
        where: { id: String(planId ?? "") },
        select: { id: true },
      });
      if (!plan) {
        res.status(400).json({ error: "Gói không hợp lệ" });
        return;
      }
      let amountValue: number | undefined;
      if (amount !== undefined && amount !== null && amount !== "") {
        amountValue = Math.floor(Number(amount));
        if (!Number.isFinite(amountValue) || amountValue < 0) {
          res.status(400).json({ error: "Số tiền không hợp lệ" });
          return;
        }
      }
      let when: Date | undefined;
      if (occurredAt) {
        when = new Date(occurredAt);
        if (Number.isNaN(when.getTime())) {
          res.status(400).json({ error: "Ngày thu tiền không hợp lệ" });
          return;
        }
      }

      const actor = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { fullName: true },
      });

      const { payment, subscription } = await recordPackagePayment({
        userId: customer.id,
        planId: plan.id,
        cycle: cycle as BillingCycle,
        amount: amountValue,
        method: PackagePaymentMethod.BANK_TRANSFER,
        occurredAt: when,
        note: typeof note === "string" ? note : null,
        actorId: req.userId!,
        actorName: actor?.fullName ?? "(không rõ)",
      });

      await writeAuditLog(req, {
        action: "subscription.payment",
        targetUserId: customer.id,
        targetLabel: `${customer.fullName} (${customer.email ?? customer.id})`,
        detail: {
          plan: payment.planName,
          cycle: payment.cycle,
          amount: toNumber(payment.amount),
          periodEnd: payment.periodEnd.toISOString(),
        },
      });

      res.status(201).json({
        payment: { ...payment, amount: toNumber(payment.amount) },
        subscription: {
          id: subscription.id,
          currentPeriodEnd: subscription.currentPeriodEnd,
          status: subscription.status,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
