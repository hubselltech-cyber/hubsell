// ============================================================
// TẦNG ADS THEO GIAN — xung (tầng A) + lịch sử (tầng B) cho Shopee / Lazada /
// TikTok GMV Max. Tách khỏi workers/order-auto-sync.ts ngày 19/10/2026 (lát 1
// "tách khoang", docs/ADS-NHIP-CANH-BAO.md mục 13): worker ads-lane.ts nhặt
// gian đến hạn ads với vé riêng (Channel.adsLockedAt) nên Ads bị chặn / chậm
// không giữ chỗ của đơn, tồn, dòng tiền. Đường lui ADS_LANE=0: order-auto-sync
// gọi lại hai hàm này trong vòng của nó như trước 19/10.
//
// Hai cửa vào:
//   · runAdsPulse(channel)   — xung: cấu hình campaign + số hôm nay + ví → Trợ lý
//                              tự thực thi + chuông. Trả hạn xung kế (phút).
//   · runAdsHistory(channel) — lịch sử: cửa sổ 7 ngày / 30 ngày khi vừa nối.
//                              Trả true khi kéo được số (ghi lastAdsSyncAt).
// Nhịp: config/ads-cadence.ts. Van an toàn theo app: services/api-budget.ts.
// ============================================================

import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { syncShopeeAdsSpend } from "../integrations/shopee/ads-spend";
import { syncShopeeAdsCampaigns, syncShopeeAdsPerfWindow } from "../integrations/shopee/ads-campaigns";
import { syncLazadaAdsCampaigns } from "../integrations/lazada/ads-campaigns";
import { autoExecuteTouched, runAdsAutoExecute } from "../integrations/shopee/ads-auto-execute";
import { HUBSELL_ADS_APP_LABEL, hasShopeeAdsAccess } from "../integrations/hubsell-ads";
import { adsItemSignalsDue, syncShopeeAdsItemSignals } from "../integrations/shopee/ads-item-signals";
import { scanOpsAlerts } from "../services/ops-alerts";
import { ADS_BACKFILL_DAYS, ADS_SYNC_DAYS_BACK } from "../services/sync-schedule";
import { ADS_CADENCE } from "../config/ads-cadence";
import { isApiBudgetError } from "../services/api-budget";
import { adsPriorityOf, pulseMinFor, type AdsPriority } from "../services/ads-demand";
import { normalizeAssistantConfig } from "../integrations/shopee/ads-assistant-rules";
import { pulseShopeeAds, syncShopeeAutoTopUpFlag } from "../integrations/shopee/ads-pulse";
import { pulseLazadaAds } from "../integrations/lazada/ads-pulse";
import { syncShopeeGms } from "../integrations/shopee/ads-gms";
import { vnDateKey } from "../lib/ads-dates";
import { isTiktokAdsConfigured } from "../integrations/tiktok-ads/config";
import { syncTiktokAdsCampaigns, verifyTiktokAdsLink } from "../integrations/tiktok-ads/sync";
import { autoRunDue, dailyRunOffsetMin, runTiktokAdsDaily } from "../integrations/tiktok-ads/auto-run";
import { runTiktokAdviceAlerts } from "../integrations/tiktok-ads/advice-alerts";

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Gian bị sàn chặn ở lượt này: "shop" = 429 tầng shop (lát 2: gian lùi riêng), "app" = cầu dao app đang đóng. */
export type AdsRateLimited = "shop" | "app" | null;

/** Kết quả một XUNG ads: hạn xung kế tiếp (phút) + có kéo được số hay không + bị chặn hay không. */
export interface AdsPulseResult {
  delayMin: number;
  synced: boolean;
  rateLimited?: AdsRateLimited;
  /** Thiết kế 13.9 bước A: cổng gọi sàn bảo "quay lại sau ngần này ms" → làn xếp lại gian, không bậc, không cầu dao. */
  deferMs?: number;
  /** Bước B: lớp ưu tiên vừa tính (Shopee) → làn ghi Channel.adsPriority. */
  priority?: AdsPriority;
  /**
   * 13.9 A2: xung Shopee bị cổng hoãn ở bước này (SHOPEE_PULSE_STEP) → làn ghi Channel.adsPulseStep, lượt sau chạy
   * tiếp từ đó; 0 = xung xong (xóa mốc dở); undefined = không đụng cột (Lazada/TikTok, lỗi khác).
   */
  resumeStep?: number;
}

