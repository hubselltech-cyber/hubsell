// ============================================================
// TỰ ĐỘNG ĐỒNG BỘ ĐA SÀN THEO LỊCH TỪNG GIAN — LƯỚI AN TOÀN CẠNH WEBHOOK
//
// 12/09/2026 — ĐẠI TU cho quy mô thương mại (hàng chục ngàn gian, nhiều
// worker, không gián đoạn seller). Trước đây là MỘT vòng for tuần tự qua mọi
// gian mỗi 10 phút: lên vài nghìn gian thì gian cuối danh sách chờ hàng giờ,
// và hai worker sẽ quét trùng. Nay mỗi gian là MỘT VÉ có hạn riêng trên
// Channel (khuôn StockPushJob / DeliveryTrackingTask):
//
//   · nextFastSyncAt   — tầng NHANH: đơn (Shopee+Lazada), phí ước tính Shopee,
//                        đơn hoàn 2 sàn, backfill vận đơn, yêu cầu hóa đơn,
//                        hàng đợi cứu đơn. Nhịp gốc AUTO_SYNC_MINUTES (10'),
//                        GIÃN DẦN ×2 khi lượt quét không thấy biến động
//                        (gian im ắng) tới trần AUTO_SYNC_MAX_MINUTES (60'),
//                        có biến động là về nhịp gốc. Webhook lo real-time,
//                        tầng này chỉ vét sót → gian vắng khách không đáng
//                        tốn quota mỗi 10'.
//   · nextHourlySyncAt — tầng NHỊP GIỜ: đối soát phí thật (Escrow/Finance),
//                        payout/rút ví, quét cảnh báo điều hành.
//   · nextAdsPulseAt   — tầng XUNG ADS (docs/ADS-NHIP-CANH-BAO.md): cấu hình
//                        campaign + số HÔM NAY + ví, mỗi 30' Shopee / 60' Lazada
//                        cho gian đang tiêu tiền (im ắng 120'; chưa có campaign
//                        xung nhẹ 1 call). Ngay sau xung: Trợ lý tự thực thi +
//                        quét cảnh báo → độ trễ cảnh báo "cắn tiền"/"ví cạn".
//   · nextAdsSyncAt    — tầng ADS LỊCH SỬ: kéo lại 7 ngày mỗi 6h (sàn chỉnh số
//                        muộn); lần đầu / vừa nối Hubsell Ads kéo trọn 30 ngày
//                        (adsBackfillPending). Nhịp: config/ads-cadence.ts.
//                        Trang Trợ lý mở mà số cũ >30' hoặc bấm Làm mới → nudge
//                        XUNG về "ngay" (services/sync-schedule.ts).
//
// Vòng đời một vé: tick 20s nhặt gian ĐẾN HẠN (bất kỳ tầng nào) chưa ai cầm,
// CLAIM bằng UPDATE có điều kiện trên syncLockedAt (nhiều worker không nhặt
// trùng), chạy các tầng đến hạn SONG SONG tối đa AUTO_SYNC_CONCURRENCY gian,
// xong ghi hạn kế tiếp + nhả khóa. Worker chết giữa chừng → khóa cũ >15' coi
// như mồ côi, gian được nhặt lại. Mọi sync đều upsert idempotent nên chạy
// lặp vô hại.
//
// TikTok cố ý đứng ngoài: gian hiện tại là mock sandbox không token, webhook
// TikTok thật đã có đường riêng — thêm vào đây khi nối shop TikTok thật.
//
// Cấu hình: AUTO_SYNC_MINUTES (ưu tiên) hoặc SHOPEE_AUTO_SYNC_MINUTES (tương
// thích cũ). Mặc định 10; "0" = tắt toàn bộ.
// ============================================================

import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { isShopeeConfigured } from "../integrations/shopee/config";
import { syncShopeeOrders } from "../integrations/shopee/service";
import {
  syncShopeePendingEscrowEstimates,
  syncShopeeSettlements,
} from "../integrations/shopee/settlements";
import { syncShopeeAdsSpend } from "../integrations/shopee/ads-spend";
import { syncShopeeAdsCampaigns } from "../integrations/shopee/ads-campaigns";
import { syncLazadaAdsCampaigns } from "../integrations/lazada/ads-campaigns";
import { runAdsAutoExecute } from "../integrations/shopee/ads-auto-execute";
import { HUBSELL_ADS_APP_LABEL, hasShopeeAdsAccess } from "../integrations/hubsell-ads";
import { syncShopeeWithdrawals } from "../integrations/shopee/wallet";
import {
  backfillShopeeTrackingCodes,
  syncShopeeReturns,
} from "../integrations/shopee/returns-sync";
import { syncShopeeBuyerInvoiceRequests } from "../integrations/shopee/buyer-invoice";
import { processShopeeDeliveryTracking } from "../integrations/shopee/delivery-fail";
import { isLazadaConfigured } from "../integrations/lazada/config";
import {
  syncLazadaOrders,
  syncLazadaSettlements,
} from "../integrations/lazada/service";
import { syncLazadaPayouts } from "../integrations/lazada/payouts";
import { scanOpsAlerts } from "../services/ops-alerts";
import { syncLazadaReturns } from "../integrations/lazada/returns-sync";
import { ADS_BACKFILL_DAYS, ADS_SYNC_DAYS_BACK } from "../services/sync-schedule";
import { ADS_CADENCE } from "../config/ads-cadence";
import { isApiBudgetError } from "../services/api-budget";
import { pulseShopeeAds } from "../integrations/shopee/ads-pulse";
import { pulseLazadaAds } from "../integrations/lazada/ads-pulse";
import { syncShopeeAdsPerfWindow } from "../integrations/shopee/ads-campaigns";
import { vnDateKey } from "../integrations/shopee/ads-insights";

