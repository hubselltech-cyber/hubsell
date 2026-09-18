// ============================================================
// TIKTOK ADS — LƯỢT HẰNG NGÀY: THEO DÕI VIDEO + XÉT LUẬT LOẠI TỰ ĐỘNG
//
// Chạy MỖI NGÀY MỘT LẦN cho từng gian đã nối quảng cáo, ở lượt lịch sử 6h đầu
// tiên sau 12h trưa VN (chi phí video của TikTok về trễ tới 11 giờ nên số HÔM
// QUA lúc trưa mới ổn định). Mốc đã chạy ghi ở TiktokAdsStoreLink.lastVideoTrackOn.
//
// Hai việc, theo thứ tự, cho từng chiến dịch ĐANG BẬT của gian:
//   1. THEO DÕI (mọi chiến dịch đang bật, không cần cấu hình): đọc trạng thái
//      từng video (30 ngày, 2 call) → ghi TiktokAdsVideoWatch: lần đầu thấy,
//      chuỗi trạng thái, mốc RA TRƯỜNG (LEARNING → DELIVERING), nhật ký đổi
//      trạng thái. Dữ liệu này tích lũy TRƯỚC khi khách bật luật, và trả lời
//      câu anh Trung hỏi 18/09: sàn có đưa video quay lại LEARNING không.
//   2. XÉT LUẬT (chỉ chiến dịch có TiktokAdsAutoRule mode ≠ off): số cửa sổ
//      = windowDays ngày kết thúc hôm qua; video có mốc ra trường TRONG cửa sổ
//      thì chỉ tính từ mốc đó (gom theo ngày ra trường → 1 call mỗi ngày khác
//      nhau, tối đa windowDays call). Chấm bằng auto-rules.ts, rồi:
//        dry_run → ghi AdsActionLog mode dry_run status PLANNED, chuông.
//        live    → kiểm quyền TKQC + campaign còn bật → gọi creative/update
//                  REMOVE → AdsActionLog mode live SUCCESS/FAILED, chuông.
//      referenceId "ttauto-{rowId}-{ngày}" unique → một ngày một lệnh mỗi chiến dịch.
//
// Không ném lỗi ra ngoài: lỗi một chiến dịch ghi log rồi đi tiếp chiến dịch khác.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { notify } from "../../services/notifications";
import { vnDateStr } from "../lazada/ads-campaigns";
import { GMV_MAX_CREATIVE_BATCH, updateGmvMaxCreatives } from "./client";
import {
  buildVideoActionReasons,
  VIDEO_ACTION_EXCLUDE,
  videoActionNote,
} from "./action-log";
import {
  AUTO_RULE_DEFAULTS,
  daysBetween,
  planAutoExclusion,
  summarizeAutoPlan,
  type AutoAssessment,
  type AutoExclusionPlan,
  type AutoRuleConfig,
  type AutoRuleMode,
  type AutoVideoInput,
} from "./auto-rules";
import {
  GMV_MAX_LIVE_VIDEO_STATUSES,
  fetchGmvMaxCampaignProducts,
  fetchGmvMaxCampaignVideos,
  type GmvMaxVideoRow,
} from "./report";
import { getTiktokAdsScope, recordTiktokAdsFailure, verifyTiktokAdsLink, type TiktokAdsScope } from "./sync";

/** verdict ghi vào AdsActionLog cho lệnh loại tự động (khác "manual"). */
export const VIDEO_VERDICT_AUTO = "auto_exclude";
/** Giờ VN sớm nhất trong ngày được chạy lượt này. */
export const AUTO_RUN_EARLIEST_HOUR = 12;
/** Cửa sổ nhận diện công thần (đơn 30 ngày). */
const GRACE_LOOKBACK_DAYS = 30;
/** Giữ tối đa chừng này dòng nhật ký đổi trạng thái mỗi video. */
const STATUS_LOG_MAX_LINES = 20;

export function vnHourNow(): number {
  return new Date(Date.now() + 7 * 3600_000).getUTCHours();
}

type RuleRow = NonNullable<Prisma.PromiseReturnType<typeof prisma.tiktokAdsAutoRule.findUnique>>;

export function ruleRowToConfig(r: RuleRow): AutoRuleConfig {
  return {
    roiTarget: Number(r.roiTarget),
    windowDays: r.windowDays,
    minSpend: Number(r.minSpend),
    spendNoOrder: Number(r.spendNoOrder),
    roiHardPct: r.roiHardPct,
    maxCpa: r.maxCpa == null ? null : Number(r.maxCpa),
    graceMinOrders: r.graceMinOrders,
    graceDays: r.graceDays,
    maxExcludePerDay: r.maxExcludePerDay,
    minOrderingVideosKeep: r.minOrderingVideosKeep,
  };
}

