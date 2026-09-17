// ============================================================
// ROUTES QUẢNG CÁO TIKTOK (GMV Max — TikTok Marketing API) — CHỈ ĐỌC
//
// Mount /api/ads/tiktok (JWT + lá ads.tiktok + gói + có gian). Tách khỏi
// routes/ads.ts vì GMV Max khác bản chất Shopee/Lazada: không ví, không từ
// khóa, một bộ số (không direct/broad), và thứ chủ shop cần soi là VIDEO.
//
//   GET  /                       — tổng quan: campaign + số theo ngày (đọc DB, worker kéo)
//   GET  /campaigns/:id/videos   — soi SỐNG sản phẩm → video của một campaign
//   POST /campaigns/:id/videos/action — LOẠI / KHÔI PHỤC video (lệnh ghi duy nhất, chỉ chủ shop)
//   GET  /video-meta?ids=        — ảnh bìa + kênh + caption (oEmbed công khai, có nhớ đệm)
//   POST /refresh                — nút Làm mới (kéo hạn xung về ngay)
//
// Lệnh ghi (17/09/2026): chỉ THỦ CÔNG theo tay chủ shop, mỗi lệnh một dòng
// AdsActionLog (action exclude_video | restore_video, mode live, verdict manual).
// Sàn áp dụng sau ~20 phút và không trả kết quả từng video → video vừa thao tác
// được đánh dấu "đang chờ" từ chính sổ hành động cho tới khi report đổi trạng thái.
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
import { requireAdmin, type AuthRequest } from "../middleware/auth";
import { nudgeAdsSyncIfStale, requestAdsRefresh } from "../services/sync-schedule";
import { dateKey, startOfDaysAgo } from "../integrations/shopee/ads-insights";
import { vnDateStr } from "../integrations/lazada/ads-campaigns";
import {
  GMV_MAX_CREATIVE_BATCH,
  getTiktokAdsLinkStatus,
  isTiktokAdsConfigured,
  updateGmvMaxCreatives,
} from "../integrations/tiktok-ads";
import { getTiktokAdsScope, recordTiktokAdsFailure, verifyTiktokAdsLink } from "../integrations/tiktok-ads/sync";
import {
  GMV_MAX_EXCLUDED_STATUS,
  GMV_MAX_LIVE_VIDEO_STATUSES,
  fetchGmvMaxCampaignProducts,
  fetchGmvMaxCampaignVideos,
} from "../integrations/tiktok-ads/report";
import { VIDEO_META_MAX_IDS, getTiktokVideoMeta } from "../integrations/tiktok-ads/video-meta";

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

/** Sàn cần ~20 phút để đổi trạng thái video; quá mốc này coi như lệnh đã ngấm (hoặc đã hỏng). */
const PENDING_WINDOW_MS = 30 * 60 * 1000;
const VIDEO_LINE = /^#(\d+) /;