// ---------- Cấu hình nhịp ----------

const DEFAULT_INTERVAL_MIN = 10;
/** Trần giãn nhịp tầng nhanh cho gian im ắng (phút). */
const DEFAULT_MAX_INTERVAL_MIN = 60;
/** Tầng nhịp giờ. */
const HOURLY_INTERVAL_MIN = 60;
/** Tầng ads LỊCH SỬ (giờ) — nguồn duy nhất config/ads-cadence.ts. */
const DEFAULT_ADS_INTERVAL_HOURS = ADS_CADENCE.FULL_HOURS;
/** Số gian xử lý SONG SONG tối đa trong một worker. */
const DEFAULT_CONCURRENCY = 3;
/** Nhịp nhặt vé (ms). */
const TICK_MS = 20 * 1000;
/** Chạy lượt đầu sớm sau khi boot để không phải đợi trọn một nhịp. */
const FIRST_RUN_DELAY_MS = 15 * 1000;
/** Khóa vé cũ hơn ngưỡng này = worker cầm vé đã chết → nhặt lại. */
const LOCK_STALE_MS = 15 * 60 * 1000;
/** Jitter ±15% trên mọi hạn kế tiếp — gian không bao giờ đồng loạt đến hạn cùng giây. */
const JITTER_RATIO = 0.15;

// ---------- Cửa sổ quét (giữ nguyên từ bản vòng for) ----------

/**
 * Quét đơn có BIẾN ĐỘNG trong N ngày gần nhất (trục update_time, từ 09/08).
 * Trục update phủ cả đơn mới tạo LẪN đơn cũ vừa đổi trạng thái — đặc biệt đơn
 * tạo 1-3 tuần trước mà sàn vừa báo HOÀN, thứ trục create_time cũ bỏ sót khiến
 * trang Đối soát đơn hoàn phải chờ người bấm đồng bộ tay 90 ngày.
 */
const ORDERS_DAYS_BACK = 2;
/**
 * Cửa sổ quét YÊU CẦU HOÀN Shopee (Returns API, trục update_time). Yêu cầu hoàn
 * trên đơn COMPLETED không đổi order_status nên quét đơn ở trên KHÔNG thấy —
 * đây là luồng duy nhất bắt được chúng. Lượt thường quét hẹp; lượt trùng nhịp
 * giờ quét sâu hơn để vét yêu cầu đổi trạng thái muộn (thêm tracking, bị hủy...).
 */
const RETURNS_DAYS_BACK = 2;
const RETURNS_DAYS_BACK_DEEP = 7;
/** Mỗi lượt điền tối đa N mã vận đơn chiều đi còn trống (get_tracking_number). */
const TRACKING_BACKFILL_PER_SWEEP = 30;
/** Cửa sổ sao kê cho lượt đối soát tự động — đơn thường quyết toán trong vài ngày. */
const SETTLE_DAYS_BACK = 7;
/**
 * Cửa sổ quét ĐỢT CHI TIỀN về bank (Shopee rút ví / Lazada payout) — payout
 * chốt theo tuần và trạng thái có thể đổi muộn (unpaid → paid), nên quét rộng
 * 30 ngày; upsert idempotent theo (channelId, externalTxnId) nên quét lặp vô hại.
 */
const PAYOUT_DAYS_BACK = 30;

// ---------- Hàm thuần (export cho vitest) ----------

export interface SyncCadence {
  baseMin: number;
  maxMin: number;
}

/**
 * Hạn quét NHANH kế tiếp theo bậc giãn: có biến động → về bậc 0 (nhịp gốc);
 * không → bậc +1, nhịp ×2 tới trần maxMin (bậc không tăng thêm khi đã chạm
 * trần — tránh số lớn vô nghĩa). `rand` để test truyền số cố định.
 */
