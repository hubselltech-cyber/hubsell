// ============================================================
// NHẮC HẠN GÓI HUBSELL — thư billing@ + chuông, 7 ngày và 1 ngày trước hạn
// (anh Trung duyệt bảng thư 19/09/2026; hai mốc 7 / 1 dùng lại đúng nhịp của
// worker nhắc hạn kê khai thuế anh đã chốt 07/09 — là mặc định của Hubsell,
// không phải con số của bên thứ ba).
//
// Áp cho cả kỳ DÙNG THỬ (thư nói "kỳ dùng thử") lẫn gói trả tiền. Ngày tính
// theo lịch Việt Nam: "còn 7 ngày" = currentPeriodEnd rơi vào ngày thứ 7 kể
// từ hôm nay. Gia hạn xong currentPeriodEnd đổi → kỳ mới được nhắc lại từ đầu.
//
// Cùng lượt: khách hết hạn HÔM QUA mà chưa gia hạn → MỘT thư tổng hợp báo HQ
// (không bắn từng khách — đông khách là loạn hộp thư).
//
// QUY MÔ: không quét cả bảng — mỗi mốc là một truy vấn khoảng ngày trên index
// currentPeriodEnd, đọc theo trang. CHỐNG TRÙNG bằng vé subscription_reminders
// (unique thuê bao + mốc + kỳ hạn): chèn cả lô skipDuplicates kèm batchId của
// lượt này rồi đọc lại theo batchId — hai tiến trình worker chạy song song
// không gửi đôi. Gửi hỏng thì xóa vé, lượt sau (30') thử lại. Gửi song song có
// trần để không dội SMTP.
//
// Chưa cấu hình SMTP → không làm gì (không giành vé oan). Kiểm mỗi 30', chỉ
// gửi từ 8h VN. Tắt bằng env SUBSCRIPTION_REMINDER_OFF=1.
// ============================================================

import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { BUSINESS_TZ_OFFSET_MS, businessDayStart } from "../lib/date-range";
import { isMailerConfigured } from "../lib/mailer";
import { notify } from "../services/notifications";
import { mailHq } from "../services/hq-mail";
import {
  escapeHtml,
  renewalReminderSubject,
  sendRenewalReminderMail,
  vnDateLabel,
} from "../services/customer-mails";

const DAY_MS = 86_400_000;
/** Các mốc nhắc trước hạn (ngày) — xem chú thích đầu file về căn cứ. */
export const RENEWAL_MARKS = [
  { kind: "renew-7", daysLeft: 7 },
  { kind: "renew-1", daysLeft: 1 },
] as const;
const EXPIRED_HQ_KIND = "expired-hq";

const SEND_FROM_HOUR_VN = 8;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 4 * 60 * 1000;
const PAGE_SIZE = 500;
const SEND_CONCURRENCY = 5;
/** Bản tổng hợp HQ liệt kê tối đa từng này khách, phần còn lại chỉ nêu số. */
const HQ_DIGEST_MAX_ROWS = 50;

const FRONTEND_URL = (process.env.APP_FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");

let started = false;
let running = false;

export function startSubscriptionReminderWorker(): void {
  if (started) return;
  started = true;
  if (process.env.SUBSCRIPTION_REMINDER_OFF === "1") {
    console.log("[Sub-reminder] TẮT (SUBSCRIPTION_REMINDER_OFF=1)");
    return;
  }
  setTimeout(() => void runSubscriptionReminders(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runSubscriptionReminders(), CHECK_INTERVAL_MS).unref();
  console.log(
    `[Sub-reminder] BẬT — nhắc hạn gói trước ${RENEWAL_MARKS.map((m) => m.daysLeft).join("/")} ngày (từ ${SEND_FROM_HOUR_VN}h VN)`
  );
}

/**
 * Khoảng [from, to) của ngày lịch VN cách hôm nay `offsetDays` ngày — hàm
 * thuần để test. offsetDays = 7 → "hết hạn vào ngày thứ 7 kể từ hôm nay".
 */
export function vnDayWindow(now: Date, offsetDays: number): { from: Date; to: Date } {
  const from = new Date(businessDayStart(now).getTime() + offsetDays * DAY_MS);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

interface Candidate {
  id: string;
  userId: string;
  isTrial: boolean;
  currentPeriodEnd: Date;
  planName: string;
  email: string;
  fullName: string;
}

/** Đọc theo trang các thuê bao còn hiệu lực có hạn rơi trong khoảng. */
async function* candidatesIn(window: { from: Date; to: Date }): AsyncGenerator<Candidate[]> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        currentPeriodEnd: { gte: window.from, lt: window.to },
        user: { email: { not: null }, isPlatformAdmin: false },
      },
      select: {
        id: true,
        userId: true,
        isTrial: true,
        currentPeriodEnd: true,
        plan: { select: { name: true } },
        user: { select: { email: true, fullName: true } },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return;
    yield rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      isTrial: r.isTrial,
      currentPeriodEnd: r.currentPeriodEnd!,
      planName: r.plan.name,
      email: r.user.email!,
      fullName: r.user.fullName,
    }));
    if (rows.length < PAGE_SIZE) return;
    cursor = rows[rows.length - 1].id;
  }
}