/** Bước B: tùy chọn một lượt xung. */
export interface AdsPulseOptions {
  /** Lượt lịch sử vừa kéo cửa sổ 30 ngày (có hôm nay) ngay trước → xung bỏ 2 lệnh "hôm nay" (gộp lệnh, I6). */
  skipToday?: boolean;
  /** 13.9 A2: chạy tiếp từ bước này (Channel.adsPulseStep còn tươi). */
  resumeFrom?: number;
}

/**
 * 13.9 A2 — sàn hoãn bao lâu thì làn xếp lại gian bấy lâu, nhưng có SÀN theo lý do (hàm thuần):
 *   · rate_limit (sàn 429, khóa gian × endpoint đã lùi ≥ 60 s): tối thiểu DEFER_AFTER_429_MIN — trước 22/10 sàn 1' làm
 *     gian thử lại mỗi phút rồi dính lại (HPGear VN 4 lần liền);
 *   · throttled (chờ lượt GCRA của chính mình) / hard_app: đúng waitMs (làn còn sàn 1' theo nhịp nhặt vé).
 */
export function deferFloorMs(reason: "throttled" | "rate_limit" | "hard_app" | null, waitMs: number, after429Min = ADS_CADENCE.DEFER_AFTER_429_MIN): number {
  const w = Math.max(0, waitMs);
  return reason === "rate_limit" ? Math.max(w, after429Min * 60_000) : w;
}

/** Kết quả một lượt LỊCH SỬ ads: kéo được số (ghi lastAdsSyncAt, hạ cờ backfill) + bị chặn hay không. */
export interface AdsHistoryResult {
  synced: boolean;
  rateLimited: AdsRateLimited;
  deferMs?: number;
}

/** Cổng gọi sàn "quay lại sau" không phải lỗi của gian cũng không phải cầu dao → không vào rateLimited. */
function budgetScope(err: unknown): AdsRateLimited {
  if (!isApiBudgetError(err) || err.scope === "gateway_defer") return null;
  return err.scope === "shop_rate_limit" ? "shop" : "app";
}

function deferOf(err: unknown): number | undefined {
  return isApiBudgetError(err) && err.scope === "gateway_defer" ? deferFloorMs(err.deferReason, err.waitMs) : undefined;
}

/** Gian TikTok CHƯA nối quảng cáo: hạn xung/ads đẩy xa 1 ngày (chỉ để không nhặt mỗi tick). */
const TIKTOK_NO_ADS_MIN = 24 * 60;

/** Gian đã log "bỏ qua Ads vì chưa nối Hubsell Ads" — log một lần, không lặp mỗi lượt. */
const adsSkipLogged = new Set<string>();

/**
 * Hạn XUNG ads kế tiếp (phút) — tầng A docs/ADS-NHIP-CANH-BAO.md. Hàm thuần:
 *   · không có quyền Ads API / không campaign chạy và không thấy campaign mới
 *     → xung nhẹ PULSE_NO_CAMPAIGN_MIN (1 call);
 *   · có campaign chạy nhưng 2 ngày không chi → PULSE_IDLE_MIN;
 *   · đang tiêu tiền hoặc vừa thấy campaign mới → PULSE_MIN (Lazada: PULSE_LAZADA_MIN);
 *   · còn campaign do HUBSELL tạm dừng → PULSE_MIN (14/09): phải đọc lại cấu hình
 *     + số nhanh để tự bật lại khi ROAS đạt / thấy người bật lại kịp thời.
 */
