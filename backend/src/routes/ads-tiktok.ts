// ============================================================
// ROUTES QUẢNG CÁO TIKTOK (GMV Max — TikTok Marketing API) — CHỈ ĐỌC
//
// Mount /api/ads/tiktok (JWT + lá ads.tiktok + gói + có gian). Tách khỏi
// routes/ads.ts vì GMV Max khác bản chất Shopee/Lazada: không ví, không từ
// khóa, một bộ số (không direct/broad), và thứ chủ shop cần soi là VIDEO.
//
//   GET  /                       — tổng quan: campaign + số theo ngày (đọc DB, worker kéo)
//   GET  /campaigns/:id/videos   — soi SỐNG sản phẩm → video của một campaign
//   POST /refresh                — nút Làm mới (kéo hạn xung về ngay)
//
// Cách ly: mọi truy vấn đi qua gian của req.ownerId + TiktokAdsStoreLink của
// chính gian đó — token có thể thấy shop của seller khác (người chạy quảng cáo
// thuê) nhưng không đường nào ở đây chạm tới shop ngoài.
//
// Chưa có ROAS hòa vốn như Shopee: lợi nhuận đơn TikTok ĐÃ trừ phí GMV Max
// (quyết toán trừ trong đơn) nên biên lãi "chưa trừ ads" phải bóc riêng — để
// đợt sau, không đoán.
// ============================================================

import { Router } from "express";
import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middleware/auth";
import { nudgeAdsSyncIfStale, requestAdsRefresh } from "../services/sync-schedule";
import { dateKey, startOfDaysAgo } from "../integrations/shopee/ads-insights";
import { vnDateStr } from "../integrations/lazada/ads-campaigns";
import { getTiktokAdsLinkStatus, isTiktokAdsConfigured } from "../integrations/tiktok-ads";
import { getTiktokAdsScope, recordTiktokAdsFailure } from "../integrations/tiktok-ads/sync";
import {
  fetchGmvMaxCampaignProducts,
  fetchGmvMaxCampaignVideos,
} from "../integrations/tiktok-ads/report";

export const adsTiktokRouter = Router();

function parseDays(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, Math.trunc(n))) : 7;
}

async function ownedTiktokChannels(ownerId: string) {
  return prisma.channel.findMany({
    where: { userId: ownerId, channelName: ChannelName.TIKTOK, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, shopName: true, lastAdsSyncAt: true },
  });
}

