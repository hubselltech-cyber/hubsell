// ============================================================
// SHOPEE — XUNG QUẢNG CÁO (tầng A, docs/ADS-NHIP-CANH-BAO.md) — 12/09/2026
//
// Mỗi ADS_CADENCE.PULSE_MIN cho gian đang tiêu tiền, 5 call (gian ≤100 campaign):
//   1. campaign_id_list          → bắt campaign MỚI TẠO (ca cắn tiền hay gặp)
//   2. campaign_setting_info     → trạng thái chạy/tạm dừng, ngân sách, ROAS mục
//                                  tiêu TƯƠI ≤30' (seller tạm dừng trên Seller
//                                  Center thì rule engine không báo nhầm nữa)
//   3. campaign_daily_performance start=end=HÔM NAY → dòng today của rule spike
//   4. all_cpc_ads_daily_performance HÔM NAY → AdSpend hôm nay (báo cáo dòng
//                                  tiền + detector ads-spike cũ cho gian ít campaign)
//   5. get_total_balance         → ví ads ghi DB (detector + trang Trợ lý đọc DB,
//                                  bỏ 2 call sống cũ)
//
// XUNG NHẸ (gian đã nối Ads API nhưng DB chưa có campaign nào chạy): chỉ call 1;
// thấy campaign mới → chạy luôn xung đủ ngay lượt này.
//
// Campaign "còn sống" = mọi trạng thái trừ ended/deleted/closed (paused vẫn
// phải theo dõi vì seller có thể bật lại). Lịch sử 7 ngày là việc của tầng B
// (syncShopeeAdsPerfWindow), không làm ở đây.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { resolveShopeeAdsAccess } from "../hubsell-ads";
import { getAdsTotalBalance } from "./client";
import {
  fetchShopeeCampaignRefs,
  upsertShopeeCampaignPerf,
  upsertShopeeCampaignSettings,
} from "./ads-campaigns";
import { syncShopeeAdsSpend } from "./ads-spend";

/** Trạng thái campaign không cần theo dõi nữa. */
export const ADS_DEAD_STATUSES = ["ended", "deleted", "closed"];

export interface ShopeeAdsPulseResult {
  /** Xung nhẹ (chỉ 1 call) hay xung đủ. */
  mode: "light" | "full";
  campaignsFound: number;
  newCampaigns: number;
  liveCampaigns: number;
  perfTodayUpserted: number;
  walletBalance: number | null;
}

export async function pulseShopeeAds(
  channel: Channel,
  opts: { light?: boolean } = {}
): Promise<ShopeeAdsPulseResult> {
  const access = await resolveShopeeAdsAccess(channel);

  // 1. Toàn bộ id trên sàn (1 call/100) — so với DB để biết campaign mới.
  const idToAdType = await fetchShopeeCampaignRefs(access);
  const known = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id },
    select: { id: true, campaignId: true, status: true },
  });
  const knownById = new Map(known.map((r) => [r.campaignId, r] as const));
  const newIds = [...idToAdType.keys()].filter((id) => !knownById.has(id));

  const result: ShopeeAdsPulseResult = {
    mode: opts.light && newIds.length === 0 ? "light" : "full",
    campaignsFound: idToAdType.size,
    newCampaigns: newIds.length,
    liveCampaigns: 0,
    perfTodayUpserted: 0,
    walletBalance: null,
  };
  // Xung nhẹ và không có gì mới → xong (1 call). Có campaign mới → xung đủ ngay.
  if (result.mode === "light") return result;

  // 2. Cấu hình cho campaign còn sống trong DB + campaign mới (1 call/100).
  const liveIds = [
    ...newIds,
    ...known.filter((r) => !ADS_DEAD_STATUSES.includes(r.status)).map((r) => r.campaignId),
  ].filter((id) => idToAdType.has(id));
  const rowIdByCampaignId = await upsertShopeeCampaignSettings(
    channel,
    access,
    idToAdType,
    liveIds
  );
  result.liveCampaigns = rowIdByCampaignId.size;

  // 3. Hiệu suất HÔM NAY của các campaign đó (1 call/100).
  if (rowIdByCampaignId.size > 0) {
    const now = new Date();
    result.perfTodayUpserted = await upsertShopeeCampaignPerf(access, rowIdByCampaignId, now, now);
  }

  // 4. Chi tiêu cấp shop hôm nay (1 call).
  await syncShopeeAdsSpend(channel, { daysBack: 1 });

  // 5. Ví ads → DB (1 call). Lỗi quyền ví không được chặn 4 bước trên.
  try {
    const bal = await getAdsTotalBalance(
      { accessToken: access.accessToken, shopId: access.shopId },
      access.cfg
    );
    const balance = Number(bal.response?.total_balance);
    if (Number.isFinite(balance)) {
      result.walletBalance = balance;
      await prisma.channel.update({
        where: { id: channel.id },
        data: { adsWalletBalance: balance, adsWalletSyncedAt: new Date() },
      });
    }
  } catch (err) {
    console.warn(
      `[Ads-pulse] Ví ads Shopee "${channel.shopName}" không đọc được:`,
      (err as Error).message
    );
  }
  return result;
}