/** Giành vé cho cả trang — trả về những thuê bao mà LƯỢT NÀY giành được. */
async function claim(page: Candidate[], kind: string): Promise<Candidate[]> {
  const batchId = randomUUID();
  await prisma.subscriptionReminder.createMany({
    data: page.map((c) => ({
      subscriptionId: c.id,
      kind,
      periodEnd: c.currentPeriodEnd,
      batchId,
    })),
    skipDuplicates: true,
  });
  const mine = await prisma.subscriptionReminder.findMany({
    where: { batchId },
    select: { subscriptionId: true },
  });
  const won = new Set(mine.map((m) => m.subscriptionId));
  return page.filter((c) => won.has(c.id));
}

async function releaseTicket(c: Candidate, kind: string): Promise<void> {
  await prisma.subscriptionReminder
    .deleteMany({ where: { subscriptionId: c.id, kind, periodEnd: c.currentPeriodEnd } })
    .catch(() => undefined);
}

/** Chạy `fn` trên cả mảng, tối đa `limit` việc cùng lúc. */
async function mapLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

async function remindMark(now: Date, mark: (typeof RENEWAL_MARKS)[number]): Promise<number> {
  let sent = 0;
  for await (const page of candidatesIn(vnDayWindow(now, mark.daysLeft))) {
    const won = await claim(page, mark.kind);
    await mapLimited(won, SEND_CONCURRENCY, async (c) => {
      const input = {
        fullName: c.fullName,
        planName: c.planName,
        daysLeft: mark.daysLeft,
        periodEnd: c.currentPeriodEnd,
        isTrial: c.isTrial,
      };
      const ok = await sendRenewalReminderMail(c.email, input);
      if (!ok) {
        await releaseTicket(c, mark.kind);
        return;
      }
      sent += 1;
      void notify(c.userId, {
        type: "subscription",
        title: renewalReminderSubject(input).replace(/^Hubsell — /, "⏰ "),
        body: c.isTrial
          ? "Chọn gói trước ngày này để đồng bộ đơn, tồn kho và báo cáo không bị gián đoạn."
          : "Gia hạn sớm không mất ngày: kỳ mới nối tiếp từ cuối kỳ hiện tại.",
        link: "/settings/plan",
      });
    });
  }
  return sent;
}

/** Khách hết hạn HÔM QUA chưa gia hạn → một thư tổng hợp cho HQ. */
async function digestExpiredForHq(now: Date): Promise<number> {
  const expired: Candidate[] = [];
  for await (const page of candidatesIn(vnDayWindow(now, -1))) {
    expired.push(...(await claim(page, EXPIRED_HQ_KIND)));
  }
  if (expired.length === 0) return 0;
  const rows = expired
    .slice(0, HQ_DIGEST_MAX_ROWS)
    .map(
      (c) =>
        `<li>${escapeHtml(c.fullName)} (${escapeHtml(c.email)}) — ${escapeHtml(c.planName)}${c.isTrial ? " · dùng thử" : ""}, hết hạn ${vnDateLabel(c.currentPeriodEnd)}</li>`
    )
    .join("");
  const more =
    expired.length > HQ_DIGEST_MAX_ROWS
      ? `<p>… và ${expired.length - HQ_DIGEST_MAX_ROWS} khách nữa.</p>`
      : "";
  await mailHq({
    subject: `[Hubsell] ${expired.length} khách hết hạn gói hôm qua chưa gia hạn`,
    html: `<p>Các tài khoản dưới đây hết hạn hôm qua và chưa gia hạn — nên gọi chăm sóc:</p><ul style="padding-left:18px">${rows}</ul>${more}<p><a href="${FRONTEND_URL}/admin/plans">Mở trang Gói ở HQ</a></p>`,
  });
  return expired.length;
}

/** Một lượt quét. `force` bỏ điều kiện giờ gửi (test tay); chống trùng giữ nguyên. */
export async function runSubscriptionReminders(force = false, now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!isMailerConfigured()) return;
    const vnHour = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS).getUTCHours();
    if (!force && vnHour < SEND_FROM_HOUR_VN) return;

    for (const mark of RENEWAL_MARKS) {
      const sent = await remindMark(now, mark);
      if (sent > 0) console.log(`[Sub-reminder] Đã nhắc ${sent} khách (còn ${mark.daysLeft} ngày)`);
    }
    const expired = await digestExpiredForHq(now);
    if (expired > 0) console.log(`[Sub-reminder] Báo HQ ${expired} khách hết hạn hôm qua`);
  } catch (err) {
    console.error("[Sub-reminder] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
