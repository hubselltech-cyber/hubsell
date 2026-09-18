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
//   GET  /campaigns/:id/auto-rule         — cấu hình LOẠI TỰ ĐỘNG của chiến dịch (+ mặc định gợi ý)
//   PUT  /campaigns/:id/auto-rule         — lưu cấu hình / đổi chế độ Tắt · Diễn tập · Tự loại thật (chủ shop)
//   POST /campaigns/:id/auto-rule/preview — CHẠY THỬ cấu hình trên số thật, không ghi gì
//   POST /campaigns/:id/auto-rule/copy    — sao chép cấu hình sang chiến dịch khác cùng gian
//   GET  /campaigns/:id/auto-rule/backtest — ĐỐI CHIẾU DIỄN TẬP: video máy định loại, từ đó đến nay chạy ra sao
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
import { dateKey } from "../integrations/shopee/ads-insights";
import { vnDateStr } from "../integrations/lazada/ads-campaigns";
import {
  GMV_MAX_CREATIVE_BATCH,
  getTiktokAdsLinkStatus,
  isTiktokAdsConfigured,
  updateGmvMaxCreatives,
} from "../integrations/tiktok-ads";
import { getTiktokAdsScope, recordTiktokAdsFailure, verifyTiktokAdsLink } from "../integrations/tiktok-ads/sync";
import {
  VIDEO_ACTIONS,
  VIDEO_ACTION_EXCLUDE,
  VIDEO_ACTION_RESTORE,
  VIDEO_VERDICT_MANUAL,
  buildVideoActionReasons,
  parseVideoActionReasons,
  videoActionNote,
} from "../integrations/tiktok-ads/action-log";
import {
  GMV_MAX_EXCLUDED_STATUS,
  GMV_MAX_LIVE_VIDEO_STATUSES,
  GMV_MAX_DAILY_MAX_RANGE_DAYS,
  clampGmvMaxRange,
  fetchGmvMaxCampaignProducts,
  fetchGmvMaxCampaignVideoDays,
  fetchGmvMaxCampaignVideos,
} from "../integrations/tiktok-ads/report";
import { backtestStartDate, buildDryRunBacktest, type DryRunPlan } from "../integrations/tiktok-ads/backtest";
import { computeTiktokAdsBreakeven, saveCampaignProductIds, type TiktokBreakeven } from "../integrations/tiktok-ads/breakeven";
import { VIDEO_META_MAX_IDS, getTiktokVideoMeta } from "../integrations/tiktok-ads/video-meta";
import {
  AUTO_RULE_MODES,
  sanitizeAutoRuleConfig,
  summarizeAutoPlan,
  type AutoRuleMode,
} from "../integrations/tiktok-ads/auto-rules";
import {
  VIDEO_VERDICT_AUTO,
  buildAutoPlan,
  defaultAutoRuleFor,
  ruleRowToConfig,
  trackCampaignVideos,
} from "../integrations/tiktok-ads/auto-run";

export const adsTiktokRouter = Router();

function parseDays(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, Math.trunc(n))) : 7;
}

