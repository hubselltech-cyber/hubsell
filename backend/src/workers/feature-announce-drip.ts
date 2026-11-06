// ============================================================
// GỬI NỐT THƯ THÔNG BÁO TÍNH NĂNG — MỖI NGÀY MỘT LÔ (anh Trung 06/11/2026)
//
// 06/11 lô 1 gửi 51 thư thì Zoho chặn cả hộp gửi (550 5.4.6). Anh chốt: "đặt lịch
// gửi nốt, mỗi lần 50, giãn cách ra, không cần gửi ngay". Worker này mỗi ngày (giờ
// VN) gửi tối đa PER_DAY thư của DRIP.feature cho chủ shop chưa nhận, rồi tự thôi khi
// hết người hoặc quá hạn DRIP.until.
//
// - Số đã gửi trong ngày đếm bằng vé onboarding_reminders tạo từ 0h VN hôm nay →
//   worker khởi động lại giữa ngày không gửi quá PER_DAY; hôm đã gửi tay đủ số thì
//   hôm đó thôi.
// - Thư lỗi đầu tiên (thường là Zoho chặn) → dừng lượt, nghỉ tới HÔM SAU. Dấu "nghỉ"
//   nằm ở DB (vé kind "drip-pause:<kind>:<ngày VN>" gắn chủ shop của thư lỗi), không ở
//   RAM — luật workers/__tests__/no-module-state. Gửi tiếp khi Zoho đã chặn chỉ kéo
//   dài thời gian thư hệ thống (quên mật khẩu, chào khách mới, hóa đơn) bị chặn theo.
// - 50 / ngày và giờ gửi là số anh chốt + mặc định em chọn (sau giờ mở hộp thư buổi
//   sáng), không phải ngưỡng Zoho công bố; Zoho chặn ở ~51 thư liên tiếp ngày 06/11.
//
// Tắt: env FEATURE_DRIP_OFF=1. Gửi xong đợt này thì gỡ cả file (như mẫu thư 29/10).
// ============================================================

import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { BUSINESS_TZ_OFFSET_MS, businessDayStart, toBusinessDateKey } from "../lib/date-range";
import { isMailerConfigured } from "../lib/mailer";
import { ANNOUNCE_FEATURES, sendAnnounceBatch } from "../services/feature-announce";

export const DRIP = {
  feature: "mobile-1-4-2",
  perDay: 50,
  /** Giờ VN bắt đầu gửi mỗi ngày. */
  fromHourVN: 9,
  /** Quá ngày này (giờ VN) thì thôi hẳn, kể cả còn người chưa nhận. */
  until: "2026-11-20",
  pauseMs: 3000,
} as const;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;

let started = false;
let running = false;

/** Kind của vé đánh dấu "đã dừng vì thư lỗi" trong một ngày VN. */
export function pauseKind(featureKind: string, dayKey: string): string {
  return `drip-pause:${featureKind}:${dayKey}`;
}

export function startFeatureAnnounceDripWorker(): void {
  if (started) return;
  started = true;
  if (process.env.FEATURE_DRIP_OFF === "1") {
    console.log("[Feature-drip] TẮT (FEATURE_DRIP_OFF=1)");
    return;
  }
  setTimeout(() => void runFeatureAnnounceDrip(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runFeatureAnnounceDrip(), CHECK_INTERVAL_MS).unref();
  console.log(
    `[Feature-drip] BẬT — "${DRIP.feature}" ${DRIP.perDay} thư/ngày từ ${DRIP.fromHourVN}h VN, tới hết ${DRIP.until}`
  );
}

/** Quyết định thuần: hôm nay còn được gửi bao nhiêu thư (0 = không chạy). */
export function dripBudget(input: {
  now: Date;
  sentToday: number;
  pausedToday: boolean;
}): number {
  const dayKey = toBusinessDateKey(input.now);
  if (dayKey > DRIP.until) return 0;
  if (input.pausedToday) return 0;
  const hourVN = new Date(input.now.getTime() + BUSINESS_TZ_OFFSET_MS).getUTCHours();
  if (hourVN < DRIP.fromHourVN) return 0;
  return Math.max(0, DRIP.perDay - input.sentToday);
}

export async function runFeatureAnnounceDrip(now: Date = new Date()): Promise<void> {
  if (running) return;
  const feature = ANNOUNCE_FEATURES[DRIP.feature];
  if (!feature || !isMailerConfigured()) return;
  running = true;
  try {
    const dayKey = toBusinessDateKey(now);
    const [sentToday, pausedToday] = await Promise.all([
      prisma.onboardingReminder.count({
        where: { kind: feature.kind, createdAt: { gte: businessDayStart(now) } },
      }),
      prisma.onboardingReminder.count({ where: { kind: pauseKind(feature.kind, dayKey) } }),
    ]);
    const budget = dripBudget({ now, sentToday, pausedToday: pausedToday > 0 });
    if (budget <= 0) return;
    const r = await sendAnnounceBatch(feature, { limit: budget, pauseMs: DRIP.pauseMs });
    if (r.stoppedOnError && r.failedUserId) {
      await prisma.onboardingReminder.createMany({
        data: [{ userId: r.failedUserId, kind: pauseKind(feature.kind, dayKey), batchId: randomUUID() }],
        skipDuplicates: true,
      });
    }
    if (r.sent > 0 || r.failed > 0) {
      console.log(
        `[Feature-drip] "${DRIP.feature}": gửi ${r.sent}, lỗi ${r.failed}${r.stoppedOnError ? " — DỪNG tới mai (thường là Zoho chặn)" : ""}`
      );
    }
  } catch (err) {
    console.error("[Feature-drip] lỗi:", (err as Error).message);
  } finally {
    running = false;
  }
}
