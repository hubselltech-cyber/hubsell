// ============================================================
// CƯỠNG CHẾ TRẦN GÓI DỊCH VỤ — GĐ2 thương mại hóa (22/08).
//
// Triết lý (anh Trung chốt 22/08):
// - Trần GIAN HÀNG + NHÂN VIÊN: chặn CỨNG tại nút tạo/kết nối MỚI. Hạ gói
//   không xóa gì của khách (grandfather) — chỉ không tạo thêm được.
// - Trần ĐƠN/THÁNG: chặn MỀM bậc thang. 80% cảnh báo vàng + chuông → 100%
//   cảnh báo đỏ + popup (đơn VẪN đồng bộ đủ) → vượt ân hạn (120% hoặc 7 ngày
//   kể từ lúc chạm 100%) thì KHÓA TẦNG GIÁ TRỊ GIA TĂNG (tài chính/trợ lý/
//   quảng cáo… hiện màn mời nâng gói). Đơn + tồn kho vẫn SYNC NGẦM khi vượt
//   trần đơn — nâng gói là dữ liệu hiện lại nguyên vẹn.
// - Gói HẾT HẠN (kể cả hết dùng thử): cùng cơ chế mềm — ân hạn 7 ngày rồi
//   khóa tầng giá trị gia tăng; thanh toán/gia hạn là mở lại ngay.
//   ⚠️ 15/10/2026 anh Trung đổi luật: hết hạn quá ân hạn thì gian NGỦ ĐÔNG
//   (services/plan-hibernation.ts) — ngừng quét đơn/đối soát/ads/tồn, webhook
//   nhận rồi bỏ, chỉ còn làm mới token; gia hạn thức lại + mốc nước vét bù ≤90
//   ngày. Không xóa dữ liệu. Vượt trần đơn KHÔNG ngủ đông (luật 22/08 giữ).
// - Khách CŨ chưa được gán thuê bao (backfill --assign chưa chạy): coi như
//   KHÔNG GIỚI HẠN — không bao giờ khóa nhầm người chưa từng được báo giá.
// - Full tính năng mọi bậc đã chốt nên GĐ2 KHÔNG gate theo ServicePlan.features
//   (⚠️ gói tạo qua UI có features = {} — nếu sau này gate LLM/auto-chat theo
//   gói thì PHẢI coi {} là full, đừng coi là "không có gì").
//
// Đếm đơn: theo THÁNG DƯƠNG LỊCH, mọi gian của chủ shop, KHÔNG trừ đơn hủy.
// Order.createdAt là ngày phát sinh trên SÀN (mọi luồng upsert đều override),
// nên backfill đơn cũ không làm phồng tháng hiện tại → đếm bằng query trên
// index (channelId, createdAt) + cache TTL trong RAM, không counter tăng dần
// (counter sẽ sai âm thầm với 6 cửa ghi đơn + cascade xóa gian).
// ============================================================

import type { NextFunction, Response } from "express";
import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { notify } from "./notifications";
import { mailHq } from "./hq-mail";
import type { AuthRequest } from "../middleware/auth";
import { isPerOrderPlan } from "./per-order-plan";
import {
  OVERAGE_DUE_DAY,
  OVERAGE_START_MONTH,
  monthLabel as overageMonthLabel,
  monthOverageFor,
  overageFloorPrice,
  overageNoticeText,
  overageUnitPrice,
  upgradeBreakEvenOrder,
} from "./plan-overage";

// ---- Ngưỡng (đề xuất 22/08, anh Trung chưa phán khác — đổi số tại đây) ----
/** Chạm mốc này bắt đầu cảnh báo vàng + chuông. */
export const ORDER_WARN_RATIO = 0.8;
/** Vượt mốc này (120%) là hết ân hạn ngay lập tức. */
export const ORDER_HARD_RATIO = 1.2;
/** Hoặc quá số ngày này kể từ lúc chạm 100% trần đơn. */
export const ORDER_GRACE_DAYS = 7;
/** Gói hết hạn được ân hạn số ngày này trước khi khóa tầng giá trị gia tăng. */
export const EXPIRED_GRACE_DAYS = 7;

/** Cache trạng thái theo chủ shop — tránh COUNT đơn mỗi request. */
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { state: OwnerPlanState; expires: number }>();

const DAY_MS = 24 * 60 * 60 * 1000;