/** videoId → hành động còn đang chờ sàn áp dụng, đọc từ sổ hành động gần đây của campaign. */
async function pendingVideoActions(adsCampaignId: string): Promise<Map<string, "REMOVE" | "ADD">> {
  const logs = await prisma.adsActionLog.findMany({
    where: {
      adsCampaignId,
      action: { in: ["exclude_video", "restore_video"] },
      status: "SUCCESS",
      createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" }, // lệnh sau đè lệnh trước trên cùng video
    select: { action: true, reasons: true },
  });
  const out = new Map<string, "REMOVE" | "ADD">();
  for (const l of logs) {
    for (const line of l.reasons.split("\n")) {
      const m = VIDEO_LINE.exec(line);
      if (m) out.set(m[1], l.action === "exclude_video" ? "REMOVE" : "ADD");
    }
  }
  return out;
}

// Soi SỐNG một campaign: sản phẩm (SPU) + video đang được phân phối, cộng dồn
// `days` ngày. Không lưu DB (một campaign thật có gần 1.800 video). 2–3 call/lượt.
adsTiktokRouter.get("/campaigns/:id/videos", async (req: AuthRequest, res, next) => {
  try {
    const campaign = await prisma.adsCampaign.findFirst({
      where: {
        id: String(req.params.id),
        channel: { userId: req.ownerId!, channelName: ChannelName.TIKTOK },
      },
      select: {
        id: true,
        campaignId: true,
        name: true,
        channelId: true,
        status: true,
        roasTarget: true,
        biddingMethod: true,
        channel: { select: { shopName: true } },
      },
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
      const videos =
        spuIds.length > 0
          ? await fetchGmvMaxCampaignVideos(range, campaign.campaignId, spuIds, [
              ...GMV_MAX_LIVE_VIDEO_STATUSES,
              GMV_MAX_EXCLUDED_STATUS,
            ])
          : [];
      const pending = await pendingVideoActions(campaign.id);
      // Sổ thao tác video của chiến dịch (10 lệnh gần nhất) — hiện ngay dưới bảng.
      const logs = await prisma.adsActionLog.findMany({
        where: { adsCampaignId: campaign.id, action: { in: ["exclude_video", "restore_video"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, action: true, status: true, error: true, reasons: true, createdAt: true },
      });
      // Thẻ sản phẩm (item_id -1) không phải video — không loại được, bỏ khỏi bảng soi.
      const rows = videos
        .filter((v) => v.videoId && v.videoId !== "-1")
        .map((v) => {
          const wait = pending.get(v.videoId) ?? null;
          const excluded = v.deliveryStatus === GMV_MAX_EXCLUDED_STATUS;
          return {
            ...v,
            roi: v.cost > 0 ? v.gmv / v.cost : null,
            /** Tiêu tiền mà không ra đơn nào trong khoảng ngày đang xem. */
            noOrder: v.cost > 0 && v.orders === 0,
            excluded,
            /** Lệnh vừa gửi mà report chưa đổi trạng thái (sàn áp dụng sau ~20 phút). */
            pending: wait === "REMOVE" && !excluded ? "REMOVE" : wait === "ADD" && excluded ? "ADD" : null,
          };
        })
        .sort((a, b) => Number(b.noOrder) - Number(a.noOrder) || b.cost - a.cost);

      const active = rows.filter((v) => !v.excluded);
      const videoSpend = active.reduce((s, v) => s + v.cost, 0);
      const noOrder = active.filter((v) => v.noOrder);
      res.json({
        campaign: {
          id: campaign.id,
          campaignId: campaign.campaignId,
          name: campaign.name,
          shopName: campaign.channel.shopName,
          channelId: campaign.channelId,
          status: campaign.status,
          biddingMethod: campaign.biddingMethod,
          roasTarget: campaign.roasTarget != null ? Number(campaign.roasTarget) : null,
          spend: products.reduce((s, x) => s + x.cost, 0),
          orders: products.reduce((s, x) => s + x.orders, 0),
          gmv: products.reduce((s, x) => s + x.gmv, 0),
        },
        days,
        products,
        videos: rows,
        actions: logs.map((l) => ({
          id: l.id,
          action: l.action,
          status: l.status,
          error: l.error,
          videoIds: l.reasons.split("\n").map((x) => VIDEO_LINE.exec(x)?.[1]).filter(Boolean),
          createdAt: l.createdAt,
        })),
        totals: {
          videoCount: active.length,
          spendingCount: active.filter((v) => v.cost > 0).length,
          excludedCount: rows.length - active.length,
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

// LOẠI / KHÔI PHỤC video — lệnh GHI, chỉ chủ shop. body: { action: "REMOVE"|"ADD",
// items: [{ videoId, spuId, cost?, orders? }] } (cost/orders chỉ để ghi sổ cho dễ tra).
adsTiktokRouter.post("/campaigns/:id/videos/action", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const action = req.body?.action === "ADD" ? "ADD" : req.body?.action === "REMOVE" ? "REMOVE" : null;
    const rawItems: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
    const bySpu = new Map<string, { spuIds: Set<string>; cost: number; orders: number }>();
    for (const it of rawItems as Record<string, unknown>[]) {
      const videoId = String(it?.videoId ?? "");
      const spuId = String(it?.spuId ?? "");
      if (!/^\d{15,22}$/.test(videoId) || !/^\d{10,22}$/.test(spuId)) continue;
      const cur = bySpu.get(videoId) ?? { spuIds: new Set<string>(), cost: 0, orders: 0 };
      cur.spuIds.add(spuId);
      cur.cost += Number(it.cost) || 0;
      cur.orders += Number(it.orders) || 0;
      bySpu.set(videoId, cur);
    }
    if (!action || bySpu.size === 0) {
      res.status(400).json({ error: "Thiếu hành động hoặc danh sách video" });
      return;
    }
    if (bySpu.size > GMV_MAX_CREATIVE_BATCH) {
      res.status(400).json({ error: `Mỗi lần chỉ thao tác tối đa ${GMV_MAX_CREATIVE_BATCH} video` });
      return;
    }

    const campaign = await prisma.adsCampaign.findFirst({
      where: { id: String(req.params.id), channel: { userId: req.ownerId!, channelName: ChannelName.TIKTOK } },
      select: { id: true, campaignId: true, name: true, channelId: true, status: true },
    });
    if (!campaign) {
      res.status(404).json({ error: "Không tìm thấy chiến dịch" });
      return;
    }
    if (campaign.status !== "ongoing") {
      res.status(409).json({ error: "TikTok chỉ cho loại hoặc khôi phục video khi chiến dịch đang bật." });
      return;
    }
    // Tài khoản quảng cáo là thực thể rời shop → kiểm lại quyền NGAY TRƯỚC lệnh ghi.
    await verifyTiktokAdsLink(campaign.channelId);
    const scope = await getTiktokAdsScope(campaign.channelId);
    if (!scope) {
      res.status(409).json({ error: "Kết nối quảng cáo của gian không còn hiệu lực. Hãy kết nối lại ở tab Kết nối." });
      return;
    }

    const items = [...bySpu.entries()].map(([itemId, v]) => ({ itemId, spuIds: [...v.spuIds] }));
    const logBase = {
      channelId: campaign.channelId,
      adsCampaignId: campaign.id,
      action: action === "REMOVE" ? "exclude_video" : "restore_video",
      mode: "live",
      verdict: "manual",
      // Mỗi dòng mở đầu "#<videoId> " — pendingVideoActions đọc lại từ đây.
      reasons: [...bySpu.entries()]
        .map(([id, v]) => `#${id} · chi ${Math.round(v.cost).toLocaleString("vi-VN")}đ · ${v.orders} đơn`)
        .join("\n"),
      referenceId: `ttv-${campaign.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    try {
      await updateGmvMaxCreatives(scope.accessToken, {
        advertiserId: scope.advertiserId,
        campaignId: campaign.campaignId,
        action,
        items,
      });
    } catch (err) {
      await prisma.adsActionLog.create({ data: { ...logBase, status: "FAILED", error: (err as Error).message.slice(0, 1000) } });
      res.status(502).json({ error: `TikTok từ chối lệnh: ${(err as Error).message}` });
      return;
    }
    await prisma.adsActionLog.create({ data: { ...logBase, status: "SUCCESS" } });
    res.json({
      ok: true,
      count: items.length,
      message:
        action === "REMOVE"
          ? `Đã gửi lệnh loại ${items.length} video. TikTok áp dụng sau khoảng 20 phút.`
          : `Đã gửi lệnh khôi phục ${items.length} video. TikTok áp dụng sau khoảng 20 phút.`,
    });
  } catch (err) {
    next(err);
  }
});

// Ảnh bìa + kênh + caption cho các video của TRANG ĐANG XEM (≤24 id/lượt).
// Không gắn với gian nào: dữ liệu công khai của TikTok, chỉ cần đã qua cổng quyền ads.tiktok.
adsTiktokRouter.get("/video-meta", async (req: AuthRequest, res, next) => {
  try {
    const ids = String(req.query.ids ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, VIDEO_META_MAX_IDS);
    res.json({ items: await getTiktokVideoMeta(ids) });
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
