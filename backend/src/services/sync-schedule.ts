// ============================================================
// LỊCH SYNC THEO GIAN — điểm chạm dùng chung cho route/oauth (12/09/2026)
//
// Worker workers/order-auto-sync.ts là nơi DUY NHẤT chạy sync theo lịch; các
// nơi khác chỉ "nudge" hạn kế tiếp về NGAY để worker nhặt trong ≤1 nhịp (20s),
// không tự gọi API sàn trong request (tách vai web/worker, chống gọi trùng).
// ============================================================

import { prisma } from "../lib/prisma";

/** Cửa sổ kéo ads mỗi lượt thường (ngày) — sàn còn chỉnh số vài ngày đầu. */
export const ADS_SYNC_DAYS_BACK = 7;
/** Cửa sổ kéo ads lần đầu / vừa nối Hubsell Ads (ngày). */
export const ADS_BACKFILL_DAYS = 30;
/** Mở trang Trợ lý quảng cáo mà số ads cũ hơn ngưỡng này → nudge worker kéo tươi. */
export const ADS_STALE_MS = 30 * 60 * 1000;

/**
 * Gian vừa nối (lại) Hubsell Ads: lượt ads kế tiếp kéo lùi 30 ngày, và đến
 * hạn ngay. Best-effort — không ném lỗi ra luồng OAuth.
 */
export async function markAdsBackfill(channelId: string): Promise<void> {
  await prisma.channel
    .update({
      where: { id: channelId },
      data: { adsBackfillPending: true, nextAdsSyncAt: new Date() },
    })
    .catch(() => {});
}

/**
 * Trang Trợ lý quảng cáo mở: số ads cũ quá ngưỡng thì kéo hạn ads về ngay.
 * Trả true khi worker SẼ (hoặc đang) kéo — FE dựa vào đó tự nạp lại sau vài
 * chục giây. Không ném lỗi (chỉ là tiện ích làm tươi).
 */
export async function nudgeAdsSyncIfStale(channelId: string, now = Date.now()): Promise<boolean> {
  try {
    const ch = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { lastAdsSyncAt: true, nextAdsSyncAt: true, syncLockedAt: true },
    });
    if (!ch) return false;
    const fresh = ch.lastAdsSyncAt && now - ch.lastAdsSyncAt.getTime() < ADS_STALE_MS;
    if (fresh) return false;
    // Đã đến hạn / đang có worker cầm gian → không cần đụng, chỉ báo FE chờ.
    if (!ch.nextAdsSyncAt || ch.nextAdsSyncAt.getTime() <= now) return true;
    await prisma.channel.update({
      where: { id: channelId },
      data: { nextAdsSyncAt: new Date(now) },
    });
    return true;
  } catch {
    return false;
  }
}