export function nextFastSchedule(
  level: number,
  changed: boolean,
  cadence: SyncCadence,
  rand: () => number = Math.random
): { delayMs: number; level: number } {
  let next = changed ? 0 : Math.max(0, level) + 1;
  let minutes = Math.min(cadence.maxMin, cadence.baseMin * 2 ** next);
  if (minutes >= cadence.maxMin) {
    // bậc nhỏ nhất đạt trần
    next = Math.max(0, Math.ceil(Math.log2(cadence.maxMin / cadence.baseMin)));
    minutes = cadence.maxMin;
  }
  return { delayMs: withJitter(minutes * 60 * 1000, rand), level: next };
}

/** Cộng jitter ±JITTER_RATIO để các gian không đồng loạt đến hạn. */
export function withJitter(ms: number, rand: () => number = Math.random): number {
  const factor = 1 + (rand() * 2 - 1) * JITTER_RATIO;
  return Math.round(ms * factor);
}

/** Tầng nào đến hạn với một gian tại thời điểm `now` (null = chưa từng chạy = đến hạn). */
export function dueTiers(
  ch: Pick<Channel, "nextFastSyncAt" | "nextHourlySyncAt" | "nextAdsSyncAt" | "nextAdsPulseAt">,
  now: number
): { fast: boolean; hourly: boolean; ads: boolean; pulse: boolean } {
  const due = (d: Date | null) => !d || d.getTime() <= now;
  return {
    fast: due(ch.nextFastSyncAt),
    hourly: due(ch.nextHourlySyncAt),
    ads: due(ch.nextAdsSyncAt),
    pulse: due(ch.nextAdsPulseAt),
  };
}

/**
 * Hạn XUNG ads kế tiếp (phút) — tầng A docs/ADS-NHIP-CANH-BAO.md. Hàm thuần:
 *   · không có quyền Ads API / không campaign chạy và không thấy campaign mới
 *     → xung nhẹ PULSE_NO_CAMPAIGN_MIN (1 call);
 *   · có campaign chạy nhưng 2 ngày không chi → PULSE_IDLE_MIN;
 *   · đang tiêu tiền hoặc vừa thấy campaign mới → PULSE_MIN (Lazada: PULSE_LAZADA_MIN).
 */
export function nextPulseDelayMin(input: {
  channelName: ChannelName;
  adsReady: boolean;
  liveCampaigns: number;
  spentRecently: boolean;
  foundNew: boolean;
}): number {
  if (!input.adsReady) return ADS_CADENCE.PULSE_NO_CAMPAIGN_MIN;
  const base =
    input.channelName === ChannelName.LAZADA ? ADS_CADENCE.PULSE_LAZADA_MIN : ADS_CADENCE.PULSE_MIN;
  if (input.foundNew) return base;
  if (input.liveCampaigns === 0) return ADS_CADENCE.PULSE_NO_CAMPAIGN_MIN;
  return input.spentRecently ? base : ADS_CADENCE.PULSE_IDLE_MIN;
}

// ---------- Trạng thái worker ----------

let started = false;
/** Gian đang được worker NÀY xử lý — không nhặt lại trong lúc chạy. */
const inFlight = new Set<string>();
/** Gian đã log "bỏ qua Ads vì chưa nối Hubsell Ads" — log một lần, không lặp mỗi lượt. */
const adsSkipLogged = new Set<string>();

let cadence: SyncCadence = { baseMin: DEFAULT_INTERVAL_MIN, maxMin: DEFAULT_MAX_INTERVAL_MIN };
let adsIntervalHours = DEFAULT_ADS_INTERVAL_HOURS;
let concurrency = DEFAULT_CONCURRENCY;

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Khởi động worker (gọi 1 lần từ workers/index.ts — KHÔNG gọi trong test, kẻo
 * test gọi API sàn thật). Timer unref để không giữ process sống khi server tắt.
 */
export function startOrderAutoSync(): void {
  if (started) return;
  started = true;

  const min = Number(
    process.env.AUTO_SYNC_MINUTES ??
      process.env.SHOPEE_AUTO_SYNC_MINUTES ??
      DEFAULT_INTERVAL_MIN
  );
  if (!Number.isFinite(min) || min <= 0) {
    console.log("[Auto-sync] TẮT (AUTO_SYNC_MINUTES=0)");
    return;
  }
  cadence = {
    baseMin: min,
    maxMin: Math.max(min, envNumber("AUTO_SYNC_MAX_MINUTES", DEFAULT_MAX_INTERVAL_MIN)),
  };
  adsIntervalHours = DEFAULT_ADS_INTERVAL_HOURS;
  concurrency = Math.max(1, Math.trunc(envNumber("AUTO_SYNC_CONCURRENCY", DEFAULT_CONCURRENCY)));

  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
  console.log(
    `[Auto-sync] BẬT — lịch theo gian: quét nhanh ${cadence.baseMin}' (giãn tới ${cadence.maxMin}' khi im ắng), nhịp giờ ${HOURLY_INTERVAL_MIN}', XUNG ads Shopee ${ADS_CADENCE.PULSE_MIN}' / Lazada ${ADS_CADENCE.PULSE_LAZADA_MIN}' cho gian đang chi (im ắng ${ADS_CADENCE.PULSE_IDLE_MIN}'), lịch sử ads mỗi ${adsIntervalHours}h (cửa sổ ${ADS_SYNC_DAYS_BACK} ngày, lần đầu ${ADS_BACKFILL_DAYS}), song song ${concurrency} gian, trần ${ADS_CADENCE.APP_QPS} call/s mỗi app Ads`
  );
}