export function nextPulseDelayMin(input: {
  channelName: ChannelName;
  adsReady: boolean;
  liveCampaigns: number;
  spentRecently: boolean;
  foundNew: boolean;
  hubsellPaused?: boolean;
  /** Bước B 13.9: nhịp theo sức chứa của lớp gian (services/ads-demand.ts) — chỉ kéo DÀI hơn, không ngắn hơn nhịp nghiệp vụ. */
  pulseMin?: number;
}): number {
  const floor = input.pulseMin ?? 0;
  if (!input.adsReady) return Math.max(ADS_CADENCE.PULSE_NO_CAMPAIGN_MIN, floor);
  const base = Math.max(
    input.channelName === ChannelName.LAZADA ? ADS_CADENCE.PULSE_LAZADA_MIN : ADS_CADENCE.PULSE_MIN,
    floor
  );
  if (input.foundNew || input.hubsellPaused) return base;
  if (input.liveCampaigns === 0) return Math.max(ADS_CADENCE.PULSE_NO_CAMPAIGN_MIN, floor);
  return input.spentRecently ? base : Math.max(ADS_CADENCE.PULSE_IDLE_MIN, floor);
}

// ============================================================
// TẦNG A — XUNG ADS (docs/ADS-NHIP-CANH-BAO.md): cấu hình campaign + số HÔM NAY
// + ví → rồi Trợ lý tự thực thi + quét cảnh báo NGAY. Đây là nhịp quyết định
// độ trễ cảnh báo "cắn tiền" / "ví cạn" (30' Shopee, 60' Lazada).
// Trả về hạn xung kế tiếp (phút) + có kéo được số hay không.
// ============================================================
async function runAdsPulseTier(channel: Channel, opts: AdsPulseOptions = {}): Promise<AdsPulseResult> {
  const isLazada = channel.channelName === ChannelName.LAZADA;
  const adsReady = isLazada ? true : await hasShopeeAdsAccess(channel.id);
  if (!adsReady) {
    if (!adsSkipLogged.has(channel.id)) {
      adsSkipLogged.add(channel.id);
      console.log(
        `[Auto-sync] Bỏ qua Ads gian "${channel.shopName}": chưa ủy quyền ${HUBSELL_ADS_APP_LABEL}`
      );
    }
    return {
      delayMin: nextPulseDelayMin({
        channelName: channel.channelName,
        adsReady: false,
        liveCampaigns: 0,
        spentRecently: false,
        foundNew: false,
        pulseMin: isLazada ? undefined : pulseMinFor(3),
      }),
      synced: false,
      ...(isLazada ? {} : { priority: 3 as const }),
    };
  }
  adsSkipLogged.delete(channel.id);

  // Chế độ xung theo DB (không gọi sàn): có campaign chạy? có chi trong 2 ngày?
  // `watching` = campaign còn đáng theo dõi (chạy/tạm dừng/hẹn giờ). SỰ CỐ 14/09:
  // xung nhẹ từng khóa theo "0 campaign ĐANG CHẠY" → gian mà campaign cuối cùng
  // vừa bị (máy/người) tạm dừng rơi vào xung nhẹ mãi, cấu hình không bao giờ
  // được đọc lại → seller bật lại trên Seller Center mà Hubsell vẫn ghi "Tạm
  // dừng" (ANO 15:28→18:02+), và cờ Hubsell không bao giờ được hòa giải.
  const [liveCampaigns, watching, hubsellPausedCount, recentSpend, assistantRow] = await Promise.all([
    prisma.adsCampaign.count({ where: { channelId: channel.id, status: "ongoing" } }),
    prisma.adsCampaign.count({
      where: { channelId: channel.id, status: { in: ["ongoing", "paused", "scheduled"] } },
    }),
    prisma.adsCampaign.count({ where: { channelId: channel.id, hubsellPausedAt: { not: null } } }),
    prisma.adsCampaignDailyPerf.findFirst({
      where: {
        adsCampaign: { channelId: channel.id },
        date: { gte: new Date(`${vnDateKey(1)}T00:00:00.000Z`) },
        expense: { gt: 0 },
      },
      select: { id: true },
    }),
    // Bước B: lớp 1 cần biết Trợ lý tự thực thi có bật không (một dòng JSON, cùng lượt đọc).
    isLazada ? null : prisma.adsAssistantConfig.findUnique({ where: { channelId: channel.id }, select: { config: true } }),
  ]);
  const spentRecently = recentSpend != null;
  const hubsellPaused = hubsellPausedCount > 0;
  const assistant = isLazada ? null : normalizeAssistantConfig(assistantRow?.config);
  const priority: AdsPriority | undefined = isLazada
    ? undefined
    : adsPriorityOf({
        adsReady: true,
        watching,
        spentRecently,
        autoExecuteOn: !!assistant && assistant.enabled && assistant.autoExecute.mode !== "off",
      });
  // Bước B: nhịp của lớp theo sức chứa (chỉ dài hơn nhịp nghiệp vụ, không ngắn hơn); Lazada chưa qua cổng → nhịp cũ.
  const pulseMin = priority ? pulseMinFor(priority) : undefined;

  let foundNew = false;
  let synced = false;
  let resumeStep: number | undefined;
  try {
    if (isLazada) {
      const r = await pulseLazadaAds(channel);
      synced = true;
      console.log(
        `[Ads-pulse] Lazada "${channel.shopName}": ${r.campaignsUpserted} campaign, ${r.perfTodayUpserted} dòng hôm nay${r.walletEmpty ? ", VÍ HẾT TIỀN" : ""}`
      );
    } else {
      // Xung nhẹ CHỈ khi DB không còn campaign nào đáng theo dõi — campaign tạm
      // dừng vẫn phải đọc lại cấu hình để thấy người bật lại.
      const r = await pulseShopeeAds(channel, { light: watching === 0, skipToday: opts.skipToday, resumeFrom: opts.resumeFrom });
      foundNew = r.newCampaigns > 0;
      synced = r.mode === "full";
      resumeStep = 0;
      if (r.mode === "full") {
        console.log(
          `[Ads-pulse] Shopee "${channel.shopName}": ${r.liveCampaigns} campaign sống (${r.newCampaigns} mới), ${r.perfTodayUpserted} dòng hôm nay, ví ${r.walletBalance ?? "?"}${r.resumedFrom > 1 ? ` (chạy tiếp từ bước ${r.resumedFrom})` : ""}`
        );
      }
    }
  } catch (err) {
    if (isApiBudgetError(err)) {
      // Van an toàn: app đang bị cầu dao / vượt trần → lùi gian, KHÔNG retry. 429 tầng shop: làn Ads (lát 2) tính
      // bậc lùi riêng của gian từ cờ rateLimited; 15' ở đây chỉ còn là đường lui ADS_LANE=0.
      // 13.9 A2: cổng hoãn ở bước k → trả bước để làn ghi, lượt sau chạy tiếp từ k (không hỏi lại số đã có).
      console.warn(`[Ads-pulse] "${channel.shopName}" lùi lịch (${err.scope}${err.pulseStep ? `, dở ở bước ${err.pulseStep}` : ""}): ${err.message}`);
      return {
        delayMin: err.scope === "shop_rate_limit" ? ADS_CADENCE.SHOP_BACKOFF_MIN : Math.max(ADS_CADENCE.PULSE_MIN, pulseMin ?? 0),
        synced: false,
        rateLimited: budgetScope(err),
        deferMs: deferOf(err),
        priority,
        ...(isLazada ? {} : { resumeStep: err.pulseStep ?? 0 }),
      };
    }
    console.error(`[Ads-pulse] Lỗi xung gian "${channel.shopName}":`, (err as Error).message);
  }

  if (synced) {
    // GĐ3 — Trợ lý tự thực thi (mặc định OFF; dry_run = diễn tập; live sau probe)
    // đánh giá ngay trên số vừa kéo, rồi quét cảnh báo để chuông kêu trong nhịp này.
    let actionTouched = false;
    try {
      const act = await runAdsAutoExecute(channel);
      if (act.mode !== "off" && autoExecuteTouched(act)) {
        console.log(
          `[Auto-sync] Trợ lý Ads ${isLazada ? "Lazada " : ""}"${channel.shopName}" (${act.mode}): ${act.planned} diễn tập, ${act.executed} tạm dừng thật, ${act.budgetCut} hạ ngân sách, ${act.resumed} bật lại, ${act.budgetRestored} trả ngân sách, ${act.failed + act.resumeFailed + act.budgetCutFailed + act.budgetRestoreFailed} lỗi, ${act.skippedDone} đã làm hôm nay${act.deferred > 0 ? ", sàn báo quá nhịp — dừng lượt, xung kế thử lại" : ""}`
        );
        // Máy vừa làm gì → ép quét cảnh báo NGAY (bỏ throttle 10') để chuông + thẻ
        // Trung tâm điều hành lên trong cùng nhịp (sự cố 14/09: dừng mà im lặng).
        actionTouched = true;
      }
    } catch (err) {
      console.error(
        `[Auto-sync] Lỗi Trợ lý tự thực thi gian "${channel.shopName}":`,
        (err as Error).message
      );
    }
    await scanOpsAlerts(channel.userId, actionTouched);
  }

  return {
    delayMin: nextPulseDelayMin({
      channelName: channel.channelName,
      adsReady: true,
      liveCampaigns,
      spentRecently,
      foundNew,
      hubsellPaused,
      pulseMin,
    }),
    synced,
    priority,
    ...(resumeStep != null ? { resumeStep } : {}),
  };
}

