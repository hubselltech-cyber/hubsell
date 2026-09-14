// ============================================================
// NHẮC GIA HẠN KỲ DỊCH VỤ LAZADA — chuông 14 / 7 / 1 ngày trước hạn (14/09/2026).
//
// App ISV Lazada (142085) cấp token sống theo "Ordering Cycle" = kỳ seller đăng
// ký gói Hubsell trên Lazada Service Marketplace (gói free VN, kỳ 6 tháng).
// Hết kỳ là token chết hẳn — refresh cũng không được — đơn ngừng đồng bộ cho
// tới khi seller đăng ký lại gói rồi ủy quyền lại. Sàn KHÔNG nhắc hộ, nên
// Hubsell phải nhắc trước.
//
// Hạn kỳ = mốc MUỘN nhất trong (accessTokenExpireAt, refreshTokenExpireAt):
// với app ISV cả hai đều = ngày hết kỳ (Lazada trả expires_in tới cuối kỳ —
// kiểm chứng gian DarkMan 14/09: hết 14/03/2027); lấy max để không tin nhầm
// fallback 30 ngày nếu một trường thiếu. Với app in-house (dev local) refresh
// token xoay mỗi 7 ngày nên hạn luôn ≥23 ngày → không bao giờ lọt cửa nhắc,
// trừ gian im lìm suốt tháng (khi đó nhắc là đúng).
//
// Quá hạn → đánh dấu DISCONNECTED (như cron token-refresh Shopee) để dải cảnh
// báo + trang Kênh bán hiện "Kết nối lại"; không xoá token.
//
// Idempotent theo (owner, type, title) trong 10 ngày như worker nhắc thuế; kiểm
// mỗi giờ, gửi từ 8h VN. Tắt bằng LAZADA_RENEWAL_REMINDER_OFF=1.
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { BUSINESS_TZ_OFFSET_MS } from "../lib/date-range";
import { notify } from "../services/notifications";

/** Các mốc nhắc trước hạn (ngày). */
export const REMIND_DAYS_BEFORE = [14, 7, 1] as const;
const SEND_FROM_HOUR_VN = 8;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
/** Cửa sổ chống trùng — rộng hơn khoảng cách hai mốc. */
const DEDUPE_WINDOW_MS = 10 * 86_400_000;
/** Chỉ lôi về gian có hạn trong cửa sổ này (mốc xa nhất + 1 ngày đệm). */
const LOOKAHEAD_MS = (REMIND_DAYS_BEFORE[0] + 1) * 86_400_000;

export const LAZADA_RENEWAL_TYPE = "lazada-renewal";

let started = false;
let running = false;

export function startLazadaRenewalReminderWorker(): void {
  if (started) return;
  started = true;
  if (process.env.LAZADA_RENEWAL_REMINDER_OFF === "1") {
    console.log("[Lazada-renewal] TẮT (LAZADA_RENEWAL_REMINDER_OFF=1)");
    return;
  }
  setTimeout(() => void runLazadaRenewalReminders(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runLazadaRenewalReminders(), CHECK_INTERVAL_MS).unref();
  console.log(
    `[Lazada-renewal] BẬT — nhắc gia hạn kỳ dịch vụ trước ${REMIND_DAYS_BEFORE.join("/")} ngày (từ ${SEND_FROM_HOUR_VN}h VN)`
  );
}

/** Hạn kỳ dịch vụ của một gian = mốc muộn nhất trong hai hạn token; null nếu chưa có. */
export function cycleEndOf(c: {
  accessTokenExpireAt: Date | null;
  refreshTokenExpireAt: Date | null;
}): Date | null {
  const a = c.accessTokenExpireAt?.getTime() ?? 0;
  const r = c.refreshTokenExpireAt?.getTime() ?? 0;
  const m = Math.max(a, r);
  return m > 0 ? new Date(m) : null;
}

/** Số NGÀY LỊCH (giờ VN) từ `now` tới `end` — cùng ngày = 0, ngày mai = 1, đã qua = âm. */
export function calendarDaysUntil(end: Date, now: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + BUSINESS_TZ_OFFSET_MS) / 86_400_000);
  return day(end) - day(now);
}