/**
 * Một nhịp: nhặt gian đến hạn (bất kỳ tầng) chưa ai cầm, claim, chạy nền.
 * Chỉ lấy đúng số chỗ trống — không đọc cả bảng.
 */
async function tick(): Promise<void> {
  const free = concurrency - inFlight.size;
  if (free <= 0) return;
  try {
    const now = new Date();
    const stale = new Date(now.getTime() - LOCK_STALE_MS);
    const candidates = await prisma.channel.findMany({
      where: {
        channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA] },
        status: "ACTIVE",
        refreshToken: { not: null },
        ...(inFlight.size > 0 ? { id: { notIn: [...inFlight] } } : {}),
        AND: [
          { OR: [{ syncLockedAt: null }, { syncLockedAt: { lt: stale } }] },
          {
            OR: [
              { nextFastSyncAt: null },
              { nextFastSyncAt: { lte: now } },
              { nextHourlySyncAt: { lte: now } },
              { nextAdsSyncAt: { lte: now } },
              { nextAdsPulseAt: null },
              { nextAdsPulseAt: { lte: now } },
            ],
          },
        ],
      },
      // Gian chưa từng chạy (null) lên trước, rồi gian trễ hạn lâu nhất.
      orderBy: { nextFastSyncAt: { sort: "asc", nulls: "first" } },
      take: free,
    });

    for (const c of candidates) {
      // CLAIM: chỉ thành công nếu syncLockedAt còn đúng như lúc đọc — worker
      // khác vừa cầm thì count = 0, bỏ qua êm.
      const claimed = await prisma.channel.updateMany({
        where: { id: c.id, syncLockedAt: c.syncLockedAt },
        data: { syncLockedAt: now },
      });
      if (claimed.count === 0) continue;
      inFlight.add(c.id);
      void processChannel({ ...c, syncLockedAt: now }).finally(() => inFlight.delete(c.id));
    }
  } catch (err) {
    console.error("[Auto-sync] Lỗi nhặt vé:", (err as Error).message);
  }
}

/** Chạy các tầng đến hạn cho MỘT gian rồi ghi hạn kế tiếp + nhả khóa. */
async function processChannel(channel: Channel): Promise<void> {
  const startedAt = Date.now();
  const tiers = dueTiers(channel, startedAt);
  let changed = false;
  let adsSynced = false;
  let pulse: { delayMin: number; synced: boolean } | null = null;

  try {
    if (channel.channelName === ChannelName.SHOPEE && !isShopeeConfigured()) return;
    if (channel.channelName === ChannelName.LAZADA && !isLazadaConfigured()) return;

    // Tầng nhanh chạy MỌI lượt (rẻ, idempotent) — gian được nhặt vì tầng giờ/ads
    // đến hạn thì tiện vét luôn; cửa sổ sâu khi trùng nhịp giờ.
    changed = await runFastTier(channel, { deep: tiers.hourly });
    // XUNG ads trước tầng giờ: cảnh báo tiền là thứ cần sớm nhất trong lượt.
    if (tiers.pulse) pulse = await runAdsPulseTier(channel);
    if (tiers.hourly) await runHourlyTier(channel);
    if (tiers.ads) adsSynced = await runAdsTier(channel);
  } catch (err) {
    console.error(`[Auto-sync] Lỗi xử lý gian "${channel.shopName}":`, (err as Error).message);
  } finally {
    const now = Date.now();
    const fast = nextFastSchedule(channel.syncBackoffLevel, changed, cadence);
    const adsFresh = adsSynced || pulse?.synced === true;
    await prisma.channel
      .update({
        where: { id: channel.id },
        data: {
          syncLockedAt: null,
          nextFastSyncAt: new Date(now + fast.delayMs),
          syncBackoffLevel: fast.level,
          ...(tiers.hourly
            ? { nextHourlySyncAt: new Date(now + withJitter(HOURLY_INTERVAL_MIN * 60 * 1000)) }
            : {}),
          ...(tiers.ads
            ? { nextAdsSyncAt: new Date(now + withJitter(adsIntervalHours * 60 * 60 * 1000)) }
            : {}),
          ...(pulse
            ? { nextAdsPulseAt: new Date(now + withJitter(pulse.delayMin * 60 * 1000)) }
            : {}),
          ...(adsFresh ? { lastAdsSyncAt: new Date(now) } : {}),
          ...(adsSynced ? { adsBackfillPending: false } : {}),
        },
      })
      .catch((err) =>
        console.error(`[Auto-sync] Không ghi được lịch gian "${channel.shopName}":`, (err as Error).message)
      );
  }
}