// ============================================================
// TẦNG B — ADS LỊCH SỬ: kéo lại cửa sổ 7 ngày (sàn chỉnh số muộn); lần đầu /
// vừa nối Hubsell Ads kéo trọn 30 ngày (id list + cấu hình + perf). Không có
// gì seller "cần tức thì" ở đây — xung (tầng A) đã lo cấu hình + hôm nay + ví.
// Trả về true nếu đã kéo được số (ghi lastAdsSyncAt / hạ cờ backfill).
// ============================================================
// ============================================================
// ADS TIKTOK (GMV Max — TikTok Marketing API, CHỈ ĐỌC). Xung = hôm nay + hôm
// qua (1 call); lịch sử = cửa sổ 7 ngày / 30 ngày khi vừa nối (1 call). Không
// ví, không executor, không ghi AdSpend (phí GMV Max đã trừ trong quyết toán
// đơn — xem integrations/tiktok-ads/sync.ts).
// ============================================================
/**
 * LƯỢT HẰNG NGÀY (theo dõi video + xét luật loại tự động): một lần/ngày cho mỗi gian, ở lượt ads ĐẦU TIÊN sau 12h trưa
 * VN (chi phí video TikTok về trễ tới 11h). B5 (18/09): gọi từ CẢ tầng xung (60' khi đang tiêu tiền, 120' khi im) lẫn
 * tầng lịch sử 6h — trước đây chỉ bám tầng 6h nên lượt chấm rơi bất kỳ lúc nào 12h–18h, khách không biết giờ mà xem
 * chuông. Mốc `lastVideoTrackOn` + khóa gian của worker bảo đảm không chạy hai lần một ngày.
 */