interface CampaignLite {
  id: string;
  campaignId: string;
  name: string;
  channelId: string;
  status: string;
}

// ------------------------------------------------------------
// 1. THEO DÕI TRẠNG THÁI VIDEO
// ------------------------------------------------------------

export interface TrackResult {
  seen: number;
  newVideos: number;
  graduated: number;
  /** DELIVERING → LEARNING (câu hỏi 18/09: sàn có cho học lại không). */
  relearning: number;
  /** videoId → dòng theo dõi sau khi cập nhật (để bước xét luật dùng luôn). */
  watch: Map<string, WatchLite>;
  spuIds: string[];
  /** Số 30 ngày của từng video (đơn 30 ngày cho công thần + trạng thái). */
  rows30: GmvMaxVideoRow[];
}

export interface WatchLite {
  graduatedOn: string;
  violationSince: string;
  restoredByUserAt: Date | null;
}

/**
 * Đọc trạng thái video 30 ngày của một chiến dịch và ghi bảng theo dõi.
 * 2 call (sản phẩm + video). Trả về những gì bước xét luật cần để khỏi gọi lại.
 */
export async function trackCampaignVideos(scope: TiktokAdsScope, campaign: CampaignLite, today: string): Promise<TrackResult> {
  const yesterday = vnDateStr(1);
  const range30 = {
    accessToken: scope.accessToken,
    advertiserId: scope.advertiserId,
    storeId: scope.storeId,
    startDate: vnDateStr(GRACE_LOOKBACK_DAYS),
    endDate: yesterday,
  };
  const products = await fetchGmvMaxCampaignProducts(range30, campaign.campaignId);
  const spuIds = products.map((p) => p.spuId).filter(Boolean);
  const rows30 =
    spuIds.length > 0
      ? (await fetchGmvMaxCampaignVideos(range30, campaign.campaignId, spuIds, GMV_MAX_LIVE_VIDEO_STATUSES)).filter(
          (v) => v.videoId && v.videoId !== "-1"
        )
      : [];

  const existing = await prisma.tiktokAdsVideoWatch.findMany({
    where: { adsCampaignId: campaign.id, videoId: { in: rows30.map((v) => v.videoId) } },
  });
  const byId = new Map(existing.map((w) => [w.videoId, w]));
  const result: TrackResult = { seen: rows30.length, newVideos: 0, graduated: 0, relearning: 0, watch: new Map(), spuIds, rows30 };

  for (const v of rows30) {
    const w = byId.get(v.videoId);
    if (!w) {
      const created = await prisma.tiktokAdsVideoWatch.create({
        data: {
          adsCampaignId: campaign.id,
          videoId: v.videoId,
          spuId: v.spuId,
          status: v.deliveryStatus,
          statusSince: today,
          firstSeenOn: today,
          lastSeenOn: today,
          // Lần đầu thấy đã DELIVERING → không biết ra trường khi nào ("" = trước khi theo dõi).
          graduatedOn: "",
          statusLog: `${today} ${v.deliveryStatus}`,
        },
      });
      result.newVideos++;
      result.watch.set(v.videoId, { graduatedOn: created.graduatedOn, violationSince: "", restoredByUserAt: null });
      continue;
    }
    const data: Prisma.TiktokAdsVideoWatchUpdateInput = { lastSeenOn: today, spuId: v.spuId };
    if (w.status !== v.deliveryStatus) {
      const line = `${today} ${w.status || "?"}→${v.deliveryStatus}`;
      const lines = [...w.statusLog.split("\n").filter(Boolean), line].slice(-STATUS_LOG_MAX_LINES);
      data.status = v.deliveryStatus;
      data.statusSince = today;
      data.statusLog = lines.join("\n");
      const wasLearning = w.status === "LEARNING" || w.status === "IN_QUEUE";
      if (wasLearning && v.deliveryStatus === "DELIVERING") {
        // RA TRƯỜNG: ghi mốc; nếu từng ra trường rồi lại học lại thì mốc mới thay mốc cũ
        // (đồng hồ đặt lại — đúng ý anh Trung: học xong mới tính).
        data.graduatedOn = today;
        result.graduated++;
      } else if (w.status === "DELIVERING" && wasLearningStatus(v.deliveryStatus)) {
        result.relearning++;
        console.log(`[TikTok Ads] "${campaign.name}" video ${v.videoId}: sàn đưa video học lại (${line})`);
      }
    }
    await prisma.tiktokAdsVideoWatch.update({ where: { id: w.id }, data });
    result.watch.set(v.videoId, {
      graduatedOn: (data.graduatedOn as string | undefined) ?? w.graduatedOn,
      violationSince: w.violationSince,
      restoredByUserAt: w.restoredByUserAt,
    });
  }
  return result;
}

