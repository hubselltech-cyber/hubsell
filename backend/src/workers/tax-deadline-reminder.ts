// ============================================================
// NHẮC HẠN KÊ KHAI THUẾ — chuông thông báo 7 ngày và 1 ngày trước hạn (07/09).
//
// Hộ kinh doanh bán sàn từ 2026 phải nộp tờ khai QUÝ (01/CNKD), doanh
// nghiệp nộp 01/GTGT — cùng hạn: ngày cuối tháng đầu quý sau. Quên là phạt
// 2–25 triệu (NĐ 310/2025). Worker này chỉ NHẮC + dẫn tới khối "Số liệu kê
// khai kỳ" để lấy số; việc nộp là của seller trên eTax (Hubsell không phải
// T-VAN, không nộp thay — anh Trung chốt 07/09).
//
// Nhận chuông: chủ shop có ít nhất một đơn trong kỳ vừa hết (không làm phiền
// tài khoản trống). Mỗi mốc (7 ngày / 1 ngày) một bản, idempotent theo
// (owner, type, title) trong 10 ngày — quét lại/restart không bắn trùng.
// Quý 4 nhắc luôn hạn thông báo doanh thu năm (cùng 31/01).
//
// Kiểm mỗi 30' nhưng chỉ gửi trong ngày đúng mốc, từ 8h VN. Tắt bằng env
// TAX_DEADLINE_REMINDER_OFF=1.
// ============================================================

import { prisma } from "../lib/prisma";
import { BUSINESS_TZ_OFFSET_MS } from "../lib/date-range";
import { notify } from "../services/notifications";
import {
  daysUntil,
  filingDeadline,
  ownersWithOrdersIn,
  periodKey,
  periodLabel,
  periodRange,
  previousQuarter,
} from "../services/tax-declaration";

/** Các mốc nhắc trước hạn (ngày). */
const REMIND_DAYS_BEFORE = [7, 1] as const;
const SEND_FROM_HOUR_VN = 8;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;
/** Cửa sổ chống trùng — rộng hơn khoảng cách hai mốc. */
const DEDUPE_WINDOW_MS = 10 * 86_400_000;

let started = false;
let running = false;

export function startTaxDeadlineReminderWorker(): void {
  if (started) return;
  started = true;
  if (process.env.TAX_DEADLINE_REMINDER_OFF === "1") {
    console.log("[Tax-deadline] TẮT (TAX_DEADLINE_REMINDER_OFF=1)");
    return;
  }
  setTimeout(() => void runTaxDeadlineReminders(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runTaxDeadlineReminders(), CHECK_INTERVAL_MS).unref();
  console.log(
    `[Tax-deadline] BẬT — nhắc hạn kê khai quý trước ${REMIND_DAYS_BEFORE.join("/")} ngày (từ ${SEND_FROM_HOUR_VN}h VN)`
  );
}

/** Nội dung chuông cho một mốc — hàm thuần để test. */
export function buildReminder(now: Date): {
  daysLeft: number;
  type: string;
  title: string;
  body: string;
  link: string;
  range: ReturnType<typeof periodRange>;
} | null {
  const period = previousQuarter(now);
  const deadline = filingDeadline(period);
  const daysLeft = daysUntil(deadline.date, now);
  if (!(REMIND_DAYS_BEFORE as readonly number[]).includes(daysLeft)) return null;
  const label = periodLabel(period);
  const isQ4 = period.quarter === 4;
  const title =
    daysLeft === 1
      ? `⏰ Ngày mai ${deadline.label} là hạn nộp tờ khai thuế ${label}`
      : `⏰ Còn ${daysLeft} ngày đến hạn kê khai thuế ${label} (${deadline.label})`;
  const body = [
    `Hộ kinh doanh nộp tờ khai 01/CNKD, doanh nghiệp nộp 01/GTGT trên eTax trước ${deadline.label}.`,
    isQ4 ? `Cùng ngày là hạn thông báo doanh thu năm ${period.year} (mẫu 01/TKN-CNKD) cho hộ dưới 1 tỷ.` : null,
    "Bấm để lấy doanh thu tính thuế và số sàn đã khấu trừ theo từng sàn — không phải tải báo cáo từng Seller Center nữa.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    daysLeft,
    type: "tax-deadline",
    title,
    body,
    link: `/invoicing/history?period=${periodKey(period)}`,
    range: periodRange(period),
  };
}

/** Một lượt quét. `force` bỏ điều kiện giờ gửi (test tay), idempotency giữ nguyên. */
export async function runTaxDeadlineReminders(force = false, now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const vnHour = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS).getUTCHours();
    if (!force && vnHour < SEND_FROM_HOUR_VN) return;
    const reminder = buildReminder(now);
    if (!reminder) return;

    const owners = await ownersWithOrdersIn(reminder.range);
    // Mốc chống trùng so với GIỜ THẬT (createdAt do DB ghi), không theo `now`
    // — test tay với ngày giả lập từng lọt qua kiểm này (07/09).
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    let sent = 0;
    for (const ownerId of owners) {
      try {
        const already = await prisma.notification.findFirst({
          where: { ownerId, type: reminder.type, title: reminder.title, createdAt: { gte: since } },
          select: { id: true },
        });
        if (already) continue;
        await notify(ownerId, {
          type: reminder.type,
          title: reminder.title,
          body: reminder.body,
          link: reminder.link,
        });
        sent += 1;
      } catch (err) {
        console.error(`[Tax-deadline] Lỗi nhắc owner ${ownerId}:`, (err as Error).message);
      }
    }
    if (sent > 0) console.log(`[Tax-deadline] Đã nhắc ${sent} shop (còn ${reminder.daysLeft} ngày)`);
  } catch (err) {
    console.error("[Tax-deadline] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
