// ============================================================
// TIKTOK ADS — ĐỒNG BỘ CAMPAIGN GMV MAX VÀO BẢNG ADS DÙNG CHUNG (chỉ đọc)
//
// Ghi vào AdsCampaign + AdsCampaignDailyPerf — cùng bảng với Shopee/Lazada, sàn
// suy từ Channel.channelName. Ánh xạ từ vựng:
//   operation_status ENABLE/DISABLE → status ongoing/paused
//   roas_bid (ROI mục tiêu)         → roasTarget (NO_BID = phân phối tối đa → NULL)
//   cost / orders / gross_revenue   → expense / broad* VÀ direct* (GMV Max chỉ
//     có MỘT bộ số: đơn của chính SP trong campaign, gộp cả đơn tự nhiên —
//     không tách direct/broad như Shopee nên ghi trùng hai cặp).
//   impression / clicks             → 0 (tầng campaign của GMV Max không có).
//
// ⚠️ KHÔNG ghi AdSpend: phí GMV Max đã bị sàn trừ ngay trong quyết toán từng
// đơn (tiktok/settlements.ts: gmv_max_ad_fee_amount → order.serviceFee). Ghi
// thêm AdSpend thì Lãi/Lỗ trừ tiền quảng cáo HAI LẦN.
//
// Một lượt = 1 call (campaign × ngày, ≤1000 dòng/trang). Tầng sản phẩm/video
// không lưu DB — soi sống khi chủ shop mở campaign (routes/ads-tiktok.ts).
// ============================================================

import type { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { dateFromStr, vnDateStr } from "../lazada/ads-campaigns";
import { TiktokAdsApiError } from "./client";
import { fetchGmvMaxCampaignDaily } from "./report";

/** 40105 = access token sai hoặc đã bị thu hồi (docs Appendix - Return codes). */
const TOKEN_DEAD_CODES = new Set([40105]);

export interface TiktokAdsScope {
  linkId: string;
  accessToken: string;
  advertiserId: string;
  storeId: string;
}

/** Link quảng cáo còn dùng được của gian, hoặc null (chưa nối / token chết / mất quyền). */
export async function getTiktokAdsScope(channelId: string): Promise<TiktokAdsScope | null> {
  const link = await prisma.tiktokAdsStoreLink.findUnique({
    where: { channelId },
    select: {
      id: true,
      status: true,
      advertiserId: true,
      storeId: true,
      auth: { select: { accessToken: true, status: true } },
    },
  });
  if (!link || link.status !== "ACTIVE" || link.auth.status !== "ACTIVE") return null;
  return {
    linkId: link.id,
    accessToken: link.auth.accessToken,
    advertiserId: link.advertiserId,
    storeId: link.storeId,
  };
}

/** Ghi hậu quả của một lỗi sàn lên link/auth để UI nói thật và worker thôi gọi. */
export async function recordTiktokAdsFailure(linkId: string, err: unknown): Promise<void> {
  const message = (err as Error).message.slice(0, 500);
  const code = err instanceof TiktokAdsApiError ? err.code : 0;
  if (TOKEN_DEAD_CODES.has(code)) {
    const link = await prisma.tiktokAdsStoreLink.findUnique({ where: { id: linkId }, select: { authId: true } });
    if (link) {
      await prisma.tiktokAdsAuth.update({
        where: { id: link.authId },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    }
  }
  await prisma.tiktokAdsStoreLink
    .update({
      where: { id: linkId },
      data: { lastSyncError: message },
    })
    .catch(() => {});
}

export interface SyncTiktokAdsResult {
  /** false = gian chưa nối quảng cáo (hoặc link hỏng) → worker giãn nhịp. */
  linked: boolean;
  campaignsUpserted: number;
  perfDaysUpserted: number;
  liveCampaigns: number;
  /** Có chi tiêu trong 2 ngày gần nhất — quyết nhịp xung. */
  spentRecently: boolean;
}

export async function syncTiktokAdsCampaigns(
  channel: Pick<Channel, "id">,
  opts: { daysBack?: number } = {}
): Promise<SyncTiktokAdsResult> {
  const result: SyncTiktokAdsResult = {
    linked: false,
    campaignsUpserted: 0,
    perfDaysUpserted: 0,
    liveCampaigns: 0,
    spentRecently: false,
  };
  const scope = await getTiktokAdsScope(channel.id);
  if (!scope) return result;
  result.linked = true;

  const daysBack = Math.min(30, Math.max(1, opts.daysBack ?? 7));
  let rows;
  try {
    rows = await fetchGmvMaxCampaignDaily({
      accessToken: scope.accessToken,
      advertiserId: scope.advertiserId,
      storeId: scope.storeId,
      startDate: vnDateStr(daysBack - 1),
      endDate: vnDateStr(0),
    });
  } catch (err) {
    await recordTiktokAdsFailure(scope.linkId, err);
    throw err;
  }

  // Thuộc tính campaign lặp lại trên mọi dòng ngày — lấy dòng MỚI NHẤT làm chuẩn.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.campaignId) continue;
    const cur = latest.get(r.campaignId);
    if (!cur || r.date > cur.date) latest.set(r.campaignId, r);
  }

  const rowIdByCampaignId = new Map<string, string>();
  for (const [campaignId, c] of latest) {
    const data = {
      name: c.name,
      adType: "gmv_max",
      status: c.operationStatus === "ENABLE" ? "ongoing" : "paused",
      biddingMethod: c.bidType === "NO_BID" ? "max_delivery" : "target_roi",
      budget: c.budget,
      roasTarget: c.roasBid,
    };
    const row = await prisma.adsCampaign.upsert({
      where: { channelId_campaignId: { channelId: channel.id, campaignId } },
      update: data,
      create: { channelId: channel.id, campaignId, ...data },
    });
    rowIdByCampaignId.set(campaignId, row.id);
    result.campaignsUpserted++;
    if (data.status === "ongoing") result.liveCampaigns++;
  }

  const recentFrom = vnDateStr(1);
  for (const r of rows) {
    const rowId = rowIdByCampaignId.get(r.campaignId);
    if (!rowId || !r.date) continue;
    if (r.cost <= 0 && r.orders <= 0 && r.gmv <= 0) continue; // dòng 0 không mang thông tin
    const orders = Math.trunc(r.orders);
    const data = {
      expense: r.cost,
      broadOrder: orders,
      broadGmv: r.gmv,
      directOrder: orders,
      directGmv: r.gmv,
    };
    await prisma.adsCampaignDailyPerf.upsert({
      where: { adsCampaignId_date: { adsCampaignId: rowId, date: dateFromStr(r.date) } },
      update: data,
      create: { adsCampaignId: rowId, date: dateFromStr(r.date), ...data },
    });
    result.perfDaysUpserted++;
    if (r.cost > 0 && r.date >= recentFrom) result.spentRecently = true;
  }

  await prisma.tiktokAdsStoreLink.update({
    where: { id: scope.linkId },
    data: { lastSyncedAt: new Date(), lastSyncError: "" },
  });
  return result;
}