function wasLearningStatus(s: string): boolean {
  return s === "LEARNING" || s === "IN_QUEUE";
}

// ------------------------------------------------------------
// 2. GOM SỐ THEO CỬA SỔ HIỆU LỰC + CHẤM LUẬT
// ------------------------------------------------------------

export interface AutoPlanBundle {
  plan: AutoExclusionPlan;
  inputs: AutoVideoInput[];
  windowFrom: string;
  windowTo: string;
}

/**
 * Dựng đầu vào cho luật: số cửa sổ (windowDays ngày, kết thúc hôm qua); video ra
 * trường TRONG cửa sổ thì lấy số từ ngày ra trường (gom theo ngày → 1 call/ngày).
 * Đây cũng là hàm nút "Chạy thử" của popup dùng (không ghi gì).
 */
export async function buildAutoPlan(
  scope: TiktokAdsScope,
  campaign: CampaignLite,
  cfg: AutoRuleConfig,
  track: TrackResult,
  today: string
): Promise<AutoPlanBundle> {
  const windowTo = vnDateStr(1);
  const windowFrom = vnDateStr(cfg.windowDays);
  const base = { accessToken: scope.accessToken, advertiserId: scope.advertiserId, storeId: scope.storeId };

  const rowsWindow =
    track.spuIds.length > 0
      ? await fetchGmvMaxCampaignVideos(
          { ...base, startDate: windowFrom, endDate: windowTo },
          campaign.campaignId,
          track.spuIds,
          GMV_MAX_LIVE_VIDEO_STATUSES
        )
      : [];
  const numbers = new Map<string, { cost: number; orders: number; gmv: number; days: number }>();
  for (const v of rowsWindow) {
    if (!v.videoId || v.videoId === "-1") continue;
    numbers.set(v.videoId, { cost: v.cost, orders: v.orders, gmv: v.gmv, days: cfg.windowDays });
  }

  // Video ra trường trong cửa sổ → số chỉ tính từ ngày ra trường.
  const byGraduation = new Map<string, Set<string>>();
  for (const v of track.rows30) {
    const g = track.watch.get(v.videoId)?.graduatedOn ?? "";
    if (g && g > windowFrom && g <= windowTo) {
      const set = byGraduation.get(g) ?? new Set<string>();
      set.add(v.videoId);
      byGraduation.set(g, set);
    }
  }
  for (const [g, ids] of byGraduation) {
    const rows = await fetchGmvMaxCampaignVideos(
      { ...base, startDate: g, endDate: windowTo },
      campaign.campaignId,
      track.spuIds,
      GMV_MAX_LIVE_VIDEO_STATUSES
    );
    const days = daysBetween(g, windowTo) + 1;
    for (const r of rows) {
      if (ids.has(r.videoId)) numbers.set(r.videoId, { cost: r.cost, orders: r.orders, gmv: r.gmv, days });
    }
  }

  const inputs: AutoVideoInput[] = track.rows30.map((v) => {
    const n = numbers.get(v.videoId) ?? { cost: 0, orders: 0, gmv: 0, days: cfg.windowDays };
    const w = track.watch.get(v.videoId);
    return {
      videoId: v.videoId,
      spuId: v.spuId,
      deliveryStatus: v.deliveryStatus,
      cost: n.cost,
      orders: n.orders,
      gmv: n.gmv,
      orders30d: v.orders,
      windowDaysUsed: n.days,
      watch: w ? { violationSince: w.violationSince, restoredByUserAt: w.restoredByUserAt } : undefined,
    };
  });
  return { plan: planAutoExclusion(inputs, cfg, today), inputs, windowFrom, windowTo };
}

// ------------------------------------------------------------
// 3. LƯỢT HẰNG NGÀY CHO MỘT GIAN
// ------------------------------------------------------------

export interface AutoRunResult {
  campaigns: number;
  tracked: number;
  evaluated: number;
  planned: number;
  executed: number;
  failed: number;
}

