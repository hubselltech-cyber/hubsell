// ============================================================
// LAZADA — XUNG QUẢNG CÁO (tầng A, docs/ADS-NHIP-CANH-BAO.md) — 12/09/2026
//
// Mỗi ADS_CADENCE.PULSE_LAZADA_MIN (60' tới khi có quota app ISV), 2 call:
//   1. searchCampaignList (mọi trang) → trạng thái/ngân sách/tên/ngày TƯƠI +
//      campaign mới + CỜ VÍ (adAccountBalanceStatus = 0 trên campaign đang bật
//      = hết tiền) → Channel.adsWalletBalance = 0, còn tiền → null.
//   2. getDiscoveryReportCampaign HÔM NAY (useRtTable) → dòng today.
//
// Không gọi adgroup ở đây (itemIds đổi chậm) — tầng B lo.
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getAdsCampaignList, getAdsCampaignReport, lazAdsNum, type LazadaAdsCampaign } from "./client";
import { getValidLazadaAccessToken } from "./service";
import { dateFromStr, deriveStatus, lazadaCampaignData, vnDateStr } from "./ads-campaigns";

export interface LazadaAdsPulseResult {
  campaignsFound: number;
  campaignsUpserted: number;
  perfTodayUpserted: number;
  walletEmpty: boolean;
}

export async function pulseLazadaAds(channel: Channel): Promise<LazadaAdsPulseResult> {
  const accessToken = await getValidLazadaAccessToken(channel);
  const todayVn = vnDateStr(0);

  // 1. Danh sách campaign (cửa sổ rộng như tầng B để không sót campaign cũ bật lại).
  const campaigns: LazadaAdsCampaign[] = [];
  const startWide = vnDateStr(3650);
  for (let pageNo = 1; pageNo <= 30; pageNo++) {
    const page = await getAdsCampaignList({
      accessToken,
      startDate: startWide,
      endDate: todayVn,
      pageNo,
      pageSize: 100,
    });
    campaigns.push(...page.campaigns);
    if (page.campaigns.length < 100 || campaigns.length >= page.totalCount) break;
  }

  const result: LazadaAdsPulseResult = {
    campaignsFound: campaigns.length,
    campaignsUpserted: 0,
    perfTodayUpserted: 0,
    walletEmpty: false,
  };

  const rowIdByCampaignId = new Map<string, string>();
  for (const c of campaigns) {
    if (c.campaignId == null) continue;
    const campaignId = String(c.campaignId);
    const data = lazadaCampaignData(c, todayVn);
    const row = await prisma.adsCampaign.upsert({
      where: { channelId_campaignId: { channelId: channel.id, campaignId } },
      update: data,
      create: { channelId: channel.id, campaignId, ...data },
    });
    rowIdByCampaignId.set(campaignId, row.id);
    result.campaignsUpserted++;
  }

  // Cờ ví: chỉ có nghĩa khi còn campaign đang bật.
  result.walletEmpty = campaigns.some(
    (c) =>
      lazAdsNum(c.campaignSwitchStatus) === 1 &&
      c.adAccountBalanceStatus != null &&
      lazAdsNum(c.adAccountBalanceStatus) === 0
  );
  const anyOngoing = campaigns.some((c) => deriveStatus(c, todayVn) === "ongoing");
  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      adsWalletBalance: anyOngoing && result.walletEmpty ? 0 : null,
      adsWalletSyncedAt: new Date(),
    },
  });

  // 2. Report hôm nay (bảng realtime) → dòng today.
  if (rowIdByCampaignId.size > 0) {
    const date = dateFromStr(todayVn);
    for (let pageNo = 1; pageNo <= 10; pageNo++) {
      const page = await getAdsCampaignReport({
        accessToken,
        startDate: todayVn,
        endDate: todayVn,
        pageNo,
        pageSize: 100,
        useRtTable: true,
      });
      for (const r of page.rows) {
        if (r.campaignId == null) continue;
        const rowId = rowIdByCampaignId.get(String(r.campaignId));
        if (!rowId) continue;
        const data = {
          impression: Math.trunc(lazAdsNum(r.impressions)),
          clicks: Math.trunc(lazAdsNum(r.clicks)),
          expense: lazAdsNum(r.spend),
          broadOrder: Math.trunc(lazAdsNum(r.storeOrders)),
          broadGmv: lazAdsNum(r.storeRevenue),
          directOrder: Math.trunc(lazAdsNum(r.productOrders)),
          directGmv: lazAdsNum(r.productRevenue),
        };
        const hasAny = Object.values(data).some((v) => v > 0);
        if (!hasAny) continue;
        await prisma.adsCampaignDailyPerf.upsert({
          where: { adsCampaignId_date: { adsCampaignId: rowId, date } },
          update: data,
          create: { adsCampaignId: rowId, date, ...data },
        });
        result.perfTodayUpserted++;
      }
      if (page.rows.length < 100) break;
    }
  }
  return result;
}
