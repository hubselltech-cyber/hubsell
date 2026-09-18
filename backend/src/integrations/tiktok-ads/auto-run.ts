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
//      Mỗi lượt chấm thật chốt cấu hình đã dùng (lastRunConfig — B6: Tự loại thật chỉ chạy với cấu hình đã
//      diễn tập) và chỉ chuông khi kết quả ĐỔI so với lượt trước (B8).
//   Giữa hai việc: chốt dòng sổ kẹt SENDING (A3) + soi lệnh loại đã SUCCESS xem sàn có áp dụng thật không (B7).
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
  compareRunDigest,
  daysBetween,
  parseRehearsedConfig,
  planAutoExclusion,
  runChangeLabel,
  runDigestOf,
  summarizeAutoPlan,
  unrehearsedFields,
  videoDataProblem,
  type AutoAssessment,
  type AutoExclusionPlan,
  type AutoRuleConfig,
  type AutoRuleMode,
  type AutoVideoInput,
  type BreakevenInput,
  type HardBasis,
} from "./auto-rules";
import {
  GMV_MAX_LIVE_VIDEO_STATUSES,
  fetchGmvMaxCampaignProducts,
  fetchGmvMaxCampaignVideos,
  type GmvMaxVideoRow,
} from "./report";
import { getTiktokAdsScope, recordTiktokAdsFailure, verifyTiktokAdsLink, type TiktokAdsScope } from "./sync";
import { computeTiktokAdsBreakeven, saveCampaignProductIds } from "./breakeven";
import { reconcileSendingCommands, sendVideoCommand, soakCheckCommands } from "./send-command";

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
    hardBasis: (r.hardBasis === "breakeven" ? "breakeven" : "pct") as HardBasis,
    ruleNoOrderOn: r.ruleNoOrderOn,
    ruleLowRoiOn: r.ruleLowRoiOn,
    ruleCpaOn: r.ruleCpaOn,
    graceOn: r.graceOn,
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
  /** SPU đang lưu của chiến dịch (nguồn nối chiến dịch → SKU cho ROI hòa vốn); thiếu = coi như chưa lưu. */
  itemIds?: string;
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
  // Tiện lượt: ghi lại sản phẩm của chiến dịch cho phép tính ROI hòa vốn (không tốn call nào thêm).
  await saveCampaignProductIds(campaign.id, campaign.itemIds ?? "", spuIds).catch(() => {});
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
  /** Tổng tầng video của cửa sổ (mọi video đang phân phối + thẻ sản phẩm) — đầu vào của chốt chặn số liệu hỏng (A2). */
  videoTier: { cost: number; orders: number };
}

