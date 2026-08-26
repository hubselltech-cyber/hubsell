// ============================================================
// CƯỠNG CHẾ TRẦN GÓI DỊCH VỤ — GĐ2 thương mại hóa (22/08).
//
// Triết lý (anh Trung chốt 22/08):
// - Trần GIAN HÀNG + NHÂN VIÊN: chặn CỨNG tại nút tạo/kết nối MỚI. Hạ gói
//   không xóa gì của khách (grandfather) — chỉ không tạo thêm được.
// - Trần ĐƠN/THÁNG: chặn MỀM bậc thang. 80% cảnh báo vàng + chuông → 100%
//   cảnh báo đỏ + popup (đơn VẪN đồng bộ đủ) → vượt ân hạn (120% hoặc 7 ngày
//   kể từ lúc chạm 100%) thì KHÓA TẦNG GIÁ TRỊ GIA TĂNG (tài chính/trợ lý/
//   quảng cáo… hiện màn mời nâng gói). Đơn + tồn kho vẫn SYNC NGẦM — KHÔNG
//   BAO GIỜ ngắt đồng bộ, nâng gói là dữ liệu hiện lại nguyên vẹn.
// - Gói HẾT HẠN (kể cả hết dùng thử): cùng cơ chế mềm — ân hạn 7 ngày rồi
//   khóa tầng giá trị gia tăng; thanh toán/gia hạn là mở lại ngay.
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
import { prisma } from "../lib/prisma";
import { notify } from "./notifications";
import type { AuthRequest } from "../middleware/auth";

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
export type LockedReason = "ORDERS" | "EXPIRED" | null;

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
  } | null;
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

  const [sub, channels, staff, ordersThisMonth] = await Promise.all([
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
          },
        },
      },
    }),
    // Cùng định nghĩa với assertChannelSlot: trần chỉ tính gian ACTIVE.
    prisma.channel.count({ where: { userId: ownerId, status: "ACTIVE" } }),
    prisma.user.count({ where: { ownerId } }),
    prisma.order.count({
      where: { channel: { userId: ownerId }, createdAt: { gte: monthStart } },
    }),
  ]);

  const usage = { channels, staff, ordersThisMonth };

  // Chưa có thuê bao (khách cũ chưa backfill --assign) → không giới hạn gì.
  if (!sub) {
    return {
      hasSubscription: false,
      plan: null,
      subscription: null,
      usage,
      orders: { limit: null, used: ordersThisMonth, ratio: null, state: "ok", graceDeadline: null },
      expiry: { expired: false, lockDeadline: null, locked: false },
      locked: false,
      lockedReason: null,
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

  // ---- Trần đơn tháng: reset lười khi sang tháng, ghi mốc ân hạn khi chạm 100%. ----
  const limit = sub.plan.maxOrdersPerMonth;
  const sameMonth = sub.quotaMonth === monthKey;
  let overSince = sameMonth ? sub.overQuotaSince : null;
  let notifiedLevel = sameMonth ? sub.quotaNotifiedLevel : 0;

  const ratio = limit && limit > 0 ? ordersThisMonth / limit : null;
  if (ratio !== null) {
    if (ratio >= 1 && !overSince) overSince = now;
    if (ratio < 1 && overSince) overSince = null; // nâng gói/sang tháng → tự lành
  } else {
    overSince = null;
  }

  const orderLocked =
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
    overSince && !orderLocked ? new Date(overSince.getTime() + ORDER_GRACE_DAYS * DAY_MS) : null;

  // ---- Chuông theo mốc (80/100/120) — mỗi mốc đúng MỘT lần mỗi tháng. ----
  const targetLevel = orderState === "locked" ? 120 : orderState === "over" ? 100 : orderState === "warn" ? 80 : 0;
  if (targetLevel > notifiedLevel && limit) {
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
        ? "Các tính năng nâng cao đang tạm khóa. Đơn hàng + tồn kho vẫn đồng bộ ngầm — thanh toán là mở lại nguyên vẹn."
        : `Sau ngày ${fmtDate(expiryLockDeadline!)} các tính năng nâng cao sẽ tạm khóa nếu chưa gia hạn.`,
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

  const locked = orderLocked || expiryLocked;
  return {
    hasSubscription: true,
    plan: sub.plan,
    subscription: {
      status,
      isTrial: sub.isTrial,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: periodEnd,
      daysLeft,
    },
    usage,
    orders: { limit: limit ?? null, used: ordersThisMonth, ratio, state: orderState, graceDeadline },
    expiry: { expired, lockDeadline: expiryLockDeadline, locked: expiryLocked },
    locked,
    // Hết hạn "thắng" khi cả hai cùng khóa — lời mời đúng là "gia hạn" chứ
    // không phải "nâng gói".
    lockedReason: expiryLocked ? "EXPIRED" : orderLocked ? "ORDERS" : null,
  };
}

// ============================================================
// CHẶN CỨNG trần gian hàng / nhân viên — gọi tại các route tạo MỚI.
// ============================================================

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
 */
export async function assertChannelSlot(ownerId: string, need = 1): Promise<void> {
  const st = await getOwnerPlanState(ownerId);
  const limit = st.plan?.maxChannels;
  if (limit == null) return;
  const current = await prisma.channel.count({
    where: { userId: ownerId, status: "ACTIVE" },
  });
  if (current + need > limit) {
    throw new PlanLimitError(
      "PLAN_LIMIT_CHANNELS",
      `Gói ${st.plan!.name} cho tối đa ${limit} gian hàng đang hoạt động (shop đang có ${current}). ` +
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
          ? `Gói ${st.plan?.name ?? "dịch vụ"} đã hết hạn — gia hạn để tiếp tục dùng các tính năng nâng cao. Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ.`
          : `Shop đã vượt trần đơn của gói ${st.plan?.name ?? "hiện tại"} — nâng gói để mở lại các tính năng nâng cao. Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ.`,
      code: "PLAN_LOCKED",
      reason: st.lockedReason,
    });
  } catch (err) {
    console.error("[plan-enforcement] Tính trạng thái gói lỗi — cho qua:", err);
    next();
  }
}