const TIKTOK_DAILY_RUN_CONCURRENCY = Math.max(1, Math.trunc(envNumber("ADS_TIKTOK_DAILY_CONCURRENCY", 1)));
let tiktokDailyRunsInFlight = 0;

async function maybeRunTiktokAdsDaily(channel: Channel): Promise<void> {
  const link = await prisma.tiktokAdsStoreLink.findUnique({
    where: { channelId: channel.id },
    select: { lastVideoTrackOn: true },
  });
  if (!link || !autoRunDue(link.lastVideoTrackOn, undefined, undefined, dailyRunOffsetMin(channel.id))) return;
  // Mỗi tiến trình worker chỉ chạy MỘT lượt chấm một lúc: lượt chấm của seller lớn kéo dài nhiều phút, không được để vài lượt
  // như thế chiếm hết các chỗ chạy song song của đồng bộ đơn. Đây là van CÔNG BẰNG chứ không phải khóa đúng-sai (chống chạy
  // hai lần đã có mốc lastVideoTrackOn + khóa gian) — gian bị nhường sẽ chấm ở nhịp xung kế tiếp.
  if (tiktokDailyRunsInFlight >= TIKTOK_DAILY_RUN_CONCURRENCY) return;
  tiktokDailyRunsInFlight++;
  let d: Awaited<ReturnType<typeof runTiktokAdsDaily>>;
  try {
    d = await runTiktokAdsDaily(channel);
  } finally {
    tiktokDailyRunsInFlight--;
  }
  if (d) {
    console.log(
      `[Auto-sync] "${channel.shopName}" ads TikTok lượt ngày: ${d.tracked}/${d.campaigns} chiến dịch theo dõi, ${d.evaluated} xét luật (${d.planned} diễn tập, ${d.executed} loại thật, ${d.failed} lỗi)`
    );
    // Chuông kết luận chiến dịch (15/10/2026): chấm lại campaign-advice cho mọi chiến dịch đang chạy, chuông khi kết luận đổi sang loại
    // có việc phải làm (advice-alerts.ts). Đi sau lượt ngày để mỗi gian một lần mỗi ngày; lỗi không ảnh hưởng lượt ngày.
    try {
      const a = await runTiktokAdviceAlerts(channel);
      if (a.changed > 0) {
        console.log(`[Auto-sync] "${channel.shopName}" nhận định chiến dịch TikTok: ${a.changed}/${a.campaigns} đổi kết luận, ${a.alerted} chuông`);
      }
    } catch (err) {
      console.error(`[Auto-sync] "${channel.shopName}" chuông kết luận TikTok lỗi:`, (err as Error).message);
    }
  }
}

