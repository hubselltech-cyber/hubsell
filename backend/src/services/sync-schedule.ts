// ============================================================
// LỊCH SYNC THEO GIAN — điểm chạm dùng chung cho route/oauth (12/09/2026)
//
// Worker workers/order-auto-sync.ts là nơi DUY NHẤT chạy sync theo lịch; các
// nơi khác chỉ "nudge" hạn kế tiếp về NGAY để worker nhặt trong ≤1 nhịp (20s),
// không tự gọi API sàn trong request (tách vai web/worker, chống gọi trùng).
//
// Từ tối 12/09 (docs/ADS-NHIP-CANH-BAO.md): nudge / Làm mới kích XUNG
// (nextAdsPulseAt — cấu hình + số hôm nay + ví), không kích tầng lịch sử.
// Nhịp lấy từ config/ads-cadence.ts.
// ============================================================

import { prisma } from "../lib/prisma";
import { ADS_CADENCE } from "../config/ads-cadence";

/** Cửa sổ kéo lại mỗi lượt lịch sử (ngày). */
export const ADS_SYNC_DAYS_BACK = ADS_CADENCE.WINDOW_DAYS;
/** Cửa sổ lần đầu / vừa nối Hubsell Ads (ngày). */
export const ADS_BACKFILL_DAYS = ADS_CADENCE.BACKFILL_DAYS;
/** Mở trang Trợ lý mà số ads cũ hơn ngưỡng này → nudge xung. */
export const ADS_STALE_MS = ADS_CADENCE.STALE_NUDGE_MIN * 60 * 1000;
/** Hai lần bấm Làm mới cách nhau dưới ngưỡng này → không kéo lại (chống spam quota). */
export const ADS_REFRESH_MIN_GAP_MS = ADS_CADENCE.REFRESH_GAP_MIN * 60 * 1000;

/**
 * Gian vừa nối (lại) Hubsell Ads: lượt lịch sử kế tiếp kéo lùi 30 ngày và
 * đến hạn ngay, xung cũng đến hạn ngay. Best-effort — không ném lỗi ra OAuth.
 */
export async function markAdsBackfill(channelId: string): Promise<void> {
  await prisma.channel
    .update({
      where: { id: channelId },
      data: { adsBackfillPending: true, nextAdsSyncAt: new Date(), nextAdsPulseAt: new Date() },
    })
    .catch(() => {});
}

/**
 * Trang Trợ lý quảng cáo mở: số ads cũ quá ngưỡng thì kéo hạn XUNG về ngay.
 * Trả true khi worker SẼ (hoặc đang) kéo — FE dựa vào đó tự nạp lại sau vài
 * chục giây. Không ném lỗi (chỉ là tiện ích làm tươi).
 */
export async function nudgeAdsSyncIfStale(channelId: string, now = Date.now()): Promise<boolean> {
  try {
    const ch = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { lastAdsSyncAt: true, nextAdsPulseAt: true },
    });
    if (!ch) return false;
    const fresh = ch.lastAdsSyncAt && now - ch.lastAdsSyncAt.getTime() < ADS_STALE_MS;
    if (fresh) return false;
    // Đã đến hạn / đang có worker cầm gian → không cần đụng, chỉ báo FE chờ.
    if (!ch.nextAdsPulseAt || ch.nextAdsPulseAt.getTime() <= now) return true;
    await prisma.channel.update({
      where: { id: channelId },
      data: { nextAdsPulseAt: new Date(now) },
    });
    return true;
  } catch {
    return false;
  }
}

export interface AdsRefreshResult {
  /** true = đã kéo hạn xung về ngay, worker chạy trong ≤1 nhịp (20s) + thời gian kéo. */
  queued: boolean;
  /** Mốc số ads hiện có (FE so sánh để biết lượt mới đã xong). */
  adsSyncedAt: string | null;
  message: string;
}

/**
 * Seller bấm "Làm mới" trên trang Trợ lý quảng cáo: kéo hạn XUNG về ngay để
 * worker chạy (không gọi API sàn trong request). Chống spam: số vừa cập nhật
 * <2' thì trả queued=false kèm mốc, FE hiện "vừa cập nhật".
 */
export async function requestAdsRefresh(channelId: string, now = Date.now()): Promise<AdsRefreshResult> {
  const ch = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { lastAdsSyncAt: true, nextAdsPulseAt: true },
  });
  if (!ch) return { queued: false, adsSyncedAt: null, message: "Không tìm thấy gian" };
  const adsSyncedAt = ch.lastAdsSyncAt?.toISOString() ?? null;
  if (ch.lastAdsSyncAt && now - ch.lastAdsSyncAt.getTime() < ADS_REFRESH_MIN_GAP_MS) {
    return { queued: false, adsSyncedAt, message: "Số quảng cáo vừa được cập nhật, thử lại sau ít phút" };
  }
  // Đã đến hạn (worker sắp/đang kéo) thì không cần ghi thêm.
  if (!ch.nextAdsPulseAt || ch.nextAdsPulseAt.getTime() > now) {
    await prisma.channel.update({ where: { id: channelId }, data: { nextAdsPulseAt: new Date(now) } });
  }
  return { queued: true, adsSyncedAt, message: "Đang kéo số mới từ sàn, bảng sẽ tự cập nhật trong khoảng một phút" };
}