function formatVnDate(d: Date): string {
  const v = new Date(d.getTime() + BUSINESS_TZ_OFFSET_MS);
  const dd = String(v.getUTCDate()).padStart(2, "0");
  const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${v.getUTCFullYear()}`;
}

export interface RenewalReminder {
  daysLeft: number;
  type: string;
  title: string;
  body: string;
  link: string;
}

/**
 * Nội dung chuông cho một gian ở một mốc — hàm thuần để test. Trả null khi
 * hôm nay không phải ngày mốc. `daysLeft` < 0 (đã quá hạn) → bản "đã hết kỳ".
 */
export function buildRenewalReminder(
  shopName: string,
  cycleEnd: Date,
  now: Date
): RenewalReminder | null {
  const daysLeft = calendarDaysUntil(cycleEnd, now);
  const dateLabel = formatVnDate(cycleEnd);
  const howTo =
    "Cách gia hạn (miễn phí, ~2 phút): đăng nhập Lazada Seller Center của gian này, " +
    "mở lại link gói “Hubsell Miễn phí” và đăng ký kỳ mới, rồi vào Kênh bán bấm " +
    "Kết nối gian hàng → Lazada để ủy quyền lại.";
  if (daysLeft < 0) {
    return {
      daysLeft,
      type: LAZADA_RENEWAL_TYPE,
      title: `⛔ Gian “${shopName}” đã hết kỳ dịch vụ Lazada (${dateLabel}) — đơn ngừng đồng bộ`,
      body: `Token Lazada sống theo kỳ đăng ký gói Hubsell trên Service Marketplace và đã hết hạn. ${howTo}`,
      link: "/channels",
    };
  }
  if (!(REMIND_DAYS_BEFORE as readonly number[]).includes(daysLeft)) return null;
  const title =
    daysLeft === 1
      ? `⏰ Ngày mai ${dateLabel} gian “${shopName}” hết kỳ dịch vụ Lazada — gia hạn ngay`
      : `⏰ Còn ${daysLeft} ngày: gia hạn gói Hubsell trên Lazada cho gian “${shopName}” (hạn ${dateLabel})`;
  return {
    daysLeft,
    type: LAZADA_RENEWAL_TYPE,
    title,
    body: `Token Lazada sống theo kỳ đăng ký gói Hubsell trên Service Marketplace; quá ${dateLabel} là đơn ngừng đồng bộ cho tới khi ủy quyền lại. ${howTo}`,
    link: "/channels",
  };
}

/** Một lượt quét. `force` bỏ điều kiện giờ gửi (test tay), idempotency giữ nguyên. */
export async function runLazadaRenewalReminders(force = false, now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const vnHour = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS).getUTCHours();
    if (!force && vnHour < SEND_FROM_HOUR_VN) return;

    const horizon = new Date(now.getTime() + LOOKAHEAD_MS);
    // Lọc ngay trong query: chỉ gian Lazada nối thật, hạn nào đó trong cửa sổ
    // nhìn trước — hàng chục ngàn gian cũng chỉ lôi về vài dòng sắp tới hạn.
    const channels = await prisma.channel.findMany({
      where: {
        channelName: ChannelName.LAZADA,
        status: "ACTIVE",
        refreshToken: { not: null },
        externalShopId: { not: null },
        OR: [
          { accessTokenExpireAt: { lte: horizon } },
          { refreshTokenExpireAt: { lte: horizon } },
        ],
      },
      select: {
        id: true,
        userId: true,
        shopName: true,
        externalShopId: true,
        accessTokenExpireAt: true,
        refreshTokenExpireAt: true,
      },
    });
    if (channels.length === 0) return;

    // Mốc chống trùng so với GIỜ THẬT (createdAt do DB ghi), không theo `now`.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    let sent = 0;
    for (const c of channels) {
      try {
        const end = cycleEndOf(c);
        if (!end || end > horizon) continue; // trường kia còn xa → chưa tới lúc
        const reminder = buildRenewalReminder(c.shopName, end, now);
        if (!reminder) continue;

        if (reminder.daysLeft < 0) {
          // Quá hạn: token chết hẳn → DISCONNECTED để UI nhắc nối lại (không xoá token).
          await prisma.channel.update({
            where: { id: c.id },
            data: { status: "DISCONNECTED", disconnectedAt: now },
          });
          console.warn(
            `[Lazada-renewal] Gian "${c.shopName}" (seller ${c.externalShopId}) hết kỳ dịch vụ → DISCONNECTED, cần gia hạn + ủy quyền lại`
          );
        }

        const already = await prisma.notification.findFirst({
          where: { ownerId: c.userId, type: reminder.type, title: reminder.title, createdAt: { gte: since } },
          select: { id: true },
        });
        if (already) continue;
        await notify(c.userId, {
          type: reminder.type,
          title: reminder.title,
          body: reminder.body,
          link: reminder.link,
        });
        sent += 1;
      } catch (err) {
        console.error(`[Lazada-renewal] Lỗi gian ${c.id}:`, (err as Error).message);
      }
    }
    if (sent > 0) console.log(`[Lazada-renewal] Đã nhắc ${sent} gian`);
  } catch (err) {
    console.error("[Lazada-renewal] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
}