async function runTiktokAdsPulse(channel: Channel): Promise<AdsPulseResult> {
  if (!isTiktokAdsConfigured()) return { delayMin: TIKTOK_NO_ADS_MIN, synced: false };
  try {
    const r = await syncTiktokAdsCampaigns(channel, { daysBack: 2 });
    if (!r.linked) return { delayMin: TIKTOK_NO_ADS_MIN, synced: false };
    // Lượt ngày hỏng không được làm hỏng xung (xung còn lo lịch nhịp kế).
    await maybeRunTiktokAdsDaily(channel).catch((err) =>
      console.error(`[Auto-sync] Lượt ngày ads TikTok lỗi gian "${channel.shopName}":`, (err as Error).message)
    );
    const delayMin =
      r.liveCampaigns === 0
        ? ADS_CADENCE.PULSE_NO_CAMPAIGN_MIN
        : r.spentRecently
          ? ADS_CADENCE.PULSE_TIKTOK_MIN
          : ADS_CADENCE.PULSE_IDLE_MIN;
    return { delayMin, synced: true };
  } catch (err) {
    console.error(`[Auto-sync] Xung ads TikTok lỗi gian "${channel.shopName}":`, (err as Error).message);
    return { delayMin: ADS_CADENCE.PULSE_IDLE_MIN, synced: false };
  }
}

async function runTiktokAdsTier(channel: Channel): Promise<AdsHistoryResult> {
  if (!isTiktokAdsConfigured()) return { synced: false, rateLimited: null };
  const backfill = channel.adsBackfillPending || !channel.lastAdsSyncAt;
  try {
    // Tài khoản quảng cáo TikTok là thực thể rời shop — kiểm lại ai đang giữ
    // quyền GMV Max của gian TRƯỚC khi kéo số (đổi người chạy thuê → tự chuyển / báo).
    const check = await verifyTiktokAdsLink(channel.id);
    if (check === "switched" || check === "no_access") {
      console.log(`[Auto-sync] "${channel.shopName}" ads TikTok: tài khoản quảng cáo của gian đã đổi (${check})`);
    }
    const r = await syncTiktokAdsCampaigns(channel, {
      daysBack: backfill ? ADS_BACKFILL_DAYS : ADS_SYNC_DAYS_BACK,
    });
    if (r.linked && r.campaignsUpserted > 0) {
      console.log(
        `[Auto-sync] "${channel.shopName}" ads TikTok: ${r.campaignsUpserted} campaign GMV Max, ${r.perfDaysUpserted} dòng ngày, ${r.adSpendDaysUpserted} ngày AdSpend`
      );
    }
    // Lưới đỡ: xung thường đã chạy lượt ngày rồi (mốc lastVideoTrackOn chặn chạy lại).
    if (r.linked) await maybeRunTiktokAdsDaily(channel);
    return { synced: r.linked, rateLimited: null };
  } catch (err) {
    console.error(`[Auto-sync] Ads TikTok lỗi gian "${channel.shopName}":`, (err as Error).message);
    return { synced: false, rateLimited: null };
  }
}