// ============================================================
// TẦNG NHANH — đơn, phí ước tính, đơn hoàn, vận đơn, hóa đơn, cứu đơn.
// Trả về true nếu lượt quét đơn thấy biến động (để tính bậc giãn nhịp).
// ============================================================
async function runFastTier(channel: Channel, opts: { deep: boolean }): Promise<boolean> {
  let changed = false;

  // --- Đơn hàng ---
  try {
    if (channel.channelName === ChannelName.SHOPEE) {
      const r = await syncShopeeOrders(channel, {
        daysBack: ORDERS_DAYS_BACK,
        timeRangeField: "update_time",
      });
      changed = r.created > 0 || r.updated > 0;
      if (r.created > 0) {
        console.log(
          `[Auto-sync] Shopee "${channel.shopName}": +${r.created} đơn mới (${r.updated} cập nhật)`
        );
      }
    } else {
      const r = await syncLazadaOrders(channel, {
        daysBack: ORDERS_DAYS_BACK,
        byUpdateTime: true,
      });
      changed = r.created > 0 || r.updated > 0;
      if (r.created > 0) {
        console.log(
          `[Auto-sync] Lazada "${channel.shopName}": +${r.created} đơn mới (${r.updated} cập nhật)`
        );
      }
    }
    // Đồng bộ đơn OK → reset bộ đếm lỗi (nguồn cảnh báo "sàn trễ đồng bộ"
    // tự đóng). Best-effort: lỗi ghi bookkeeping không được chặn lượt quét.
    await prisma.channel
      .update({
        where: { id: channel.id },
        data: { lastSyncAt: new Date(), lastSyncError: null, syncFailCount: 0 },
      })
      .catch(() => {});
  } catch (err) {
    // Lỗi một gian (token hết hạn, sàn chập chờn) không được chặn gian khác.
    const message = (err as Error).message;
    console.error(`[Auto-sync] Lỗi đồng bộ đơn gian "${channel.shopName}":`, message);
    // Đếm lượt lỗi LIÊN TIẾP — detector Trung tâm điều hành báo khi ≥ 3.
    await prisma.channel
      .update({
        where: { id: channel.id },
        data: { lastSyncError: message, syncFailCount: { increment: 1 } },
      })
      .catch(() => {});
    // Gian lỗi coi như "có biến động": giữ nhịp gốc để phục hồi nhanh khi sàn ổn lại.
    changed = true;
  }

  if (channel.channelName === ChannelName.LAZADA) {
    // --- ĐƠN HOÀN Lazada (Reverse Order API) — đọc số của sàn (giải pháp hoàn,
    // tiền hoàn, SKU trả, tracking chiều hoàn) cho Lãi/Lỗ + danh sách kho.
    try {
      const ret = await syncLazadaReturns(channel, {
        daysBack: opts.deep ? RETURNS_DAYS_BACK_DEEP : RETURNS_DAYS_BACK,
      });
      if (ret.flagged > 0 || ret.unflagged > 0 || ret.itemsUpdated > 0) {
        console.log(
          `[Auto-sync] Đơn hoàn Lazada "${channel.shopName}": +${ret.flagged} chờ về tay, ${ret.unflagged} hạ cờ, ${ret.itemsUpdated} dòng SKU trả (${ret.scanned} yêu cầu)`
        );
      }
    } catch (err) {
      console.error(
        `[Auto-sync] Lỗi quét đơn hoàn Lazada "${channel.shopName}":`,
        (err as Error).message
      );
    }
    return changed;
  }

  // ---------- Shopee ----------

  // --- Phí ƯỚC TÍNH cho đơn chờ đối soát: chạy MỌI lượt (chủ shop 06/08: phí
  // đơn mới hiện chậm) nhưng cửa sổ hẹp; lượt trùng nhịp giờ vét rộng hơn.
  // isSettled vẫn false — giữ nhãn "chờ đối soát".
  try {
    const est = await syncShopeePendingEscrowEstimates(channel, {
      daysBack: opts.deep ? SETTLE_DAYS_BACK : ORDERS_DAYS_BACK,
    });
    if (est.updated > 0) {
      console.log(
        `[Auto-sync] Ước tính phí Shopee "${channel.shopName}": ${est.updated}/${est.scanned} đơn chờ đối soát nhận số tạm tính`
      );
    }
  } catch (err) {
    console.error(
      `[Auto-sync] Lỗi ước tính phí gian "${channel.shopName}":`,
      (err as Error).message
    );
  }

  // --- ĐƠN HOÀN Shopee (Returns API) — nguồn duy nhất thấy yêu cầu Trả
  // hàng/Hoàn tiền trên đơn đã COMPLETED, kèm mã vận đơn CHIỀU HOÀN cho kho quét.
  try {
    const ret = await syncShopeeReturns(channel, {
      daysBack: opts.deep ? RETURNS_DAYS_BACK_DEEP : RETURNS_DAYS_BACK,
    });
    if (ret.flagged > 0 || ret.unflagged > 0 || ret.trackingSaved > 0) {
      console.log(
        `[Auto-sync] Đơn hoàn Shopee "${channel.shopName}": +${ret.flagged} chờ về tay, ${ret.unflagged} hạ cờ (yêu cầu hủy), ${ret.trackingSaved} mã vận đơn hoàn, ${ret.ordersFetched} đơn cũ kéo mới`
      );
    }
  } catch (err) {
    console.error(
      `[Auto-sync] Lỗi quét đơn hoàn Shopee "${channel.shopName}":`,
      (err as Error).message
    );
  }
  // Điền dần mã vận đơn CHIỀU ĐI còn trống — có tiết chế quota, ưu tiên đơn mới.
  try {
    const bf = await backfillShopeeTrackingCodes(channel, { limit: TRACKING_BACKFILL_PER_SWEEP });
    if (bf.saved > 0) {
      console.log(
        `[Auto-sync] Vận đơn Shopee "${channel.shopName}": điền ${bf.saved}/${bf.checked} mã còn trống`
      );
    }
  } catch (err) {
    console.error(
      `[Auto-sync] Lỗi backfill vận đơn Shopee "${channel.shopName}":`,
      (err as Error).message
    );
  }
  // KHÁCH YÊU CẦU XUẤT HÓA ĐƠN (24/08): đơn vừa ĐÃ GIAO → hỏi get_buyer_invoice_info
  // lưu thông tin người mua TRƯỚC khi Shopee ẩn (30 ngày). Gian chưa mở tính năng → module tự backoff 24h.
  try {
    const inv = await syncShopeeBuyerInvoiceRequests(channel);
    if (inv.requested > 0 || inv.maskedRetry > 0) {
      console.log(
        `[Auto-sync] Yêu cầu hóa đơn Shopee "${channel.shopName}": +${inv.requested} đơn khách cần hóa đơn, ${inv.none} không yêu cầu, ${inv.maskedRetry} còn che (${inv.scanned} đơn hỏi)`
      );
    }
  } catch (err) {
    console.error(
      `[Auto-sync] Lỗi kéo yêu cầu hóa đơn Shopee "${channel.shopName}" (shop có thể chưa được mở tính năng):`,
      (err as Error).message
    );
  }
  // CỨU ĐƠN GIAO THẤT BẠI — hàng đợi DeliveryTrackingTask (26/08): một call gộp
  // dọn vé → phát vé → nhặt vé đến hạn theo TRẦN call/gian/nhịp.
  try {
    const df = await processShopeeDeliveryTracking(channel);
    if (df.noticed > 0 || df.saved > 0 || df.lost > 0) {
      console.log(
        `[Auto-sync] Cứu đơn Shopee "${channel.shopName}": +${df.noticed} cảnh báo (${df.chatSent} đã nhắn khách, ${df.chatFailed} sàn từ chối, ${df.chatSkipped} bỏ qua), +${df.saved} cứu được, +${df.lost} mất đơn — ${df.ran} call tracking, +${df.enqueued} vé mới, ${df.cleaned} vé dọn`
      );
    }
  } catch (err) {
    console.error(
      `[Auto-sync] Lỗi hàng đợi cứu đơn gian "${channel.shopName}":`,
      (err as Error).message
    );
  }
  return changed;
}