/** Đã tới giờ và hôm nay chưa chạy? */
export function autoRunDue(lastVideoTrackOn: string, today = vnDateStr(0), hour = vnHourNow()): boolean {
  return hour >= AUTO_RUN_EARLIEST_HOUR && lastVideoTrackOn !== today;
}

export async function runTiktokAdsDaily(channel: { id: string; shopName: string; userId: string }): Promise<AutoRunResult | null> {
  const scope = await getTiktokAdsScope(channel.id);
  if (!scope) return null;
  const today = vnDateStr(0);
  const result: AutoRunResult = { campaigns: 0, tracked: 0, evaluated: 0, planned: 0, executed: 0, failed: 0 };

  const campaigns = await prisma.adsCampaign.findMany({
    where: { channelId: channel.id, status: "ongoing" },
    select: { id: true, campaignId: true, name: true, channelId: true, status: true, tiktokAutoRule: true },
  });
  result.campaigns = campaigns.length;

  for (const c of campaigns) {
    try {
      const track = await trackCampaignVideos(scope, c, today);
      result.tracked++;
      if (track.graduated > 0 || track.relearning > 0 || track.newVideos > 0) {
        console.log(
          `[TikTok Ads] "${channel.shopName}" · "${c.name}": ${track.seen} video, ${track.newVideos} mới, ${track.graduated} ra trường, ${track.relearning} học lại`
        );
      }
      const rule = c.tiktokAutoRule;
      if (!rule || rule.mode === "off") continue;
      const cfg = ruleRowToConfig(rule);
      const bundle = await buildAutoPlan(scope, c, cfg, track, today);
      result.evaluated++;
      const outcome = await applyAutoPlan(scope, c, rule.mode as AutoRuleMode, cfg, bundle, today, channel.userId);
      if (outcome === "planned") result.planned++;
      else if (outcome === "executed") result.executed++;
      else if (outcome === "failed") result.failed++;
    } catch (err) {
      await recordTiktokAdsFailure(scope.linkId, err);
      console.error(`[TikTok Ads] Lượt hằng ngày lỗi "${channel.shopName}" · "${c.name}":`, (err as Error).message);
    }
  }

  await prisma.tiktokAdsStoreLink.update({ where: { id: scope.linkId }, data: { lastVideoTrackOn: today } }).catch(() => {});
  return result;
}

type ApplyOutcome = "nothing" | "planned" | "executed" | "failed" | "skipped";