async function runAdsTier(channel: Channel): Promise<AdsHistoryResult> {
  const backfill = channel.adsBackfillPending || !channel.lastAdsSyncAt;
  const daysBack = backfill ? ADS_BACKFILL_DAYS : ADS_SYNC_DAYS_BACK;
  // Lát 2: ghi lại lần bị chặn đầu tiên trong lượt (shop thắng app vì là của riêng gian này).
  let rateLimited: AdsRateLimited = null;
  // Bước A 13.9: cổng bảo "quay lại sau" → giữ thời gian chờ dài nhất trong lượt để làn xếp lại lịch sử sớm (không đợi 6 h).
  let deferMs: number | undefined;
  const noteLimit = (err: unknown) => {
    const s = budgetScope(err);
    if (s && rateLimited !== "shop") rateLimited = s;
    const d = deferOf(err);
    if (d != null) deferMs = Math.max(deferMs ?? 0, d);
  };

  if (channel.channelName === ChannelName.LAZADA) {
    // Lazada: adgroup (itemIds) chỉ có ở lượt này; report từng ngày cửa sổ daysBack.
    try {
      const camp = await syncLazadaAdsCampaigns(channel, { daysBack });
      if (camp.campaignsUpserted > 0) {
        console.log(
          `[Auto-sync] Lịch sử Ads Lazada "${channel.shopName}": ${camp.campaignsUpserted} chiến dịch, ${camp.perfDaysUpserted} dòng hiệu suất ${daysBack} ngày`
        );
      }
      return { synced: true, rateLimited: null };
    } catch (err) {
      if (isApiBudgetError(err)) {
        noteLimit(err);
        console.warn(`[Auto-sync] Lịch sử Ads Lazada "${channel.shopName}" lùi lịch: ${err.message}`);
      } else {
        console.error(`[Auto-sync] Lỗi lịch sử Ads Lazada "${channel.shopName}":`, (err as Error).message);
      }
      return { synced: false, rateLimited };
    }
  }

  // ---------- Shopee: chỉ khi gian có quyền Ads API ----------
  if (!(await hasShopeeAdsAccess(channel.id))) return { synced: false, rateLimited: null };

  // Shopee: cửa sổ 30 ngày cùng số call với 7 ngày (một call ≤ 1 tháng) — xem ADS_CADENCE.WINDOW_DAYS_SHOPEE.
  const shopeeDaysBack = backfill ? ADS_BACKFILL_DAYS : ADS_CADENCE.WINDOW_DAYS_SHOPEE;
  let synced = false;
  try {
    const ads = await syncShopeeAdsSpend(channel, { daysBack: shopeeDaysBack });
    synced = true;
    if (ads.daysUpserted > 0 && backfill) {
      console.log(`[Auto-sync] Chi phí Ads Shopee "${channel.shopName}": ${ads.daysUpserted} ngày chi tiêu`);
    }
    // Bước B (gộp lệnh, I6): cờ ví TỰ NẠP đổi hiếm → đọc ở lượt 6 h thay vì mỗi xung 30' (bớt 1 lệnh/xung/gian).
    await syncShopeeAutoTopUpFlag(channel);
  } catch (err) {
    if (isApiBudgetError(err)) {
      noteLimit(err);
      console.warn(`[Auto-sync] Lịch sử Ads Shopee "${channel.shopName}" lùi lịch: ${err.message}`);
      return { synced: false, rateLimited, deferMs };
    }
    console.error(
      `[Auto-sync] Lỗi sync Ads gian "${channel.shopName}" (app có thể chưa bật quyền Ads API):`,
      (err as Error).message
    );
  }
  try {
    if (backfill) {
      const camp = await syncShopeeAdsCampaigns(channel, { daysBack: shopeeDaysBack });
      synced = true;
      console.log(
        `[Auto-sync] Backfill Ads Shopee "${channel.shopName}": ${camp.campaignsUpserted} chiến dịch, ${camp.perfDaysUpserted} dòng hiệu suất ${shopeeDaysBack} ngày`
      );
    } else {
      const w = await syncShopeeAdsPerfWindow(channel, shopeeDaysBack);
      synced = true;
      if (w.perfDaysUpserted > 0) {
        console.log(
          `[Auto-sync] Lịch sử Ads Shopee "${channel.shopName}": ${w.campaigns} campaign, ${w.perfDaysUpserted} dòng hiệu suất ${shopeeDaysBack} ngày`
        );
      }
    }
  } catch (err) {
    if (isApiBudgetError(err)) {
      noteLimit(err);
      console.warn(`[Auto-sync] Lịch sử Ads Shopee "${channel.shopName}" lùi lịch: ${err.message}`);
    } else {
      console.error(
        `[Auto-sync] Lỗi lịch sử campaign Ads gian "${channel.shopName}" (app có thể chưa bật quyền Ads API):`,
        (err as Error).message
      );
    }
  }
  // GMS = GMV Max cấp shop (24/09): eligibility + 2 cửa sổ + từng SP ≈ 4 call/6h, ăn theo lượt
  // lịch sử. Lỗi ở đây không được làm hỏng lượt ads.
  if (synced) {
    try {
      const g = await syncShopeeGms(channel);
      if (g.status === "active") {
        console.log(`[Ads-GMS] "${channel.shopName}": GMV Max cấp shop đang chạy — ${g.reports} cửa sổ, ${g.items} SP có số`);
      }
    } catch (err) {
      if (isApiBudgetError(err)) {
        noteLimit(err);
        console.warn(`[Ads-GMS] "${channel.shopName}" lùi lịch: ${err.message}`);
      } else {
        console.error(`[Ads-GMS] Lỗi GMV Max cấp shop gian "${channel.shopName}":`, (err as Error).message);
      }
    }
  }
  // ĐỢT D: tín hiệu thị trường cho tab Gợi ý chạy ads — 1 lần/ngày/gian, ăn theo lượt
  // lịch sử (6h) nên không thêm lịch riêng. Lỗi ở đây không được làm hỏng lượt ads.
  if (synced) {
    try {
      if (await adsItemSignalsDue(channel.id)) {
        const r = await syncShopeeAdsItemSignals(channel);
        console.log(
          `[Ads-signals] "${channel.shopName}": ${r.extraInfo}/${r.items} SP có lượt xem, ${r.recommended} SP sàn gợi ý, ${r.proposals} ứng viên đủ số${r.errors.length ? ` · lỗi: ${r.errors.slice(0, 3).join(" | ")}` : ""}`
        );
      }
    } catch (err) {
      if (isApiBudgetError(err)) {
        noteLimit(err);
        console.warn(`[Ads-signals] "${channel.shopName}" lùi lịch: ${err.message}`);
      } else {
        console.error(`[Ads-signals] Lỗi "${channel.shopName}":`, (err as Error).message);
      }
    }
  }
  return { synced, rateLimited, deferMs };
}

// ---------- Cửa vào chung cho worker (ads-lane.ts / order-auto-sync.ts) ----------

/** XUNG ads của một gian theo sàn (TikTok GMV Max đi đường riêng). */
export function runAdsPulse(channel: Channel, opts: AdsPulseOptions = {}): Promise<AdsPulseResult> {
  return channel.channelName === ChannelName.TIKTOK ? runTiktokAdsPulse(channel) : runAdsPulseTier(channel, opts);
}

/** LỊCH SỬ ads của một gian theo sàn. synced = kéo được số (ghi lastAdsSyncAt, hạ cờ backfill). */
export function runAdsHistory(channel: Channel): Promise<AdsHistoryResult> {
  return channel.channelName === ChannelName.TIKTOK ? runTiktokAdsTier(channel) : runAdsTier(channel);
}