// ============================================================
// TẦNG NHỊP GIỜ — đối soát phí thật, payout/rút ví, cảnh báo điều hành.
// ============================================================
async function runHourlyTier(channel: Channel): Promise<void> {
  if (channel.channelName === ChannelName.LAZADA) {
    // Bọc try riêng (25/08): đối soát lỗi không được nuốt payout đứng sau.
    try {
      const s = await syncLazadaSettlements(channel, { daysBack: SETTLE_DAYS_BACK });
      if (s.ordersUpdated > 0) {
        console.log(
          `[Auto-sync] Đối soát Lazada "${channel.shopName}": ${s.ordersUpdated} đơn nhận số phí thật (${s.transactions} dòng sao kê)`
        );
      }
    } catch (err) {
      console.error(`[Auto-sync] Lỗi đối soát Lazada "${channel.shopName}":`, (err as Error).message);
    }
    // Đợt CHI TIỀN về bank (payout theo kỳ sao kê) → WalletWithdrawal.
    try {
      const po = await syncLazadaPayouts(channel, { daysBack: PAYOUT_DAYS_BACK });
      if (po.created > 0 || po.updated > 0) {
        console.log(
          `[Auto-sync] Payout Lazada "${channel.shopName}": +${po.created} đợt mới, ${po.updated} cập nhật`
        );
      }
    } catch (err) {
      console.error(`[Auto-sync] Lỗi sync payout Lazada "${channel.shopName}":`, (err as Error).message);
    }
  } else if (channel.channelName === ChannelName.SHOPEE) {
    // Bọc try riêng (25/08): đối soát ném lỗi không được nuốt rút ví + cảnh báo.
    try {
      const s = await syncShopeeSettlements(channel, { daysBack: SETTLE_DAYS_BACK });
      if (s.ordersUpdated > 0) {
        console.log(
          `[Auto-sync] Đối soát Shopee "${channel.shopName}": ${s.ordersUpdated} đơn nhận số phí thật (${s.transactions} đơn giải ngân)`
        );
      }
    } catch (err) {
      console.error(`[Auto-sync] Lỗi đối soát Shopee "${channel.shopName}":`, (err as Error).message);
    }
    // Lệnh RÚT VÍ về bank (get_wallet_transaction_list, read-only) → WalletWithdrawal.
    try {
      const wd = await syncShopeeWithdrawals(channel, { daysBack: PAYOUT_DAYS_BACK });
      if (wd.created > 0 || wd.updated > 0) {
        console.log(
          `[Auto-sync] Rút ví Shopee "${channel.shopName}": +${wd.created} lệnh mới, ${wd.updated} cập nhật`
        );
      }
    } catch (err) {
      console.error(
        `[Auto-sync] Lỗi sync rút ví Shopee "${channel.shopName}" (app có thể chưa bật quyền ví):`,
        (err as Error).message
      );
    }
  }

  // KIỂM TOÁN PHÍ SÀN (30/08): quét cảnh báo NGAY SAU đối soát — detectFeeAudit
  // cần chạy cả khi không ai mở Dashboard thì chuông mới chủ động. scanOpsAlerts
  // tự throttle 10'/chủ shop + notify chống trùng 24h; hàm không bao giờ ném lỗi.
  await scanOpsAlerts(channel.userId);
}