/** Ghi kết luận từng video + ân hạn vào bảng theo dõi, ghi sổ lệnh, gọi sàn nếu live. */
async function applyAutoPlan(
  scope: TiktokAdsScope,
  campaign: CampaignLite,
  mode: AutoRuleMode,
  cfg: AutoRuleConfig,
  bundle: AutoPlanBundle,
  today: string,
  ownerId: string
): Promise<ApplyOutcome> {
  const { plan } = bundle;
  const excludedIds = new Set(plan.exclude.map((a) => a.videoId));

  // Trạng thái theo dõi: kết luận + chuỗi vi phạm liên tục (ân hạn).
  for (const a of plan.assessments) {
    const row = await prisma.tiktokAdsVideoWatch.findUnique({
      where: { adsCampaignId_videoId: { adsCampaignId: campaign.id, videoId: a.videoId } },
      select: { id: true, violationSince: true },
    });
    if (!row) continue;
    await prisma.tiktokAdsVideoWatch.update({
      where: { id: row.id },
      data: {
        lastVerdict: a.verdict,
        lastVerdictOn: today,
        lastReason: a.reason.slice(0, 500),
        violationSince: a.violated ? row.violationSince || today : "",
        ...(a.violated && !row.violationSince ? { spendAtViolation: a.cost } : {}),
      },
    });
  }

  const summary = summarizeAutoPlan(plan, cfg);
  const runSummary = {
    mode,
    summary,
    exclude: plan.exclude.length,
    excludeSpend: Math.round(plan.excludeSpend),
    excludeOrders: plan.excludeOrders,
    grace: plan.counts.grace,
    flag: plan.counts.flag,
    heldByCap: plan.heldByCap.length,
    heldByFloor: plan.heldByFloor.length,
    learning: plan.counts.learning,
    insufficient: plan.counts.insufficient,
    healthy: plan.counts.healthy,
    protected: plan.counts.protected,
    windowFrom: bundle.windowFrom,
    windowTo: bundle.windowTo,
    videos: plan.exclude.slice(0, 50).map((a) => ({ videoId: a.videoId, cost: Math.round(a.cost), orders: a.orders, reason: a.reason })),
  };
  const saveRun = (extra: Record<string, unknown> = {}) =>
    prisma.tiktokAdsAutoRule.update({
      where: { adsCampaignId: campaign.id },
      data: { lastRunOn: today, lastRunAt: new Date(), lastRunSummary: { ...runSummary, ...extra } },
    });

  const link = `/ads/tiktok/campaign?id=${campaign.id}`;
  if (plan.exclude.length === 0) {
    await saveRun();
    if (plan.counts.flag > 0 || plan.counts.grace > 0) {
      await notify(ownerId, {
        type: "tiktok-ads-auto",
        title: `${campaign.name}: ${mode === "live" ? "Trợ lý" : "Diễn tập"} hôm nay không loại video nào`,
        body: summary,
        link,
      });
    }
    return "nothing";
  }

  const referenceId = `ttauto-${campaign.id}-${today}`;
  if (await prisma.adsActionLog.findUnique({ where: { referenceId }, select: { id: true } })) {
    await saveRun({ skipped: "Hôm nay đã có lệnh cho chiến dịch này." });
    return "skipped";
  }

  const items = plan.exclude.slice(0, GMV_MAX_CREATIVE_BATCH);
  const reasons = buildVideoActionReasons(
    items.map((a) => ({ videoId: a.videoId, note: `${videoActionNote(a.cost, a.orders)} · ${a.reason}` })),
    [`Trợ lý tự động (${cfg.windowDays} ngày ${bundle.windowFrom}→${bundle.windowTo}, ROI mục tiêu ${cfg.roiTarget}): ${summary}`]
  );
  const logBase = {
    channelId: campaign.channelId,
    adsCampaignId: campaign.id,
    action: VIDEO_ACTION_EXCLUDE,
    verdict: VIDEO_VERDICT_AUTO,
    reasons,
    referenceId,
  };

  if (mode === "dry_run") {
    await prisma.adsActionLog.create({ data: { ...logBase, mode: "dry_run", status: "PLANNED" } });
    await saveRun();
    await notify(ownerId, {
      type: "tiktok-ads-auto",
      title: `Diễn tập ${campaign.name}: sẽ loại ${items.length} video`,
      body: summary,
      link,
    });
    return "planned";
  }

  // LIVE: kiểm quyền TKQC + chiến dịch còn bật NGAY TRƯỚC lệnh ghi.
  const check = await verifyTiktokAdsLink(campaign.channelId);
  if (check === "no_access") {
    await saveRun({ skipped: "Tài khoản quảng cáo không còn quyền trên gian — chưa loại." });
    return "skipped";
  }
  const fresh = await getTiktokAdsScope(campaign.channelId);
  const live = await prisma.adsCampaign.findUnique({ where: { id: campaign.id }, select: { status: true } });
  if (!fresh || live?.status !== "ongoing") {
    await saveRun({ skipped: "Chiến dịch không còn bật hoặc kết nối quảng cáo hết hiệu lực — chưa loại." });
    return "skipped";
  }
  try {
    await updateGmvMaxCreatives(fresh.accessToken, {
      advertiserId: fresh.advertiserId,
      campaignId: campaign.campaignId,
      action: "REMOVE",
      items: items.map((a) => ({ itemId: a.videoId, spuIds: [a.spuId] })),
    });
  } catch (err) {
    const message = (err as Error).message.slice(0, 1000);
    await prisma.adsActionLog.create({ data: { ...logBase, mode: "live", status: "FAILED", error: message } });
    await saveRun({ error: message });
    await notify(ownerId, {
      type: "tiktok-ads-auto",
      title: `${campaign.name}: TikTok từ chối lệnh loại ${items.length} video`,
      body: message,
      link,
    });
    return "failed";
  }
  await prisma.adsActionLog.create({ data: { ...logBase, mode: "live", status: "SUCCESS" } });
  await saveRun({ executedVideoIds: [...excludedIds] });
  await notify(ownerId, {
    type: "tiktok-ads-auto",
    title: `${campaign.name}: Trợ lý đã loại ${items.length} video`,
    body: summary,
    link,
  });
  return "executed";
}

/** Cấu hình mặc định gợi ý cho một chiến dịch chưa có dòng: ROI mục tiêu lấy từ TikTok nếu có. */
export function defaultAutoRuleFor(roasTarget: number | null): AutoRuleConfig {
  return { ...AUTO_RULE_DEFAULTS, roiTarget: roasTarget != null && roasTarget > 0 ? roasTarget : AUTO_RULE_DEFAULTS.roiTarget };
}

export type { AutoAssessment };