export type OrderQuotaState = "ok" | "warn" | "over" | "locked";
export type LockedReason = "ORDERS" | "EXPIRED" | "OVERAGE_UNPAID" | null;

/** Phiếu phí vượt còn chờ trả của chủ shop (thường 0–1 dòng). */
export interface OpenOverageCharge {
  id: string;
  /** "yyyy-MM" */
  month: string;
  overOrders: number;
  unitPrice: number;
  amount: number;
  /** Qua mốc này còn chưa trả thì khóa tính năng nâng cao. */
  dueAt: Date;
  overdue: boolean;
}

export interface OwnerPlanState {
  /** false = chưa có thuê bao → mọi trần coi như không giới hạn. */
  hasSubscription: boolean;
  plan: {
    id: string;
    code: string;
    name: string;
    tier: number;
    maxChannels: number | null;
    maxOrdersPerMonth: number | null;
    maxStaff: number | null;
    /** Gói tính theo đơn (Enterprise tự phục vụ): mức tối thiểu; null = gói thường. */
    minOrdersPerMonth: number | null;
    /** Gói tính theo đơn: đơn giá phần vượt ₫/đơn (= giá công bố); null = gói thường/chưa đặt. */
    pricePerOrder: number | null;
  } | null;
  /** Gói tính theo đơn: số đơn/tháng khách cam kết cho kỳ đang chạy (cũng là trần đơn). */
  committedOrders: number | null;
  subscription: {
    status: "ACTIVE" | "EXPIRED" | "CANCELLED";
    isTrial: boolean;
    currentPeriodStart: Date;
    currentPeriodEnd: Date | null;
    daysLeft: number | null;
  } | null;
  usage: { channels: number; staff: number; ordersThisMonth: number };
  orders: {
    limit: number | null;
    /** Trần TRỌN THÁNG của gói / số đơn cam kết. Khác `limit` khi kỳ đã trả chỉ phủ một phần
     *  tháng (tháng đầu mua giữa chừng): `limit` đã chia theo phần tháng — FE giải thích. */
    planCap: number | null;
    used: number;
    /** used/limit — null khi không giới hạn. */
    ratio: number | null;
    state: OrderQuotaState;
    /** Hết ân hạn (khóa) sau mốc này — null khi chưa chạm 100% / không giới hạn. */
    graceDeadline: Date | null;
  };
  expiry: {
    expired: boolean;
    /** Quá mốc này thì khóa vì hết hạn — null khi còn hạn / vô thời hạn. */
    lockDeadline: Date | null;
    locked: boolean;
  };
  /**
   * PHÍ VƯỢT "tính thẳng" (11/11/2026, services/plan-overage.ts). `billable` = kỳ đang
   * chạy đã trả tiền và gói có trần đơn → vượt KHÔNG khóa, tính tiền đầu tháng sau.
   * Khi billable, `orders.limit/used` là trần + số đơn của ĐÚNG phép tính sẽ chốt (mua
   * giữa tháng thì trần đã chia theo phần tháng) — số khách thấy = số trên phiếu.
   */
  overage: {
    billable: boolean;
    /** Đơn giá vượt ₫/đơn của gói đang dùng (cả khi chưa billable — để bày lúc mua). */
    unitPrice: number | null;
    estOverOrders: number;
    estAmount: number;
    /** Hạn trả: hết ngày này của tháng sau. */
    dueDay: number;
    /** Đơn thứ mấy trong tháng thì tiền vượt bằng mức chênh lên gói trên (mốc BÁO, không chặn). */
    breakEvenOrder: number | null;
    nextPlanName: string | null;
    openCharges: OpenOverageCharge[];
  };
  /** Tổng hợp: có khóa tầng giá trị gia tăng không. */
  locked: boolean;
  lockedReason: LockedReason;
}

/** Gọi sau khi tạo/xóa gian, tạo/xóa nhân viên, ghi nhận thanh toán — trạng
 * thái tính lại ngay ở request kế tiếp thay vì chờ hết TTL. */
export function invalidatePlanState(ownerId: string): void {
  cache.delete(ownerId);
}

