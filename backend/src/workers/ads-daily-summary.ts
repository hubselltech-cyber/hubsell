// ============================================================
// TÓM TẮT CUỐI NGÀY CỦA TRỢ LÝ QUẢNG CÁO — đẩy qua chuông (bước 6, 14/09/2026)
//
// "Hôm nay Trợ lý đã làm gì với tiền quảng cáo của bạn": mỗi tối từ
// SEND_FROM_HOUR_VN, gom Sổ hành động TRONG NGÀY của mọi gian thuộc chủ shop
// (dừng thật / bật lại / diễn tập / sàn từ chối) thành MỘT thông báo, bấm vào
// mở trang Trợ lý quảng cáo. Ngày máy không làm gì → không gửi (không làm ồn).
//
// Idempotent theo ngày: đã có Notification type=ads-daily-summary tạo từ 00:00
// VN hôm nay thì thôi. Khuôn giống weekly-report.ts. Tắt: ADS_DAILY_SUMMARY_OFF=1.
// ============================================================
import { prisma } from "../lib/prisma";
import { notify } from "../services/notifications";
import { businessDayStart, BUSINESS_TZ_OFFSET_MS } from "../lib/date-range";
import { buildDailyDigest, formatDailyDigest } from "../integrations/shopee/ads-scorecard";

/** Giờ VN sớm nhất trong ngày được phép gửi — sau giờ ads hoạt động chính. */
const SEND_FROM_HOUR_VN = 20;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;

let started = false;
let running = false;

export function startAdsDailySummaryWorker(): void {
  if (started) return;
  started = true;
  if (process.env.ADS_DAILY_SUMMARY_OFF === "1") {
    console.log("[Ads-daily] TẮT (ADS_DAILY_SUMMARY_OFF=1)");
    return;
  }
  setTimeout(() => void runAdsDailySummary(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runAdsDailySummary(), CHECK_INTERVAL_MS).unref();
  console.log(`[Ads-daily] BẬT — từ ${SEND_FROM_HOUR_VN}h VN gửi tóm tắt hành động Trợ lý quảng cáo trong ngày`);
}

/** Một lượt quét. `force` bỏ điều kiện giờ (test tay) — idempotency theo ngày vẫn giữ. */
export async function runAdsDailySummary(force = false): Promise<{ sent: number }> {
  if (running) return { sent: 0 };
  running = true;
  let sent = 0;
  try {
    const now = new Date();
    const vn = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MS);
    if (!force && vn.getUTCHours() < SEND_FROM_HOUR_VN) return { sent: 0 };
    const dayStart = businessDayStart(now);

    // Chỉ chủ shop có hành động trong ngày — không quét mọi owner.
    const owners = await prisma.adsActionLog.findMany({
      where: { createdAt: { gte: dayStart } },
      distinct: ["channelId"],
      select: { channel: { select: { userId: true } } },
    });
    const ownerIds = [...new Set(owners.map((o) => o.channel.userId))];

    for (const ownerId of ownerIds) {
      try {
        const already = await prisma.notification.findFirst({
          where: { ownerId, type: "ads-daily-summary", createdAt: { gte: dayStart } },
          select: { id: true },
        });
        if (already) continue;

        const logs = await prisma.adsActionLog.findMany({
          where: { channel: { userId: ownerId }, createdAt: { gte: dayStart } },
          include: {
            adsCampaign: { select: { name: true } },
            channel: { select: { channelName: true } },
          },
        });
        const digest = buildDailyDigest(
          logs.map((l) => ({ ...l, campaignName: l.adsCampaign.name }))
        );
        const msg = formatDailyDigest(digest);
        if (!msg) continue;
        const onlyLazada = logs.every((l) => l.channel.channelName === "LAZADA");
        await notify(ownerId, {
          type: "ads-daily-summary",
          title: msg.title,
          body: msg.body,
          link: onlyLazada ? "/ads/lazada" : "/ads/shopee",
        });
        sent++;
      } catch (err) {
        console.error(`[Ads-daily] Lỗi owner ${ownerId}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[Ads-daily] Lỗi vòng quét:", err);
  } finally {
    running = false;
  }
  return { sent };
}