adsTiktokRouter.get("/", async (req: AuthRequest, res, next) => {
  try {
    const configured = isTiktokAdsConfigured();
    const channels = await ownedTiktokChannels(req.ownerId!);
    const requestedId = typeof req.query.channelId === "string" ? req.query.channelId : "";
    const selected = channels.find((c) => c.id === requestedId) ?? channels[0] ?? null;
    const days = parseDays(req.query.days);
    // Bảng "gian ↔ tài khoản quảng cáo": mỗi gian có thể nối một tài khoản khác nhau.
    const links = await prisma.tiktokAdsStoreLink.findMany({
      where: { channelId: { in: channels.map((c) => c.id) } },
      select: { channelId: true, status: true, advertiserName: true, lastSyncError: true, auth: { select: { status: true } } },
    });
    const linkOf = new Map(links.map((l) => [l.channelId, l]));
    const base = {
      configured,
      channels: channels.map((c) => {
        const l = linkOf.get(c.id);
        return {
          id: c.id,
          shopName: c.shopName,
          ads: l
            ? {
                status: l.auth.status === "ACTIVE" ? l.status : "REVOKED",
                advertiserName: l.advertiserName,
                problem:
                  l.auth.status !== "ACTIVE"
                    ? "Tài khoản TikTok đã hủy ủy quyền."
                    : l.status !== "ACTIVE"
                      ? l.lastSyncError || "Tài khoản quảng cáo không còn quyền trên gian."
                      : null,
              }
            : null,
        };
      }),
      selectedChannelId: selected?.id ?? null,
      days,
    };
    if (!selected) {
      res.json({ ...base, link: null, summary: null, campaigns: [], series: [], adsRefreshing: false, adsSyncedAt: null });
      return;
    }

    const link = await getTiktokAdsLinkStatus(selected.id);
    const rows = await prisma.adsCampaign.findMany({
      where: { channelId: selected.id },
      include: { dailyPerf: { where: { date: { gte: startOfDaysAgo(days) } } } },
    });

    const seriesMap = new Map<string, { spend: number; gmv: number; orders: number }>();
    const campaigns = rows.map((c) => {
      let spend = 0;
      let orders = 0;
      let gmv = 0;
      for (const p of c.dailyPerf) {
        spend += Number(p.expense);
        orders += p.broadOrder;
        gmv += Number(p.broadGmv);
        const key = dateKey(p.date);
        const point = seriesMap.get(key) ?? { spend: 0, gmv: 0, orders: 0 };
        point.spend += Number(p.expense);
        point.gmv += Number(p.broadGmv);
        point.orders += p.broadOrder;
        seriesMap.set(key, point);
      }
      const roi = spend > 0 ? gmv / spend : null;
      const roasTarget = c.roasTarget != null ? Number(c.roasTarget) : null;
      return {
        id: c.id,
        campaignId: c.campaignId,
        name: c.name,
        status: c.status,
        biddingMethod: c.biddingMethod,
        roasTarget,
        budget: Number(c.budget),
        spend,
        orders,
        gmv,
        roi,
        costPerOrder: orders > 0 ? spend / orders : null,
        /** Đang chạy, có tiêu tiền, mà ROI thực thấp hơn ROI mục tiêu đã đặt. */
        belowTarget: c.status === "ongoing" && roasTarget != null && roi != null && roi < roasTarget,
      };
    });
    // Đang chạy + tốn tiền nhất lên đầu; campaign tắt không số xuống cuối.
    campaigns.sort(
      (a, b) => b.spend - a.spend || Number(b.status === "ongoing") - Number(a.status === "ongoing") || a.name.localeCompare(b.name)
    );

    const spend = campaigns.reduce((s, c) => s + c.spend, 0);
    const orders = campaigns.reduce((s, c) => s + c.orders, 0);
    const gmv = campaigns.reduce((s, c) => s + c.gmv, 0);

    res.json({
      ...base,
      link,
      summary: {
        spend,
        orders,
        gmv,
        roi: spend > 0 ? gmv / spend : null,
        costPerOrder: orders > 0 ? spend / orders : null,
        liveCampaigns: campaigns.filter((c) => c.status === "ongoing").length,
        belowTargetCount: campaigns.filter((c) => c.belowTarget).length,
      },
      campaigns,
      series: [...seriesMap.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      // Gian đã nối mà số cũ → kéo hạn xung về ngay; FE tự nạp lại sau ít giây.
      adsRefreshing: link.linked && link.status === "ACTIVE" ? await nudgeAdsSyncIfStale(selected.id) : false,
      adsSyncedAt: selected.lastAdsSyncAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// Soi SỐNG một campaign: sản phẩm (SPU) + video đang được phân phối, cộng dồn
// `days` ngày. Không lưu DB (một campaign thật có gần 1.800 video). 2–3 call/lượt.
adsTiktokRouter.get("/campaigns/:id/videos", async (req: AuthRequest, res, next) => {
  try {
    const campaign = await prisma.adsCampaign.findFirst({
      where: {
        id: String(req.params.id),
        channel: { userId: req.ownerId!, channelName: ChannelName.TIKTOK },
      },
      select: { id: true, campaignId: true, name: true, channelId: true },
    });
    if (!campaign) {
      res.status(404).json({ error: "Không tìm thấy chiến dịch" });
      return;
    }
    const scope = await getTiktokAdsScope(campaign.channelId);
    if (!scope) {
      res.status(409).json({ error: "Gian chưa kết nối quảng cáo TikTok hoặc kết nối đã hết hiệu lực." });
      return;
    }
    const days = parseDays(req.query.days);
    const range = {
      accessToken: scope.accessToken,
      advertiserId: scope.advertiserId,
      storeId: scope.storeId,
      startDate: vnDateStr(days - 1),
      endDate: vnDateStr(0),
    };

    try {
      const products = await fetchGmvMaxCampaignProducts(range, campaign.campaignId);
      const spuIds = products.map((p) => p.spuId).filter(Boolean);
      const videos = spuIds.length > 0 ? await fetchGmvMaxCampaignVideos(range, campaign.campaignId, spuIds) : [];
      // Thẻ sản phẩm (item_id -1) không phải video — không loại được, bỏ khỏi bảng soi.
      const rows = videos
        .filter((v) => v.videoId && v.videoId !== "-1")
        .map((v) => ({
          ...v,
          roi: v.cost > 0 ? v.gmv / v.cost : null,
          /** Tiêu tiền mà không ra đơn nào trong khoảng ngày đang xem. */
          noOrder: v.cost > 0 && v.orders === 0,
        }))
        .sort((a, b) => Number(b.noOrder) - Number(a.noOrder) || b.cost - a.cost);

      const videoSpend = rows.reduce((s, v) => s + v.cost, 0);
      const noOrder = rows.filter((v) => v.noOrder);
      res.json({
        campaign: { id: campaign.id, campaignId: campaign.campaignId, name: campaign.name },
        days,
        products,
        videos: rows,
        totals: {
          videoCount: rows.length,
          spendingCount: rows.filter((v) => v.cost > 0).length,
          videoSpend,
          noOrderCount: noOrder.length,
          noOrderSpend: noOrder.reduce((s, v) => s + v.cost, 0),
        },
      });
    } catch (err) {
      await recordTiktokAdsFailure(scope.linkId, err);
      res.status(502).json({ error: `Không đọc được số từ TikTok: ${(err as Error).message}` });
    }
  } catch (err) {
    next(err);
  }
});

adsTiktokRouter.post("/refresh", async (req: AuthRequest, res, next) => {
  try {
    const channelId = typeof req.body?.channelId === "string" ? req.body.channelId : "";
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, userId: req.ownerId!, channelName: ChannelName.TIKTOK },
      select: { id: true },
    });
    if (!channel) {
      res.status(404).json({ error: "Không tìm thấy gian TikTok" });
      return;
    }
    if (!(await getTiktokAdsScope(channel.id))) {
      res.status(409).json({ error: "Gian chưa kết nối quảng cáo TikTok." });
      return;
    }
    res.json(await requestAdsRefresh(channel.id));
  } catch (err) {
    next(err);
  }
});