// ---- Lịch VIỆT NAM (UTC+7, không DST): Render chạy múi giờ UTC nên mọi phép
// "tháng này/ngày này" dùng giờ máy sẽ lệch 7 tiếng quanh nửa đêm — đơn phát
// sinh 17h-24h UTC ngày cuối tháng bị đếm nhầm sang tháng sau theo lịch VN. ----
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function vnView(d: Date): Date {
  return new Date(d.getTime() + VN_OFFSET_MS); // đọc bằng getUTC* = giờ VN
}

/** Mốc 00:00 ngày MÙNG 1 THÁNG NÀY theo giờ Việt Nam (trả về Date UTC chuẩn). */
export function vnMonthStart(now: Date): Date {
  const vn = vnView(now);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) - VN_OFFSET_MS);
}

function monthKeyOf(d: Date): string {
  const vn = vnView(d);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelOf(d: Date): string {
  const vn = vnView(d);
  return `${String(vn.getUTCMonth() + 1).padStart(2, "0")}/${vn.getUTCFullYear()}`;
}

function fmtDate(d: Date): string {
  const vn = vnView(d);
  return `${String(vn.getUTCDate()).padStart(2, "0")}/${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Trạng thái trần + kỳ hạn của MỘT chủ shop — nguồn chân lý duy nhất, dùng
 * chung cho middleware khóa API, endpoint /api/subscription/me, và chuông.
 * Có cache TTL 60s; mọi side-effect (ghi mốc ân hạn, phát chuông) đều lười
 * và idempotent — chỉ chạy khi trạng thái thực sự đổi.
 */
export async function getOwnerPlanState(ownerId: string): Promise<OwnerPlanState> {
  const hit = cache.get(ownerId);
  if (hit && hit.expires > Date.now()) return hit.state;

  const state = await computeOwnerPlanState(ownerId);

  // Chặn cache phình vô hạn (mỗi owner 1 phần tử — chỉ là lưới an toàn).
  if (cache.size > 5000) cache.clear();
  cache.set(ownerId, { state, expires: Date.now() + CACHE_TTL_MS });
  return state;
}

async function computeOwnerPlanState(ownerId: string): Promise<OwnerPlanState> {
  const now = new Date();
  const monthStart = vnMonthStart(now);
  const monthKey = monthKeyOf(now);

  const [sub, channels, staff, ordersThisMonth, openChargeRows] = await Promise.all([
    prisma.subscription.findUnique({
      where: { userId: ownerId },
      include: {
        plan: {
          select: {
            id: true,
            code: true,
            name: true,
            tier: true,
            maxChannels: true,
            maxOrdersPerMonth: true,
            maxStaff: true,
            minOrdersPerMonth: true,
            pricePerOrder: true,
            priceMonthly: true,
          },
        },
      },
    }),
    // Cùng định nghĩa với assertChannelSlot (countedChannelWhere).
    prisma.channel.count({ where: countedChannelWhere(ownerId) }),
    prisma.user.count({ where: { ownerId } }),
    // Đơn tính vào trần = đơn của gian TRÊN SÀN. Đơn bán tại quầy (gian OFFLINE) không tính
    // (anh Trung chốt 11/11/2026 khi làm phí vượt) — một định nghĩa cho thanh mức dùng,
    // luật khóa mềm và câu SQL phí vượt (services/plan-overage.ts).
    prisma.order.count({
      where: {
        channel: { userId: ownerId, channelName: { not: ChannelName.OFFLINE } },
        createdAt: { gte: monthStart },
      },
    }),
    // Nợ phí vượt đi theo CHỦ SHOP, không theo gói: hạ gói / hết hạn vẫn còn.
    prisma.planOverageCharge.findMany({
      where: { ownerId, status: "OPEN" },
      orderBy: { month: "asc" },
      select: { id: true, month: true, overOrders: true, unitPrice: true, amount: true, dueAt: true },
    }),
  ]);

  const usage = { channels, staff, ordersThisMonth };
  const openCharges: OpenOverageCharge[] = openChargeRows.map((c) => ({
    id: c.id,
    month: c.month,
    overOrders: c.overOrders,
    unitPrice: Number(c.unitPrice),
    amount: Number(c.amount),
    dueAt: c.dueAt,
    overdue: c.dueAt.getTime() <= now.getTime(),
  }));
  const overageLocked = openCharges.some((c) => c.overdue);

  // Chưa có thuê bao (khách cũ chưa backfill --assign) → không giới hạn gì.
  if (!sub) {
    return {
      hasSubscription: false,
      plan: null,
      committedOrders: null,
      subscription: null,
      usage,
      orders: { limit: null, planCap: null, used: ordersThisMonth, ratio: null, state: "ok", graceDeadline: null },
      expiry: { expired: false, lockDeadline: null, locked: false },
      overage: {
        billable: false,
        unitPrice: null,
        estOverOrders: 0,
        estAmount: 0,
        dueDay: OVERAGE_DUE_DAY,
        breakEvenOrder: null,
        nextPlanName: null,
        openCharges,
      },
      locked: overageLocked,
      lockedReason: overageLocked ? "OVERAGE_UNPAID" : null,
    };
  }

  // ---- Kỳ hạn: suy lúc đọc, không cron (cùng logic effectiveSubscriptionStatus,
  // viết lại tại chỗ để subscription-service được phép import ngược module này). ----
  const periodEnd = sub.currentPeriodEnd;
  const status: "ACTIVE" | "EXPIRED" | "CANCELLED" =
    sub.status === "CANCELLED"
      ? "CANCELLED"
      : periodEnd && periodEnd.getTime() < now.getTime()
        ? "EXPIRED"
        : "ACTIVE";
  const daysLeft = periodEnd
    ? Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS)
    : null;
  const expired = status !== "ACTIVE" && periodEnd !== null;
  const expiryLockDeadline = expired
    ? new Date(periodEnd!.getTime() + EXPIRED_GRACE_DAYS * DAY_MS)
    : null;
  const expiryLocked = expiryLockDeadline !== null && now.getTime() > expiryLockDeadline.getTime();

  // ---- Gói TÍNH THEO ĐƠN (Enterprise tự phục vụ, 11/11/2026): trần = số đơn khách
  // cam kết trên khoản thanh toán đang phủ hôm nay (mỗi kỳ một số); không có khoản
  // nào (HQ đổi gói tay / khoản ghi tay cũ) = mức tối thiểu của gói. Vượt KHÔNG khóa —
  // anh Trung chốt phần vượt thu vào tháng sau (lát 2), chỉ giữ chuông/thanh mức. ----
  const perOrder = isPerOrderPlan(sub.plan);
  let committedOrders: number | null = null;
  if (perOrder) {
    const covering = await prisma.packagePayment.findFirst({
      where: {
        userId: ownerId,
        kind: "PLAN", // khoản trả phí vượt (OVERAGE) không phải kỳ hạn gói
        planCode: sub.plan.code,
        periodStart: { lte: now },
        periodEnd: { gt: now },
      },
      orderBy: { periodStart: "desc" },
      select: { committedOrders: true },
    });
    committedOrders = covering?.committedOrders ?? sub.plan.minOrdersPerMonth;
  }

  // ---- PHÍ VƯỢT "tính thẳng" (anh Trung chốt 11/11/2026): kỳ ĐÃ TRẢ TIỀN của gói có
  // trần đơn thì vượt không khóa — tính tiền đầu tháng sau theo đơn giá của gói. Trần +
  // số đơn lấy từ ĐÚNG câu SQL sẽ chốt (monthOverageFor) nên số khách thấy trong tháng
  // khớp phiếu. Dùng thử / gói thường trước OVERAGE_START_MONTH / thuê bao HQ đổi tay
  // không có kỳ trả tiền nào → est = null → giữ luật khóa mềm cũ bên dưới. ----
  const overageEligible = !sub.isTrial && (perOrder || monthKey >= OVERAGE_START_MONTH);
  const [est, floor] = await Promise.all([
    overageEligible ? monthOverageFor(ownerId, { month: monthKey }).catch(() => null) : Promise.resolve(null),
    overageFloorPrice().catch(() => null),
  ]);
  const billable = est !== null;
  const planUnitPrice = overageUnitPrice(sub.plan, floor);
  const unitPrice = est?.unitPrice ?? planUnitPrice;

  // Mốc BÁO "từ đây nâng gói rẻ hơn" — chỉ gói thường còn gói trên đang bán.
  let breakEvenOrder: number | null = null;
  let nextPlanName: string | null = null;
  if (billable && !perOrder && unitPrice) {
    const next = await prisma.servicePlan.findFirst({
      where: { isActive: true, minOrdersPerMonth: null, tier: { gt: sub.plan.tier }, priceMonthly: { gt: sub.plan.priceMonthly } },
      orderBy: { tier: "asc" },
      select: { name: true, priceMonthly: true },
    });
    if (next) {
      breakEvenOrder = upgradeBreakEvenOrder(est!.orderCap, unitPrice, Number(sub.plan.priceMonthly), Number(next.priceMonthly));
      nextPlanName = next.name;
    }
  }

  // ---- Trần đơn tháng: reset lười khi sang tháng, ghi mốc ân hạn khi chạm 100%. ----
  const limit = billable ? est!.orderCap : perOrder ? committedOrders : sub.plan.maxOrdersPerMonth;
  const usedOrders = billable ? est!.ordersCounted : ordersThisMonth;
  const sameMonth = sub.quotaMonth === monthKey;
  let overSince = sameMonth ? sub.overQuotaSince : null;
  let notifiedLevel = sameMonth ? sub.quotaNotifiedLevel : 0;

  const ratio = limit && limit > 0 ? usedOrders / limit : null;
  if (ratio !== null) {
    if (ratio >= 1 && !overSince) overSince = now;
    if (ratio < 1 && overSince) overSince = null; // nâng gói/sang tháng → tự lành
  } else {
    overSince = null;
  }

  const noOrderLock = perOrder || billable; // vượt tính tiền, không khóa
  const orderLocked =
    !noOrderLock &&
    ratio !== null &&
    (ratio >= ORDER_HARD_RATIO ||
      (overSince !== null && now.getTime() - overSince.getTime() >= ORDER_GRACE_DAYS * DAY_MS));
  const orderState: OrderQuotaState =
    ratio === null
      ? "ok"
      : orderLocked
        ? "locked"
        : ratio >= 1
          ? "over"
          : ratio >= ORDER_WARN_RATIO
            ? "warn"
            : "ok";
  const graceDeadline =
    overSince && !orderLocked && !noOrderLock ? new Date(overSince.getTime() + ORDER_GRACE_DAYS * DAY_MS) : null;

  // ---- Chuông theo mốc (80/100/120) — mỗi mốc đúng MỘT lần mỗi tháng. ----
  // Mốc 110 chỉ có ở gói tính tiền phần vượt: tiền vượt đã bằng mức chênh lên gói trên.
  const pastBreakEven = billable && breakEvenOrder !== null && usedOrders >= breakEvenOrder;
  const targetLevel =
    orderState === "locked" ? 120 : pastBreakEven ? 110 : orderState === "over" ? 100 : orderState === "warn" ? 80 : 0;
  const overagePrice = unitPrice;
  const estOverOrders = billable ? est!.overOrders : 0;
  const estAmount = billable ? est!.amount : 0;
  if (noOrderLock && targetLevel > notifiedLevel && limit) {
    // Gói tính tiền phần vượt: không bao giờ khóa vì vượt — chỉ báo phần vượt tính thêm.
    const monthLabel = monthLabelOf(now);
    const base = `${usedOrders.toLocaleString("vi-VN")}/${limit.toLocaleString("vi-VN")} đơn — gói ${sub.plan.name}`;
    void notify(ownerId, {
      type: "plan_quota",
      title:
        targetLevel === 80
          ? `Đã dùng ${Math.floor(ratio! * 100)}% số đơn của gói tháng ${monthLabel}`
          : targetLevel === 110
            ? `Nâng lên gói ${nextPlanName} từ giờ sẽ rẻ hơn trả phần vượt`
            : `Đã vượt số đơn của gói tháng ${monthLabel}`,
      body:
        targetLevel === 110
          ? `${base}. Phần vượt tạm tính ${estAmount.toLocaleString("vi-VN")} ₫ đã bằng mức chênh lên gói ${nextPlanName}. Nâng gói trong tháng này thì số đơn của gói mới áp cho cả tháng.`
          : `${base}. ${overageNoticeText(overagePrice)}`,
      link: "/settings/plan",
    });
    // BÁO SALE (thư HQ, mỗi mốc một lần mỗi tháng — cùng cờ quotaNotifiedLevel với chuông):
    // gói tính theo đơn chạm 80 % / vượt, và gói thường tới mốc "nâng gói rẻ hơn" — đây là
    // lúc gọi khách (bán số đơn lớn hơn / mời nâng gói) trước khi phiếu phí vượt ra.
    if (perOrder || targetLevel === 110) {
      const what =
        targetLevel === 110
          ? `đã tới mốc nâng lên gói ${nextPlanName} rẻ hơn trả phần vượt`
          : targetLevel === 80
            ? `đã dùng ${Math.floor(ratio! * 100)}% số đơn đã mua`
            : "đã vượt số đơn đã mua";
      void prisma.user
        .findUnique({ where: { id: ownerId }, select: { fullName: true, email: true, phone: true } })
        .then((u) =>
          mailHq({
            subject: `[Hubsell] Khách ${u?.fullName ?? ownerId} ${what} (gói ${sub.plan.name})`,
            html: `<p><b>${u?.fullName ?? ownerId}</b> (${u?.email ?? "—"}${u?.phone ? ` · ${u.phone}` : ""}) — gói ${sub.plan.name}, tháng ${monthLabel}: <b>${base.split(" — ")[0]}</b>.</p>${
              estAmount > 0 ? `<p>Phần vượt tạm tính: ${estOverOrders.toLocaleString("vi-VN")} đơn ≈ <b>${estAmount.toLocaleString("vi-VN")}₫</b>.</p>` : ""
            }<p>Gợi ý: gọi khách ${targetLevel === 110 ? `mời nâng gói ${nextPlanName} (nâng trong tháng thì số đơn gói mới áp cả tháng)` : "tư vấn số đơn cho kỳ sau"}.</p>`,
          })
        )
        .catch(() => {});
    }
  } else if (targetLevel > notifiedLevel && limit) {
    const monthLabel = monthLabelOf(now);
    const base = `${ordersThisMonth.toLocaleString("vi-VN")}/${limit.toLocaleString("vi-VN")} đơn — gói ${sub.plan.name}`;
    if (targetLevel === 80) {
      void notify(ownerId, {
        type: "plan_quota",
        title: `Đã dùng ${Math.floor(ratio! * 100)}% trần đơn tháng ${monthLabel}`,
        body: `${base}. Nâng gói sớm để không gián đoạn khi shop tăng trưởng.`,
        link: "/settings/plan",
      });
    } else if (targetLevel === 100) {
      void notify(ownerId, {
        type: "plan_quota",
        title: `Đã vượt trần đơn tháng ${monthLabel}`,
        body: `${base}. Đơn vẫn được đồng bộ đầy đủ; sau ${fmtDate(new Date(now.getTime() + ORDER_GRACE_DAYS * DAY_MS))} các tính năng nâng cao sẽ tạm khóa nếu chưa nâng gói.`,
        link: "/settings/plan",
      });
    } else {
      void notify(ownerId, {
        type: "plan_quota",
        title: `Tính năng nâng cao đã tạm khóa (vượt trần đơn tháng ${monthLabel})`,
        body: `${base}. Đơn hàng + tồn kho vẫn đồng bộ ngầm, không mất dữ liệu — nâng gói là mở lại nguyên vẹn.`,
        link: "/settings/plan",
      });
    }
  }
  // Mốc là high-water trong tháng (không báo lại mốc đã báo); tụt hẳn về ok
  // (nâng gói giữa tháng) thì reset để tháng đó vẫn còn cảnh báo nếu chạm lại.
  const nextNotifiedLevel = targetLevel > notifiedLevel ? targetLevel : targetLevel === 0 ? 0 : notifiedLevel;

  // ---- Chuông kỳ hạn: sắp hết hạn (≤3 ngày) và đã hết hạn. Title cố định theo
  // ngày hết hạn → dedupe 24h chưa-đọc của notify() lo phần chống spam. ----
  if (periodEnd && status === "ACTIVE" && daysLeft !== null && daysLeft <= 3) {
    void notify(ownerId, {
      type: "plan_expiry",
      title: `Gói ${sub.plan.name}${sub.isTrial ? " (dùng thử)" : ""} hết hạn ngày ${fmtDate(periodEnd)}`,
      body: "Gia hạn/thanh toán trước ngày hết hạn để không gián đoạn các tính năng nâng cao.",
      link: "/settings/plan",
    });
  }
  if (expired) {
    void notify(ownerId, {
      type: "plan_expiry",
      title: `Gói ${sub.plan.name}${sub.isTrial ? " (dùng thử)" : ""} đã hết hạn từ ${fmtDate(periodEnd!)}`,
      body: expiryLocked
        ? "Các tính năng nâng cao đang tạm khóa, đồng bộ đơn hàng + tồn kho tạm ngừng — thanh toán là mở lại ngay, đơn phát sinh trong lúc ngừng được kéo bù. Dữ liệu đã có giữ nguyên."
        : `Sau ngày ${fmtDate(expiryLockDeadline!)} các tính năng nâng cao sẽ tạm khóa và đồng bộ đơn hàng, tồn kho tạm ngừng nếu chưa gia hạn.`,
      link: "/settings/plan",
    });
  }

  // ---- Ghi lười các cột theo dõi — chỉ khi có thay đổi thật. ----
  const dirty =
    sub.quotaMonth !== monthKey ||
    (sub.overQuotaSince?.getTime() ?? null) !== (overSince?.getTime() ?? null) ||
    sub.quotaNotifiedLevel !== nextNotifiedLevel;
  if (dirty) {
    await prisma.subscription
      .update({
        where: { id: sub.id },
        data: { quotaMonth: monthKey, overQuotaSince: overSince, quotaNotifiedLevel: nextNotifiedLevel },
      })
      .catch(() => {}); // theo dõi trần là tiện ích — không được làm vỡ request đang gọi
  }

  const locked = orderLocked || expiryLocked || overageLocked;
  const { priceMonthly: _priceMonthly, ...planOut } = sub.plan;
  void _priceMonthly;
  return {
    hasSubscription: true,
    plan: { ...planOut, pricePerOrder: sub.plan.pricePerOrder === null ? null : Number(sub.plan.pricePerOrder) },
    committedOrders,
    subscription: {
      status,
      isTrial: sub.isTrial,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: periodEnd,
      daysLeft,
    },
    usage,
    orders: {
      limit: limit ?? null,
      planCap: (perOrder ? committedOrders : sub.plan.maxOrdersPerMonth) ?? null,
      used: usedOrders,
      ratio,
      state: orderState,
      graceDeadline,
    },
    expiry: { expired, lockDeadline: expiryLockDeadline, locked: expiryLocked },
    overage: {
      billable,
      unitPrice,
      estOverOrders,
      estAmount,
      dueDay: OVERAGE_DUE_DAY,
      breakEvenOrder,
      nextPlanName,
      openCharges,
    },
    locked,
    // Thứ tự ưu tiên: hết hạn (lời mời "gia hạn") > nợ phí vượt quá hạn (lời mời "thanh
    // toán phần vượt") > vượt trần của gói còn theo luật khóa mềm (lời mời "nâng gói").
    lockedReason: expiryLocked ? "EXPIRED" : overageLocked ? "OVERAGE_UNPAID" : orderLocked ? "ORDERS" : null,
  };
}

// ============================================================
// CHẶN CỨNG trần gian hàng / nhân viên — gọi tại các route tạo MỚI.
// ============================================================

/** Gian được tính vào trần gói — MỘT định nghĩa cho cả số hiển thị lẫn chốt chặn. */
function countedChannelWhere(ownerId: string) {
  return {
    userId: ownerId,
    status: "ACTIVE" as const,
    channelName: { not: ChannelName.OFFLINE },
  };
}

export class PlanLimitError extends Error {
  code: "PLAN_LIMIT_CHANNELS" | "PLAN_LIMIT_STAFF";
  limit: number;
  current: number;
  planName: string;
  constructor(
    code: "PLAN_LIMIT_CHANNELS" | "PLAN_LIMIT_STAFF",
    message: string,
    limit: number,
    current: number,
    planName: string
  ) {
    super(message);
    this.code = code;
    this.limit = limit;
    this.current = current;
    this.planName = planName;
  }
}

/**
 * Kiểm tra còn chỗ tạo thêm `need` gian hàng MỚI (kết nối lại gian cũ không
 * gọi hàm này). Đếm TƯƠI tại thời điểm tạo — không dùng cache 60s để hai lần
 * bấm liên tiếp không lách trần. Chỉ đếm gian ACTIVE: hệ thống không có nút
 * xóa gian, "ngắt kết nối" là cách duy nhất khách tự trống chỗ — đếm cả
 * DISCONNECTED thì khách kẹt vĩnh viễn với gian bỏ đi. (Grandfather: hạ gói
 * đang thừa gian so với trần thì giữ nguyên, chỉ không kết nối thêm được.)
 * Gian OFFLINE (bán tại quầy) KHÔNG tính vào trần và tạo mới không cần gọi hàm
 * này: nó không đồng bộ, không ăn hạn mức API của sàn — thứ trần gian bảo vệ —
 * và đếm nó thì "3 gian" trên bảng giá chỉ còn 2 gian sàn (19/09).
 */
export async function assertChannelSlot(ownerId: string, need = 1): Promise<void> {
  const st = await getOwnerPlanState(ownerId);
  const limit = st.plan?.maxChannels;
  if (limit == null) return;
  const current = await prisma.channel.count({ where: countedChannelWhere(ownerId) });
  if (current + need > limit) {
    throw new PlanLimitError(
      "PLAN_LIMIT_CHANNELS",
      `Gói ${st.plan!.name} cho tối đa ${limit} gian hàng trên sàn đang hoạt động (shop đang có ${current}). ` +
        "Nâng gói để kết nối thêm gian, hoặc ngắt kết nối gian không dùng để trống chỗ.",
      limit,
      current,
      st.plan!.name
    );
  }
}

/** Như assertChannelSlot nhưng cho tài khoản nhân viên. */
export async function assertStaffSlot(ownerId: string): Promise<void> {
  const st = await getOwnerPlanState(ownerId);
  const limit = st.plan?.maxStaff;
  if (limit == null) return;
  const current = await prisma.user.count({ where: { ownerId } });
  if (current + 1 > limit) {
    throw new PlanLimitError(
      "PLAN_LIMIT_STAFF",
      `Gói ${st.plan!.name} cho tối đa ${limit} tài khoản nhân viên (shop đang có ${current}). ` +
        "Nâng gói để tạo thêm nhân viên, hoặc xóa tài khoản không dùng.",
      limit,
      current,
      st.plan!.name
    );
  }
}

/** Trả lỗi 409 chuẩn cho PlanLimitError; false = không phải lỗi trần. */
export function respondPlanLimit(res: Response, err: unknown): boolean {
  if (!(err instanceof PlanLimitError)) return false;
  res.status(409).json({
    error: err.message,
    code: err.code,
    limit: err.limit,
    current: err.current,
    planName: err.planName,
  });
  return true;
}

// ============================================================
// CHẶN MỀM tầng giá trị gia tăng — middleware gắn vào các mount app.ts.
// ============================================================

/**
 * Khóa nhóm API giá trị gia tăng khi vượt ân hạn trần đơn / gói hết hạn quá
 * ân hạn. Nhóm SỐNG CÒN (đơn hàng, kho, kênh bán, dashboard) KHÔNG gắn
 * middleware này — dữ liệu khách không bao giờ thủng.
 * Lỗi khi tính trạng thái → CHO QUA (fail-open): thà tạm miễn phí còn hơn
 * chặn nhầm khách đang trả tiền.
 */
export async function requirePlanUnlocked(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Tài khoản điều hành nền tảng không bao giờ tự khóa mình.
    if (req.isPlatformAdmin) {
      next();
      return;
    }
    const st = await getOwnerPlanState(req.ownerId!);
    if (!st.locked) {
      next();
      return;
    }
    res.status(403).json({
      error:
        st.lockedReason === "EXPIRED"
          ? `Gói ${st.plan?.name ?? "dịch vụ"} đã hết hạn — gia hạn để tiếp tục dùng các tính năng nâng cao và nối lại đồng bộ đơn hàng, tồn kho (đang tạm ngừng). Dữ liệu đã có giữ nguyên.`
          : st.lockedReason === "OVERAGE_UNPAID"
            ? `Phần đơn vượt gói tháng ${overageMonthLabel(st.overage.openCharges.find((c) => c.overdue)?.month ?? "")} chưa được thanh toán — thanh toán ở trang Gói dịch vụ để mở lại các tính năng nâng cao. Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ.`
          : `Shop đã vượt trần đơn của gói ${st.plan?.name ?? "hiện tại"} — nâng gói để mở lại các tính năng nâng cao. Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ.`,
      code: "PLAN_LOCKED",
      reason: st.lockedReason,
    });
  } catch (err) {
    console.error("[plan-enforcement] Tính trạng thái gói lỗi — cho qua:", err);
    next();
  }
}