// ============================================================
// TẦNG A — XUNG ADS (docs/ADS-NHIP-CANH-BAO.md): cấu hình campaign + số HÔM NAY
// + ví → rồi Trợ lý tự thực thi + quét cảnh báo NGAY. Đây là nhịp quyết định
// độ trễ cảnh báo "cắn tiền" / "ví cạn" (30' Shopee, 60' Lazada).
// Trả về hạn xung kế tiếp (phút) + có kéo được số hay không.
// ============================================================
async function runAdsPulseTier(channel: Channel): Promise<{ delayMin: number; synced: boolean }> {
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
      }),
      synced: false,
    };
  }
  adsSkipLogged.delete(channel.id);

  // Chế độ xung theo DB (không gọi sàn): có campaign chạy? có chi trong 2 ngày?
  const [liveCampaigns, recentSpend] = await Promise.all([
    prisma.adsCampaign.count({ where: { channelId: channel.id, status: "ongoing" } }),
    prisma.adsCampaignDailyPerf.findFirst({
      where: {
        adsCampaign: { channelId: channel.id },
        date: { gte: new Date(`${vnDateKey(1)}T00:00:00.000Z`) },
        expense: { gt: 0 },
      },
      select: { id: true },
    }),
  ]);
  const spentRecently = recentSpend != null;

  let foundNew = false;
  let synced = false;
  try {
    if (isLazada) {
      const r = await pulseLazadaAds(channel);
      synced = true;
      console.log(
        `[Ads-pulse] Lazada "${channel.shopName}": ${r.campaignsUpserted} campaign, ${r.perfTodayUpserted} dòng hôm nay${r.walletEmpty ? ", VÍ HẾT TIỀN" : ""}`
      );
    } else {
      const r = await pulseShopeeAds(channel, { light: liveCampaigns === 0 });
      foundNew = r.newCampaigns > 0;
      synced = r.mode === "full";
      if (r.mode === "full") {
        console.log(
          `[Ads-pulse] Shopee "${channel.shopName}": ${r.liveCampaigns} campaign sống (${r.newCampaigns} mới), ${r.perfTodayUpserted} dòng hôm nay, ví ${r.walletBalance ?? "?"}`
        );
      }
    }
  } catch (err) {
    if (isApiBudgetError(err)) {
      // Van an toàn: app đang bị cầu dao / vượt trần → lùi gian, KHÔNG retry.
      console.warn(`[Ads-pulse] "${channel.shopName}" lùi lịch (${err.scope}): ${err.message}`);
      return { delayMin: err.scope === "shop_rate_limit" ? 15 : ADS_CADENCE.PULSE_MIN, synced: false };
    }
    console.error(`[Ads-pulse] Lỗi xung gian "${channel.shopName}":`, (err as Error).message);
  }

  if (synced) {
    // GĐ3 — Trợ lý tự thực thi (mặc định OFF; dry_run = diễn tập; live sau probe)
    // đánh giá ngay trên số vừa kéo, rồi quét cảnh báo để chuông kêu trong nhịp này.
    try {
      const act = await runAdsAutoExecute(channel);
      if (act.mode !== "off" && (act.planned || act.executed || act.failed)) {
        console.log(
          `[Auto-sync] Trợ lý Ads ${isLazada ? "Lazada " : ""}"${channel.shopName}" (${act.mode}): ${act.planned} diễn tập, ${act.executed} tạm dừng thật, ${act.failed} lỗi, ${act.skippedDone} đã làm hôm nay, ${act.skippedQuota} chạm quota`
        );
      }
    } catch (err) {
      console.error(
        `[Auto-sync] Lỗi Trợ lý tự thực thi gian "${channel.shopName}":`,
        (err as Error).message
      );
    }
    await scanOpsAlerts(channel.userId);
  }

  return {
    delayMin: nextPulseDelayMin({
      channelName: channel.channelName,
      adsReady: true,
      liveCampaigns,
      spentRecently,
      foundNew,
    }),
    synced,
  };
}

