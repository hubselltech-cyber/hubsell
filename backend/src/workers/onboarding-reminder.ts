// ============================================================
// NHẮC KHÁCH MỚI CHƯA NỐI GIAN — thư noreply@ sau 1 ngày đăng ký
// (anh Trung 09/10/2026: khách đăng ký bằng email không có SĐT nên không gọi
// được; nhóm "đăng ký xong không nối gian" là chỗ rụng lớn nhất của phễu).
//
// Ai được nhắc: CHỦ SHOP (ownerId null) có email, không phải quản trị nền
// tảng, chưa tự xóa tài khoản, đăng ký cách đây 24–48 giờ, và CHƯA có gian
// hàng nào (kể cả gian đã ngắt / gian OFFLINE — đã từng nối là thôi nhắc).
// Mốc "1 ngày" = đúng 24 giờ sau lúc đăng ký (quét mỗi 30' nên lệch tối đa
// 30'); đăng ký ban đêm thì đợi tới 8h VN mới gửi — vẫn nằm trong cửa sổ 48h.
// Mốc 1 ngày là mặc định Hubsell anh chốt 09/10, không phải số của bên thứ ba;
// muốn thêm mốc 3 / 7 ngày chỉ cần thêm dòng trong CONNECT_MARKS.
//
// QUY MÔ: truy vấn khoảng ngày trên chỉ mục User.createdAt, đọc theo trang.
// CHỐNG TRÙNG bằng vé onboarding_reminders (unique chủ shop + mốc): chèn cả
// lô skipDuplicates kèm batchId rồi đọc lại theo batchId — hai tiến trình
// worker song song không gửi đôi. Gửi hỏng xóa vé, lượt sau thử lại.
//
// Chưa cấu hình SMTP → không làm gì (không giành vé oan). Tắt bằng env
// ONBOARDING_REMINDER_OFF=1.
// ============================================================

import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { BUSINESS_TZ_OFFSET_MS } from "../lib/date-range";
import { isMailerConfigured } from "../lib/mailer";
import { sendConnectReminderMail } from "../services/customer-mails";

const HOUR_MS = 3_600_000;
/** Các mốc nhắc sau đăng ký (giờ) — xem chú thích đầu file về căn cứ. */
export const CONNECT_MARKS = [{ kind: "connect-1", hoursAfter: 24 }] as const;
/** Quá mốc này mà vẫn chưa gửi (worker nằm, SMTP hỏng dài) thì thôi — nhắc muộn quá thành spam. */
const WINDOW_HOURS = 24;

const SEND_FROM_HOUR_VN = 8;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const PAGE_SIZE = 500;
const SEND_CONCURRENCY = 5;

let started = false;
let running = false;

export function startOnboardingReminderWorker(): void {
  if (started) return;
  started = true;
  if (process.env.ONBOARDING_REMINDER_OFF === "1") {
    console.log("[Onboarding-reminder] TẮT (ONBOARDING_REMINDER_OFF=1)");
    return;
  }
  setTimeout(() => void runOnboardingReminders(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runOnboardingReminders(), CHECK_INTERVAL_MS).unref();
  console.log(
    `[Onboarding-reminder] BẬT — nhắc nối gian sau ${CONNECT_MARKS.map((m) => m.hoursAfter).join("/")} giờ (từ ${SEND_FROM_HOUR_VN}h VN)`
  );
}

/**
 * Khoảng createdAt [from, to) của khách "đăng ký cách đây hoursAfter giờ":
 * từ (hoursAfter + WINDOW_HOURS) giờ trước tới hoursAfter giờ trước — hàm
 * thuần để test.
 */
export function signupWindow(now: Date, hoursAfter: number): { from: Date; to: Date } {
  const to = new Date(now.getTime() - hoursAfter * HOUR_MS);
  return { from: new Date(to.getTime() - WINDOW_HOURS * HOUR_MS), to };
}

interface Candidate {
  id: string;
  email: string;
  fullName: string;
}

/** Đọc theo trang chủ shop đăng ký trong khoảng mà chưa có gian nào. */
async function* candidatesIn(window: { from: Date; to: Date }): AsyncGenerator<Candidate[]> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.user.findMany({
      where: {
        ownerId: null,
        email: { not: null },
        isPlatformAdmin: false,
        deletedAt: null,
        createdAt: { gte: window.from, lt: window.to },
        channels: { none: {} },
      },
      select: { id: true, email: true, fullName: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return;
    yield rows.map((r) => ({ id: r.id, email: r.email!, fullName: r.fullName }));
    if (rows.length < PAGE_SIZE) return;
    cursor = rows[rows.length - 1].id;
  }
}

/** Giành vé cho cả trang — trả về những khách mà LƯỢT NÀY giành được. */
async function claim(page: Candidate[], kind: string): Promise<Candidate[]> {
  const batchId = randomUUID();
  await prisma.onboardingReminder.createMany({
    data: page.map((c) => ({ userId: c.id, kind, batchId })),
    skipDuplicates: true,
  });
  const mine = await prisma.onboardingReminder.findMany({ where: { batchId }, select: { userId: true } });
  const won = new Set(mine.map((m) => m.userId));
  return page.filter((c) => won.has(c.id));
}

async function releaseTicket(c: Candidate, kind: string): Promise<void> {
  await prisma.onboardingReminder.deleteMany({ where: { userId: c.id, kind } }).catch(() => undefined);
}

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

async function remindMark(now: Date, mark: (typeof CONNECT_MARKS)[number]): Promise<number> {
  let sent = 0;
  for await (const page of candidatesIn(signupWindow(now, mark.hoursAfter))) {
    const won = await claim(page, mark.kind);
    await mapLimited(won, SEND_CONCURRENCY, async (c) => {
      const ok = await sendConnectReminderMail(c.email, { fullName: c.fullName });
      if (!ok) {
        await releaseTicket(c, mark.kind);
        return;
      }
      sent += 1;
    });
  }
  return sent;
}

/** Một lượt quét. `force` bỏ điều kiện giờ gửi (test tay); chống trùng giữ nguyên. */
export async function runOnboardingReminders(force = false, now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!isMailerConfigured()) return;
    const vnHour = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS).getUTCHours();
    if (!force && vnHour < SEND_FROM_HOUR_VN) return;

    for (const mark of CONNECT_MARKS) {
      const sent = await remindMark(now, mark);
      if (sent > 0) console.log(`[Onboarding-reminder] Đã nhắc ${sent} khách chưa nối gian (${mark.kind})`);
    }
  } catch (err) {
    console.error("[Onboarding-reminder] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
