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
import { getAdsShopToggleInfo, getAdsTotalBalance } from "./client";
import {
  fetchShopeeCampaignRefs,
  upsertShopeeCampaignPerf,
  upsertShopeeCampaignSettings,
} from "./ads-campaigns";
import { liveShopeeGroupCampaigns } from "./ads-group-campaigns";
import { syncShopeeAdsSpend } from "./ads-spend";
import { syncShopeeGms } from "./ads-gms";
import { vnDayWindow } from "../../lib/ads-dates";
import { isApiBudgetError } from "../../services/api-budget";

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

  // 3. Hiệu suất HÔM NAY (ngày sàn, giờ VN) của các campaign đó (1 call/100). Xung chỉ kéo
  // đúng hôm nay; số hôm qua sàn chỉnh muộn là việc của tầng lịch sử 6 giờ.
  // 3b. Chiến dịch Nhóm nhiều SP (mục 15.7): id không có trong id_list nên bước 1–2 bỏ qua; dòng Nhóm còn
  // sống trong DB vẫn kéo số hôm nay — mỗi id một call riêng (splitPerfBatches), không chạm setting_info.
  const groupRows = await liveShopeeGroupCampaigns(channel.id);
  for (const [cid, rowId] of groupRows) rowIdByCampaignId.set(cid, rowId);
  if (rowIdByCampaignId.size > 0) {
    result.perfTodayUpserted = await upsertShopeeCampaignPerf(access, rowIdByCampaignId, vnDayWindow(1), {
      groupIds: new Set(groupRows.keys()),
    });
  }

  // 4. Chi tiêu cấp shop hôm nay — cùng ngày sàn với bước 3 (1 call).
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
    // ★ 16/10/2026: gian đã bị sàn chặn (429 tầng shop) thì DỪNG xung ngay — gọi
    // tiếp các bước sau chỉ thêm 429 từ cùng một gian (từng làm cầu dao đóng cả app).
    if (isApiBudgetError(err)) throw err;
    console.warn(
      `[Ads-pulse] Ví ads Shopee "${channel.shopName}" không đọc được:`,
      (err as Error).message
    );
  }

  // 7. GMS — gian CHƯA hỏi sàn lần nào (adsGmsStatus null, vd vừa deploy / vừa nối) thì hỏi ngay ở
  // xung (1 call eligibility; chỉ khi đang chạy GMS mới thêm 3–4 call) để tab GMV Max có trạng thái
  // trong 30' thay vì đợi lượt lịch sử 6h (anh Trung 24/09 "chưa thấy GMS ở đâu"). Lỗi không chặn gì.
  if (channel.adsGmsStatus == null) {
    try {
      await syncShopeeGms(channel, access);
    } catch (err) {
      if (isApiBudgetError(err)) throw err;
      console.warn(`[Ads-pulse] GMS lần đầu "${channel.shopName}" không đọc được:`, (err as Error).message);
    }
  }

  // 6. ĐỢT B — cờ ví TỰ NẠP (1 call): ví cạn mà không tự nạp → cảnh báo cao; đã
  // bật tự nạp → hạ mức (cắt cảnh báo ví cạn giả). Lỗi không chặn gì.
  try {
    const tg = await getAdsShopToggleInfo(
      { accessToken: access.accessToken, shopId: access.shopId },
      access.cfg
    );
    const autoTopUp = tg.response?.auto_top_up;
    if (typeof autoTopUp === "boolean") {
      await prisma.channel.update({
        where: { id: channel.id },
        data: { adsAutoTopUp: autoTopUp },
      });
    }
  } catch (err) {
    if (isApiBudgetError(err)) throw err;
    console.warn(
      `[Ads-pulse] Cờ ví tự nạp Shopee "${channel.shopName}" không đọc được:`,
      (err as Error).message
    );
  }
  return result;
}