// ============================================================
// TẦNG B — ADS LỊCH SỬ: kéo lại cửa sổ 7 ngày (sàn chỉnh số muộn); lần đầu /
// vừa nối Hubsell Ads kéo trọn 30 ngày (id list + cấu hình + perf). Không có
// gì seller "cần tức thì" ở đây — xung (tầng A) đã lo cấu hình + hôm nay + ví.
// Trả về true nếu đã kéo được số (ghi lastAdsSyncAt / hạ cờ backfill).
// ============================================================
async function runAdsTier(channel: Channel): Promise<boolean> {
  const backfill = channel.adsBackfillPending || !channel.lastAdsSyncAt;
  const daysBack = backfill ? ADS_BACKFILL_DAYS : ADS_SYNC_DAYS_BACK;

  if (channel.channelName === ChannelName.LAZADA) {
    // Lazada: adgroup (itemIds) chỉ có ở lượt này; report từng ngày cửa sổ daysBack.
    try {
      const camp = await syncLazadaAdsCampaigns(channel, { daysBack });
      if (camp.campaignsUpserted > 0) {
        console.log(
          `[Auto-sync] Lịch sử Ads Lazada "${channel.shopName}": ${camp.campaignsUpserted} chiến dịch, ${camp.perfDaysUpserted} dòng hiệu suất ${daysBack} ngày`
        );
      }
      return true;
    } catch (err) {
      if (isApiBudgetError(err)) {
        console.warn(`[Auto-sync] Lịch sử Ads Lazada "${channel.shopName}" lùi lịch: ${err.message}`);
      } else {
        console.error(`[Auto-sync] Lỗi lịch sử Ads Lazada "${channel.shopName}":`, (err as Error).message);
      }
      return false;
    }
  }

  // ---------- Shopee: chỉ khi gian có quyền Ads API ----------
  if (!(await hasShopeeAdsAccess(channel.id))) return false;

  let synced = false;
  try {
    const ads = await syncShopeeAdsSpend(channel, { daysBack });
    synced = true;
    if (ads.daysUpserted > 0 && backfill) {
      console.log(`[Auto-sync] Chi phí Ads Shopee "${channel.shopName}": ${ads.daysUpserted} ngày chi tiêu`);
    }
  } catch (err) {
    if (isApiBudgetError(err)) {
      console.warn(`[Auto-sync] Lịch sử Ads Shopee "${channel.shopName}" lùi lịch: ${err.message}`);
      return false;
    }
    console.error(
      `[Auto-sync] Lỗi sync Ads gian "${channel.shopName}" (app có thể chưa bật quyền Ads API):`,
      (err as Error).message
    );
  }
  try {
    if (backfill) {
      const camp = await syncShopeeAdsCampaigns(channel, { daysBack });
      synced = true;
      console.log(
        `[Auto-sync] Backfill Ads Shopee "${channel.shopName}": ${camp.campaignsUpserted} chiến dịch, ${camp.perfDaysUpserted} dòng hiệu suất ${daysBack} ngày`
      );
    } else {
      const w = await syncShopeeAdsPerfWindow(channel, daysBack);
      synced = true;
      if (w.perfDaysUpserted > 0) {
        console.log(
          `[Auto-sync] Lịch sử Ads Shopee "${channel.shopName}": ${w.campaigns} campaign, ${w.perfDaysUpserted} dòng hiệu suất ${daysBack} ngày`
        );
      }
    }
  } catch (err) {
    if (isApiBudgetError(err)) {
      console.warn(`[Auto-sync] Lịch sử Ads Shopee "${channel.shopName}" lùi lịch: ${err.message}`);
    } else {
      console.error(
        `[Auto-sync] Lỗi lịch sử campaign Ads gian "${channel.shopName}" (app có thể chưa bật quyền Ads API):`,
        (err as Error).message
      );
    }
  }
  return synced;
}