/** ROI hòa vốn gửi cho UI (số làm tròn ở FE). null = gian chưa tính được gì. */
function breakevenForUi(b: TiktokBreakeven | undefined | null) {
  if (!b) return null;
  return {
    roi: b.breakevenRoi,
    margin: b.margin,
    negativeMargin: b.negativeMargin,
    source: b.source,
    orders: b.orders,
    costCoveragePct: b.costCoveragePct,
    check: b.check,
  };
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
    // Khoảng ngày theo lịch VN (?from=&to= của bộ lọc chuẩn; ?days= là đường cũ).
    const period = clampGmvMaxRange(
      { from: req.query.from, to: req.query.to, fallbackDays: parseDays(req.query.days) },
      vnDateStr(0)
    );
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
      from: period.startDate,
      to: period.endDate,
    };
    if (!selected) {
      res.json({ ...base, dataFrom: null, breakeven: null, link: null, summary: null, campaigns: [], series: [], adsRefreshing: false, adsSyncedAt: null });
      return;
    }

    const link = await getTiktokAdsLinkStatus(selected.id);
    const rows = await prisma.adsCampaign.findMany({
      where: { channelId: selected.id },
      include: {
        // Cột @db.Date lưu 00:00 UTC của ngày SÀN (giờ VN) → so bằng mốc UTC của chính ngày đó.
        dailyPerf: {
          where: {
            date: { gte: new Date(`${period.startDate}T00:00:00Z`), lte: new Date(`${period.endDate}T00:00:00Z`) },
          },
        },
        tiktokAutoRule: { select: { mode: true, lastRunOn: true, lastRunSummary: true } },
      },
    });
    // Ngày sớm nhất Hubsell có số của gian (lần nối đầu chỉ kéo lùi 30 ngày) — FE báo khi khoảng xem vượt quá.
    const oldest = await prisma.adsCampaignDailyPerf.aggregate({
      where: { adsCampaign: { channelId: selected.id } },
      _min: { date: true },
    });

    // ROI HÒA VỐN (30 ngày, không theo bộ lọc): căn cứ thật cho ROI mục tiêu / mức loại. Hỏng thì trang vẫn lên.
    const breakeven = await computeTiktokAdsBreakeven({ id: selected.id, userId: req.ownerId! }).catch((err) => {
      console.error("[TikTok Ads] Tính ROI hòa vốn lỗi:", (err as Error).message);
      return null;
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
        breakeven: breakevenForUi(breakeven?.byCampaignRowId.get(c.id)),
        /** Loại video tự động: chế độ + lượt xét gần nhất (null = chưa cấu hình = Tắt). */
        auto: c.tiktokAutoRule ? autoStatusOf(c.tiktokAutoRule) : null,
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
      dataFrom: oldest._min.date ? dateKey(oldest._min.date) : null,
      breakeven: breakevenForUi(breakeven?.shop),
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

/** videoId → hành động còn đang chờ sàn áp dụng, đọc từ sổ hành động gần đây của campaign. */
async function pendingVideoActions(adsCampaignId: string): Promise<Map<string, "REMOVE" | "ADD">> {
  const logs = await prisma.adsActionLog.findMany({
    where: {
      adsCampaignId,
      action: { in: VIDEO_ACTIONS },
      status: "SUCCESS",
      createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" }, // lệnh sau đè lệnh trước trên cùng video
    select: { action: true, reasons: true },
  });
  const out = new Map<string, "REMOVE" | "ADD">();
  for (const l of logs) {
    for (const v of parseVideoActionReasons(l.reasons).videos) {
      out.set(v.videoId, l.action === VIDEO_ACTION_EXCLUDE ? "REMOVE" : "ADD");
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
        itemIds: true,
        channel: { select: { shopName: true } },
        tiktokAutoRule: { select: { mode: true, lastRunOn: true, lastRunSummary: true } },
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
    const period = clampGmvMaxRange(
      { from: req.query.from, to: req.query.to, fallbackDays: parseDays(req.query.days) },
      vnDateStr(0)
    );
    const range = {
      accessToken: scope.accessToken,
      advertiserId: scope.advertiserId,
      storeId: scope.storeId,
      ...period,
    };

    try {
      const products = await fetchGmvMaxCampaignProducts(range, campaign.campaignId);
      const spuIds = products.map((p) => p.spuId).filter(Boolean);
      // Ghi lại sản phẩm của chiến dịch (nguồn nối chiến dịch → SKU) rồi mới tính hòa vốn cho đúng SKU.
      if (period.endDate === vnDateStr(0)) await saveCampaignProductIds(campaign.id, campaign.itemIds, spuIds).catch(() => {});
      const breakeven = await computeTiktokAdsBreakeven({ id: campaign.channelId, userId: req.ownerId! }).catch(() => null);
      const videos =
        spuIds.length > 0
          ? await fetchGmvMaxCampaignVideos(range, campaign.campaignId, spuIds, [
              ...GMV_MAX_LIVE_VIDEO_STATUSES,
              GMV_MAX_EXCLUDED_STATUS,
            ])
          : [];
      const pending = await pendingVideoActions(campaign.id);
      // Kết luận gần nhất của luật tự động cho từng video (bảng theo dõi) — chip "Máy sẽ loại" / "Cần xem".
      const watches = await prisma.tiktokAdsVideoWatch.findMany({
        where: { adsCampaignId: campaign.id, lastVerdict: { not: "" } },
        select: { videoId: true, lastVerdict: true, lastReason: true, lastVerdictOn: true, graduatedOn: true },
      });
      const watchOf = new Map(watches.map((w) => [w.videoId, w]));
      // Sổ thao tác video của chiến dịch (10 lệnh gần nhất) — hiện ngay dưới bảng.
      const logs = await prisma.adsActionLog.findMany({
        where: { adsCampaignId: campaign.id, action: { in: VIDEO_ACTIONS } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, action: true, mode: true, verdict: true, status: true, error: true, reasons: true, createdAt: true },
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
            /** Kết luận lượt xét tự động gần nhất (null = chưa xét / chiến dịch chưa bật tự động). */
            auto: (() => {
              const w = watchOf.get(v.videoId);
              return w ? { verdict: w.lastVerdict, reason: w.lastReason, on: w.lastVerdictOn, graduatedOn: w.graduatedOn } : null;
            })(),
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
          auto: campaign.tiktokAutoRule ? autoStatusOf(campaign.tiktokAutoRule) : null,
          breakeven: breakevenForUi(breakeven?.byCampaignRowId.get(campaign.id)),
        },
        from: period.startDate,
        to: period.endDate,
        products,
        videos: rows,
        actions: logs.map((l) => ({
          id: l.id,
          action: l.action,
          /** dry_run = lệnh DIỄN TẬP (status PLANNED, chưa gọi sàn); live = đã gửi lên TikTok. */
          mode: l.mode,
          status: l.status,
          error: l.error,
          /** manual = chủ shop tự bấm; auto = Trợ lý tự động (căn cứ ở grounds). */
          source: l.verdict === VIDEO_VERDICT_MANUAL ? "manual" : "auto",
          ...parseVideoActionReasons(l.reasons),
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
      action: action === "REMOVE" ? VIDEO_ACTION_EXCLUDE : VIDEO_ACTION_RESTORE,
      mode: "live",
      verdict: VIDEO_VERDICT_MANUAL,
      reasons: buildVideoActionReasons(
        [...bySpu.entries()].map(([videoId, v]) => ({ videoId, note: videoActionNote(v.cost, v.orders) }))
      ),
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
    if (action === "ADD") {
      // Khách khôi phục tay → luật tự động chỉ gắn cờ, KHÔNG loại lại video đó trong 30 ngày.
      const now = new Date();
      for (const [videoId, v] of bySpu) {
        await prisma.tiktokAdsVideoWatch.upsert({
          where: { adsCampaignId_videoId: { adsCampaignId: campaign.id, videoId } },
          update: { restoredByUserAt: now, violationSince: "" },
          create: {
            adsCampaignId: campaign.id,
            videoId,
            spuId: [...v.spuIds][0] ?? "",
            firstSeenOn: vnDateStr(0),
            restoredByUserAt: now,
          },
        });
      }
    }
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

// ============================================================
// LOẠI VIDEO TỰ ĐỘNG — cấu hình THEO TỪNG CHIẾN DỊCH (anh Trung 18/09/2026)
// ============================================================

/** Tóm tắt trạng thái tự động của một chiến dịch cho UI (chip + dòng lượt gần nhất). */
function autoStatusOf(rule: { mode: string; lastRunOn: string; lastRunSummary: unknown }) {
  const s = (rule.lastRunSummary ?? null) as Record<string, unknown> | null;
  return {
    mode: rule.mode as AutoRuleMode,
    lastRunOn: rule.lastRunOn || null,
    lastRunSummary: s && typeof s.summary === "string" ? s.summary : null,
    lastRunExclude: s && typeof s.exclude === "number" ? s.exclude : 0,
    lastRunSkipped: s && typeof s.skipped === "string" ? s.skipped : null,
    lastRunError: s && typeof s.error === "string" ? s.error : null,
  };
}

async function ownedTiktokCampaign(ownerId: string, id: string) {
  return prisma.adsCampaign.findFirst({
    where: { id, channel: { userId: ownerId, channelName: ChannelName.TIKTOK } },
    select: {
      id: true,
      campaignId: true,
      name: true,
      channelId: true,
      status: true,
      roasTarget: true,
      tiktokAutoRule: true,
    },
  });
}

adsTiktokRouter.get("/campaigns/:id/auto-rule", async (req: AuthRequest, res, next) => {
  try {
    const campaign = await ownedTiktokCampaign(req.ownerId!, String(req.params.id));
    if (!campaign) {
      res.status(404).json({ error: "Không tìm thấy chiến dịch" });
      return;
    }
    const roasTarget = campaign.roasTarget != null ? Number(campaign.roasTarget) : null;
    const rule = campaign.tiktokAutoRule;
    // Chiến dịch khác cùng gian — cho nút "Sao chép sang chiến dịch khác".
    const others = await prisma.adsCampaign.findMany({
      where: { channelId: campaign.channelId, id: { not: campaign.id } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, status: true, tiktokAutoRule: { select: { mode: true } } },
    });
    res.json({
      configured: rule != null,
      mode: (rule?.mode ?? "off") as AutoRuleMode,
      config: rule ? ruleRowToConfig(rule) : defaultAutoRuleFor(roasTarget),
      /** ROI mục tiêu TikTok đang đặt cho campaign (để popup gợi ý). */
      roasTarget,
      /** ROI hòa vốn của chiến dịch — popup nhắc khi ROI mục tiêu / mức loại đặt DƯỚI hòa vốn. */
      breakeven: breakevenForUi(
        (await computeTiktokAdsBreakeven({ id: campaign.channelId, userId: req.ownerId! }).catch(() => null))?.byCampaignRowId.get(campaign.id)
      ),
      status: rule ? autoStatusOf(rule) : null,
      lastRun: (rule?.lastRunSummary as Record<string, unknown> | null) ?? null,
      others: others.map((o) => ({ id: o.id, name: o.name, status: o.status, mode: (o.tiktokAutoRule?.mode ?? "off") as AutoRuleMode })),
    });
  } catch (err) {
    next(err);
  }
});

adsTiktokRouter.put("/campaigns/:id/auto-rule", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const campaign = await ownedTiktokCampaign(req.ownerId!, String(req.params.id));
    if (!campaign) {
      res.status(404).json({ error: "Không tìm thấy chiến dịch" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = AUTO_RULE_MODES.includes(body.mode as AutoRuleMode) ? (body.mode as AutoRuleMode) : "off";
    // RÀO CỨNG (anh Trung 18/09): phải DIỄN TẬP ít nhất 1 ngày — tức đã có một lượt chấm
    // hằng ngày thật (lastRunOn) — mới được bật Tự loại thật. Chạy thử tại chỗ KHÔNG tính.
    // Lý do: khách bật thật ngay, mất tiền rồi đổ cho Hubsell; bắt họ nhìn thấy máy định
    // loại gì qua một lượt thật trước.
    if (mode === "live" && !campaign.tiktokAutoRule?.lastRunOn) {
      res.status(409).json({
        error:
          "Chiến dịch chưa diễn tập ngày nào. Hãy để chế độ Diễn tập, đợi lượt chấm sau 12h trưa (chuông sẽ báo video máy định loại), xem thấy đúng rồi mới bật Tự loại thật.",
      });
      return;
    }
    const roasTarget = campaign.roasTarget != null ? Number(campaign.roasTarget) : null;
    const base = campaign.tiktokAutoRule ? ruleRowToConfig(campaign.tiktokAutoRule) : defaultAutoRuleFor(roasTarget);
    const cfg = sanitizeAutoRuleConfig(body, base);
    const data = { mode, ...cfg };
    const rule = await prisma.tiktokAdsAutoRule.upsert({
      where: { adsCampaignId: campaign.id },
      update: data,
      create: { adsCampaignId: campaign.id, ...data },
    });
    res.json({ ok: true, mode: rule.mode as AutoRuleMode, config: ruleRowToConfig(rule), status: autoStatusOf(rule) });
  } catch (err) {
    next(err);
  }
});

// CHẠY THỬ: chấm điểm bằng cấu hình trong body trên số thật của TikTok, KHÔNG ghi sổ,
// không gọi lệnh loại. Bảng theo dõi video vẫn được cập nhật trạng thái (đó là việc
// theo dõi thường ngày, vô hại). 3+ call sàn nên chỉ chạy khi người dùng bấm.
adsTiktokRouter.post("/campaigns/:id/auto-rule/preview", async (req: AuthRequest, res, next) => {
  try {
    const campaign = await ownedTiktokCampaign(req.ownerId!, String(req.params.id));
    if (!campaign) {
      res.status(404).json({ error: "Không tìm thấy chiến dịch" });
      return;
    }
    const scope = await getTiktokAdsScope(campaign.channelId);
    if (!scope) {
      res.status(409).json({ error: "Gian chưa kết nối quảng cáo TikTok hoặc kết nối đã hết hiệu lực." });
      return;
    }
    const roasTarget = campaign.roasTarget != null ? Number(campaign.roasTarget) : null;
    const base = campaign.tiktokAutoRule ? ruleRowToConfig(campaign.tiktokAutoRule) : defaultAutoRuleFor(roasTarget);
    const cfg = sanitizeAutoRuleConfig((req.body ?? {}) as Record<string, unknown>, base);
    const today = vnDateStr(0);
    try {
      const track = await trackCampaignVideos(scope, campaign, today);
      const bundle = await buildAutoPlan(scope, campaign, cfg, track, today);
      const plan = bundle.plan;
      const pick = (a: { videoId: string; spuId: string; cost: number; orders: number; gmv: number; reason: string; verdict: string }) => ({
        videoId: a.videoId,
        spuId: a.spuId,
        cost: a.cost,
        orders: a.orders,
        gmv: a.gmv,
        roi: a.cost > 0 ? a.gmv / a.cost : null,
        verdict: a.verdict,
        reason: a.reason,
      });
      res.json({
        config: cfg,
        windowFrom: bundle.windowFrom,
        windowTo: bundle.windowTo,
        summary: summarizeAutoPlan(plan, cfg),
        counts: plan.counts,
        excludeSpend: plan.excludeSpend,
        excludeOrders: plan.excludeOrders,
        exclude: plan.exclude.map(pick),
        heldByCap: plan.heldByCap.map(pick),
        heldByFloor: plan.heldByFloor.map(pick),
        grace: plan.assessments.filter((a) => a.verdict === "grace").map(pick),
        flag: plan.assessments.filter((a) => a.verdict === "flag").map(pick),
        protected: plan.assessments.filter((a) => a.verdict === "protected").map(pick),
        tracking: { seen: track.seen, newVideos: track.newVideos, graduated: track.graduated, relearning: track.relearning },
      });
    } catch (err) {
      await recordTiktokAdsFailure(scope.linkId, err);
      res.status(502).json({ error: `Không đọc được số từ TikTok: ${(err as Error).message}` });
    }
  } catch (err) {
    next(err);
  }
});

// ĐỐI CHIẾU DIỄN TẬP (anh Trung 18/09 — căn cứ để quyết bật Tự loại thật): những video máy
// ĐỊNH loại trong các lượt diễn tập, từ hôm sau ngày định loại tới nay tiêu bao nhiêu, ra mấy
// đơn. Đọc sổ PLANNED (DB) → chưa có lượt nào định loại gì thì trả rỗng, KHÔNG gọi sàn;
// có thì 2 call (sản phẩm + video×ngày). Luật thuần ở integrations/tiktok-ads/backtest.ts.
const BACKTEST_MAX_PLANS = 60;

adsTiktokRouter.get("/campaigns/:id/auto-rule/backtest", async (req: AuthRequest, res, next) => {
  try {
    const campaign = await ownedTiktokCampaign(req.ownerId!, String(req.params.id));
    if (!campaign) {
      res.status(404).json({ error: "Không tìm thấy chiến dịch" });
      return;
    }
    const roasTarget = campaign.roasTarget != null ? Number(campaign.roasTarget) : null;
    const cfg = campaign.tiktokAutoRule ? ruleRowToConfig(campaign.tiktokAutoRule) : defaultAutoRuleFor(roasTarget);
    const marks = { roiTarget: cfg.roiTarget, hardRoi: cfg.roiTarget * (cfg.roiHardPct / 100), minSpend: cfg.minSpend };
    const today = vnDateStr(0);

    const logs = await prisma.adsActionLog.findMany({
      where: { adsCampaignId: campaign.id, action: VIDEO_ACTION_EXCLUDE, verdict: VIDEO_VERDICT_AUTO, mode: "dry_run", status: "PLANNED" },
      orderBy: { createdAt: "desc" },
      take: BACKTEST_MAX_PLANS,
      select: { referenceId: true, reasons: true, createdAt: true },
    });
    const plans: DryRunPlan[] = logs.map((l) => {
      // referenceId "ttauto-{rowId}-{YYYY-MM-DD}" mang ngày VN của lượt; thiếu thì suy từ giờ ghi sổ.
      const tail = (l.referenceId ?? "").slice(-10);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(tail) ? tail : new Date(l.createdAt.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
      return { date, videos: parseVideoActionReasons(l.reasons).videos };
    });

    const wanted = backtestStartDate(plans, today);
    if (!wanted) {
      res.json({ ...buildDryRunBacktest(plans, [], cfg, today), marks, from: null, to: today, truncated: false, planDays: plans.length });
      return;
    }
    const scope = await getTiktokAdsScope(campaign.channelId);
    if (!scope) {
      res.status(409).json({ error: "Gian chưa kết nối quảng cáo TikTok hoặc kết nối đã hết hiệu lực." });
      return;
    }
    // Sàn chỉ cho 30 ngày khi có chiều ngày → diễn tập lâu hơn thì phần đầu bị cắt (FE nói rõ).
    const floor = clampGmvMaxRange({ fallbackDays: GMV_MAX_DAILY_MAX_RANGE_DAYS }, today).startDate;
    const from = wanted < floor ? floor : wanted;
    const range = { accessToken: scope.accessToken, advertiserId: scope.advertiserId, storeId: scope.storeId, startDate: from, endDate: today };
    try {
      const products = await fetchGmvMaxCampaignProducts(range, campaign.campaignId);
      const spuIds = products.map((p) => p.spuId).filter(Boolean);
      const dayRows =
        spuIds.length > 0
          ? await fetchGmvMaxCampaignVideoDays(range, campaign.campaignId, spuIds, [...GMV_MAX_LIVE_VIDEO_STATUSES, GMV_MAX_EXCLUDED_STATUS])
          : [];
      res.json({ ...buildDryRunBacktest(plans, dayRows, cfg, today), marks, from, to: today, truncated: wanted < floor, planDays: plans.length });
    } catch (err) {
      await recordTiktokAdsFailure(scope.linkId, err);
      res.status(502).json({ error: `Không đọc được số từ TikTok: ${(err as Error).message}` });
    }
  } catch (err) {
    next(err);
  }
});

// SAO CHÉP cấu hình sang chiến dịch khác cùng gian. Chế độ "live" KHÔNG sao chép
// (đích nhận "dry_run") — bật thật phải là quyết định riêng cho từng chiến dịch.
adsTiktokRouter.post("/campaigns/:id/auto-rule/copy", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const campaign = await ownedTiktokCampaign(req.ownerId!, String(req.params.id));
    if (!campaign?.tiktokAutoRule) {
      res.status(404).json({ error: "Chiến dịch chưa có cấu hình để sao chép" });
      return;
    }
    const targetIds = (Array.isArray(req.body?.targetIds) ? req.body.targetIds : []).map(String).filter((x: string) => x && x !== campaign.id);
    const targets = await prisma.adsCampaign.findMany({
      where: { id: { in: targetIds }, channelId: campaign.channelId },
      select: { id: true, name: true },
    });
    const src = campaign.tiktokAutoRule;
    const mode: AutoRuleMode = src.mode === "live" ? "dry_run" : (src.mode as AutoRuleMode);
    const data = { mode, ...ruleRowToConfig(src) };
    for (const t of targets) {
      await prisma.tiktokAdsAutoRule.upsert({
        where: { adsCampaignId: t.id },
        update: data,
        create: { adsCampaignId: t.id, ...data },
      });
    }
    res.json({
      ok: true,
      copied: targets.length,
      message:
        targets.length === 0
          ? "Không có chiến dịch nào được chọn."
          : `Đã sao chép sang ${targets.length} chiến dịch${src.mode === "live" ? " (ở chế độ Diễn tập — bật Tự loại thật riêng cho từng chiến dịch)" : ""}.`,
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