/** Tổng TẦNG CHIẾN DỊCH của cửa sổ, đọc từ DB (đồng bộ riêng với tầng video). null = Hubsell không có dòng nào của khoảng đó. */
export async function campaignTierTotals(adsCampaignId: string, from: string, to: string): Promise<{ spend: number; orders: number } | null> {
  const rows = await prisma.adsCampaignDailyPerf.findMany({
    where: { adsCampaignId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: { expense: true, broadOrder: true },
  });
  if (rows.length === 0) return null;
  return { spend: rows.reduce((s, r) => s + Number(r.expense), 0), orders: rows.reduce((s, r) => s + r.broadOrder, 0) };
}

/** A2: số liệu tầng video của cửa sổ có đáng tin không? "" = ổn; có chữ = lý do phải bỏ lượt. */
export async function autoPlanDataProblem(adsCampaignId: string, bundle: AutoPlanBundle): Promise<string> {
  return videoDataProblem(bundle.videoTier, await campaignTierTotals(adsCampaignId, bundle.windowFrom, bundle.windowTo));
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
  today: string,
  /** ROI hòa vốn của chiến dịch — chỉ cần khi cfg.hardBasis = "breakeven" (thiếu thì luật tự rơi về % mục tiêu). */
  breakeven: BreakevenInput | null = null
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
  const videoTier = { cost: 0, orders: 0 };
  for (const v of rowsWindow) {
    // Thẻ sản phẩm (-1) không phải video nhưng VẪN là một phần số của tầng này → tính vào tổng đối chiếu.
    videoTier.cost += v.cost;
    videoTier.orders += v.orders;
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
  return { plan: planAutoExclusion(inputs, cfg, today, breakeven), inputs, windowFrom, windowTo, videoTier };
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
    select: { id: true, campaignId: true, name: true, channelId: true, status: true, itemIds: true, tiktokAutoRule: true },
  });
  result.campaigns = campaigns.length;

  // Có chiến dịch chọn "mức loại theo hòa vốn" thì tính hòa vốn của gian MỘT LẦN cho cả lượt (đọc DB, không gọi sàn).
  // Hỏng / chưa đủ tin → luật tự rơi về % mục tiêu và ghi lý do vào tóm tắt lượt.
  const needsBreakeven = campaigns.some((c) => c.tiktokAutoRule && c.tiktokAutoRule.mode !== "off" && c.tiktokAutoRule.hardBasis === "breakeven");
  const breakeven = needsBreakeven
    ? await computeTiktokAdsBreakeven({ id: channel.id, userId: channel.userId }).catch((err) => {
        console.error(`[TikTok Ads] Tính ROI hòa vốn lỗi "${channel.shopName}":`, (err as Error).message);
        return null;
      })
    : null;

  for (const c of campaigns) {
    try {
      const track = await trackCampaignVideos(scope, c, today);
      // A3: dòng sổ còn kẹt "đang gửi" (sự cố giữa lúc gửi lệnh) → chốt theo trạng thái THẬT của video vừa đọc, không đoán.
      const liveIds = new Set(track.rows30.map((v) => v.videoId));
      await reconcileSendingCommands(c.id, liveIds).catch((err) =>
        console.error(`[TikTok Ads] Đối chiếu dòng sổ kẹt lỗi "${c.name}":`, (err as Error).message)
      );
      // B7: lệnh LOẠI đã báo thành công (tự động lẫn thủ công) mà video vẫn đang phân phối → sàn từ chối ngầm, phải cho khách biết.
      await reportCommandsNotApplied(c, liveIds, today, channel.userId).catch((err) =>
        console.error(`[TikTok Ads] Kiểm lệnh đã ngấm lỗi "${c.name}":`, (err as Error).message)
      );
      result.tracked++;
      if (track.graduated > 0 || track.relearning > 0 || track.newVideos > 0) {
        console.log(
          `[TikTok Ads] "${channel.shopName}" · "${c.name}": ${track.seen} video, ${track.newVideos} mới, ${track.graduated} ra trường, ${track.relearning} học lại`
        );
      }
      const rule = c.tiktokAutoRule;
      if (!rule || rule.mode === "off") continue;
      const cfg = ruleRowToConfig(rule);
      const bundle = await buildAutoPlan(scope, c, cfg, track, today, breakeven?.byCampaignRowId.get(c.id) ?? null);
      result.evaluated++;
      const outcome = await applyAutoPlan(scope, c, rule, cfg, bundle, today, channel.userId);
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

/** B7 — soi các lệnh loại SUCCESS chưa soi của chiến dịch; có video không ngấm thì chuông (ghi chú đã nằm trên dòng sổ). */
async function reportCommandsNotApplied(campaign: CampaignLite, liveIds: Set<string>, today: string, ownerId: string): Promise<void> {
  const bad = await soakCheckCommands(campaign.id, liveIds, today);
  if (bad.length === 0) return;
  const videos = bad.reduce((n, b) => n + b.notApplied.length, 0);
  const anyAuto = bad.some((b) => b.auto);
  console.warn(`[TikTok Ads] "${campaign.name}": ${videos} video của ${bad.length} lệnh loại vẫn đang phân phối (lệnh không ngấm).`);
  await notify(ownerId, {
    type: "tiktok-ads-auto",
    title: `${campaign.name}: ${videos} video đã ra lệnh loại nhưng TikTok vẫn đang phân phối`,
    body:
      `TikTok báo đã nhận lệnh nhưng ${videos} video vẫn chạy — sàn không áp dụng lệnh cho các video này, hoặc video đã được khôi phục từ Seller Center / TikTok Ads Manager. ` +
      `Mã video nằm ở tab Lịch sử, ngay trên dòng lệnh.` +
      (anyAuto ? " Nếu video còn vi phạm, Trợ lý sẽ xét lại trong lượt chấm hôm nay." : ""),
    link: `/ads/tiktok/campaign?id=${campaign.id}`,
  });
}

/** Ghi kết luận từng video + ân hạn vào bảng theo dõi, ghi sổ lệnh, gọi sàn nếu live. */
export async function applyAutoPlan(
  scope: TiktokAdsScope,
  campaign: CampaignLite,
  rule: Pick<RuleRow, "mode" | "lastRunSummary" | "lastRunConfig">,
  cfg: AutoRuleConfig,
  bundle: AutoPlanBundle,
  today: string,
  ownerId: string
): Promise<ApplyOutcome> {
  const { plan } = bundle;
  // B6 — Tự loại thật CHỈ chạy với cấu hình đã qua một lượt chấm thật. Route PUT đã chặn từ lúc lưu; đây là lớp thứ hai
  // (dòng cũ chưa có lastRunConfig, dữ liệu sửa tay): lượt này chạy như DIỄN TẬP, chốt cấu hình, lượt sau mới loại thật.
  const unrehearsed = rule.mode === "live" && unrehearsedFields(parseRehearsedConfig(rule.lastRunConfig), cfg).length > 0;
  const mode: AutoRuleMode = unrehearsed ? "dry_run" : (rule.mode as AutoRuleMode);
  const rehearsalNote = unrehearsed
    ? "Cấu hình hiện tại chưa qua lượt diễn tập nào nên hôm nay Trợ lý chỉ DIỄN TẬP, chưa loại video; từ lượt chấm kế tiếp mới loại thật."
    : undefined;
  const excludedIds = new Set(plan.exclude.map((a) => a.videoId));
  const link = `/ads/tiktok/campaign?id=${campaign.id}`;

  // A2 — CHỐT CHẶN SỐ LIỆU HỎNG: tầng video báo 0 trong khi tầng chiến dịch có số → BỎ LƯỢT, không ghi kết luận từng
  // video, không loại gì. Cố ý KHÔNG đụng lastRunOn: lượt bị bỏ không được tính là "đã diễn tập 1 ngày" (khách chưa thấy
  // máy định loại gì) — ngày bỏ lượt nằm ngay trong câu lý do.
  const dataProblem = await autoPlanDataProblem(campaign.id, bundle);
  if (dataProblem) {
    const skipped = `${today.slice(8, 10)}/${today.slice(5, 7)}: bỏ lượt, KHÔNG loại video nào — ${dataProblem}. Máy sẽ chấm lại vào ngày mai.`;
    await prisma.tiktokAdsAutoRule.update({
      where: { adsCampaignId: campaign.id },
      data: { lastRunAt: new Date(), lastRunSummary: { mode, summary: skipped, skipped, exclude: 0, windowFrom: bundle.windowFrom, windowTo: bundle.windowTo } },
    });
    await notify(ownerId, { type: "tiktok-ads-auto", title: `${campaign.name}: Trợ lý bỏ lượt chấm hôm nay`, body: skipped, link });
    console.warn(`[TikTok Ads] "${campaign.name}" bỏ lượt chấm: ${dataProblem}`);
    return "skipped";
  }

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
  // B8 — so với lượt trước: kết quả y hệt thì không chuông lại (sổ PLANNED + lastRunSummary vẫn ghi đủ mỗi ngày).
  const prevDigest = runDigestOf(rule.lastRunSummary);
  const change = compareRunDigest(prevDigest, {
    mode,
    excludeIds: plan.exclude.map((a) => a.videoId),
    grace: plan.counts.grace,
    flag: plan.counts.flag,
  });
  const runSummary = {
    mode,
    summary,
    rehearsalNote,
    unchanged: change.changed ? undefined : true,
    excludeIds: plan.exclude.map((a) => a.videoId),
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
    // Mức loại ROI thực dùng hôm nay — hòa vốn đổi theo ngày nên phải chốt vào sổ để sau này trả lời được "vì sao loại".
    hardRoi: Math.round(plan.hard.hardRoi * 100) / 100,
    hardBasis: plan.hard.basis,
    hardFallback: plan.hard.fallbackReason || undefined,
    videos: plan.exclude.slice(0, 50).map((a) => ({ videoId: a.videoId, cost: Math.round(a.cost), orders: a.orders, reason: a.reason })),
  };
  const saveRun = (extra: Record<string, unknown> = {}) =>
    prisma.tiktokAdsAutoRule.update({
      where: { adsCampaignId: campaign.id },
      data: {
        lastRunOn: today,
        lastRunAt: new Date(),
        lastRunSummary: { ...runSummary, ...extra },
        lastRunConfig: { ...cfg } as Prisma.InputJsonObject,
      },
    });

  if (plan.exclude.length === 0) {
    await saveRun();
    if (change.changed && (plan.counts.flag > 0 || plan.counts.grace > 0 || change.removed > 0)) {
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
    [`Trợ lý tự động (${cfg.windowDays} ngày ${bundle.windowFrom}→${bundle.windowTo}, ROI mục tiêu ${cfg.roiTarget}, mức loại ${plan.hard.label}): ${summary}`]
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
    if (change.changed || rehearsalNote) {
      await notify(ownerId, {
        type: "tiktok-ads-auto",
        title: `Diễn tập ${campaign.name}: sẽ loại ${items.length} video${runChangeLabel(prevDigest, change)}`,
        body: rehearsalNote ? `${rehearsalNote} ${summary}` : summary,
        link,
      });
    }
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
  // A3 — GHI SỔ TRƯỚC, GỌI SÀN SAU (send-command.ts): dòng sổ mang đủ video + căn cứ tồn tại TRƯỚC khi TikTok nhận lệnh;
  // referenceId unique của dòng đó cũng chặn gửi lần hai nếu lượt chấm chạy lại trong ngày.
  const sent = await sendVideoCommand({ ...logBase, mode: "live" }, () =>
    updateGmvMaxCreatives(fresh.accessToken, {
      advertiserId: fresh.advertiserId,
      campaignId: campaign.campaignId,
      action: "REMOVE",
      items: items.map((a) => ({ itemId: a.videoId, spuIds: [a.spuId] })),
    })
  );
  if (!sent.ok) {
    const message = sent.error;
    await saveRun({ error: message });
    await notify(ownerId, {
      type: "tiktok-ads-auto",
      title: `${campaign.name}: TikTok từ chối lệnh loại ${items.length} video`,
      body: message,
      link,
    });
    return "failed";
  }
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
