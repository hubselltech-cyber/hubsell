// ============================================================
// LÀN ADS RIÊNG — lát 1 "tách khoang" (docs/ADS-NHIP-CANH-BAO.md mục 13, anh Trung
// chốt 17/10/2026, code 19/10/2026).
//
// Vì sao: trước 19/10 xung ads + lịch sử ads chạy CHUNG slot với đồng bộ đơn
// (order-auto-sync: quét đơn → xung Ads → đối soát → Ads lịch sử, trong
// AUTO_SYNC_CONCURRENCY = 3 slot). Ads chờ token / bị cầu dao chặn = giữ slot
// → đơn và đối soát của gian KHÁC xếp sau; sự cố quảng cáo làm chậm đơn hàng.
//
// Nay: vòng nhặt việc RIÊNG cho hai tầng ads — gian có nextAdsPulseAt /
// nextAdsSyncAt đến hạn — với vé riêng Channel.adsLockedAt và số luồng riêng
// ADS_CONCURRENCY (config/ads-cadence.ts). Hàng chờ vẫn là hai cột lịch trên
// Channel (mỗi gian một dòng, gộp sẵn — nguyên tắc 13.2 #4, KHÔNG pg-boss cho
// từng lệnh API). Hàm tầng giữ nguyên ở workers/ads-tiers.ts.
//
// Đường lui: ADS_LANE=0 → worker này không chạy, order-auto-sync nhặt lại cả
// hai tầng như cũ (adsInOrderSync()). AUTO_SYNC_MINUTES=0 vẫn tắt tất cả.
//
// LÁT 2 — CÁCH LY THEO GIAN (19/10/2026, docs 13.8): gian dính 429 tầng shop
// (xung hoặc lịch sử) lùi RIÊNG: bậc lưu Channel.adsBackoffLevel, hạn lùi
// Channel.adsBackoffUntil = now + SHOP_BACKOFF_MIN × 2^bậc (trần
// SHOP_BACKOFF_MAX_MIN, xáo trộn ±15 %); làn không nhặt gian đang lùi; lượt
// thành công → bậc 0. Cầu dao app đang đóng ("app") không phải lỗi của gian →
// không đổi bậc. Giãn lệnh trong xung: services/api-budget.ts. Lát 3 (AIMD) nối vào đây.
// ============================================================

import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ADS_CADENCE } from "../config/ads-cadence";
import { isShopeeConfigured } from "../integrations/shopee/config";
import { isLazadaConfigured } from "../integrations/lazada/config";
import { isTikTokConfigured } from "../integrations/tiktok/config";
import { runAdsHistory, runAdsPulse, type AdsHistoryResult, type AdsPulseResult } from "./ads-tiers";
import { adsInOrderSync, withJitter } from "./order-auto-sync";

/** Nhịp nhặt vé (ms) — như vòng đơn. */
const TICK_MS = 20 * 1000;
/** Lượt đầu sớm sau boot. */
const FIRST_RUN_DELAY_MS = 20 * 1000;
/** Cổng bảo chờ ngắn hơn một phút thì vẫn xếp lại tối thiểu một phút (nhịp nhặt vé 20 s, khỏi nhặt lại ngay). */
export const DEFER_MIN_MS = 60 * 1000;

// ---------- Hàm thuần (export cho vitest) ----------

/** Hai tầng ads nào đến hạn với một gian tại `now` (null = chưa từng chạy = đến hạn). */
export function dueAdsTiers(
  ch: Pick<Channel, "nextAdsSyncAt" | "nextAdsPulseAt">,
  now: number
): { history: boolean; pulse: boolean } {
  const due = (d: Date | null) => !d || d.getTime() <= now;
  return { history: due(ch.nextAdsSyncAt), pulse: due(ch.nextAdsPulseAt) };
}

/**
 * Điều kiện nhặt vé của làn (hàm thuần để test đọc được): gian đang quét được,
 * chưa ai cầm vé ads (hoặc vé mồ côi), và ít nhất một tầng ads đến hạn.
 */
export function adsCandidateWhere(now: Date, staleBefore: Date, excludeIds: string[]) {
  return {
    channelName: { in: [ChannelName.SHOPEE, ChannelName.LAZADA, ChannelName.TIKTOK] },
    status: "ACTIVE" as const,
    refreshToken: { not: null },
    // Gian ngủ đông: next*At đã đẩy về 2100 (plan-hibernation) — chỉ mục bỏ qua.
    hibernatedAt: null,
    ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    AND: [
      { OR: [{ adsLockedAt: null }, { adsLockedAt: { lt: staleBefore } }] },
      // Lát 2: gian đang lùi vì 429 tầng shop thì không nhặt (hạn xung cũng đã đẩy tới adsBackoffUntil).
      { OR: [{ adsBackoffUntil: null }, { adsBackoffUntil: { lte: now } }] },
      { OR: [{ nextAdsPulseAt: null }, { nextAdsPulseAt: { lte: now } }, { nextAdsSyncAt: { lte: now } }] },
    ],
  };
}

/** Lùi riêng của gian ở bậc `level` (ms): SHOP_BACKOFF_MIN × 2^level, trần SHOP_BACKOFF_MAX_MIN, xáo trộn ±15 %. Hàm thuần. */
export function shopBackoffMs(level: number, rand: () => number = Math.random): number {
  const minutes = Math.min(ADS_CADENCE.SHOP_BACKOFF_MAX_MIN, ADS_CADENCE.SHOP_BACKOFF_MIN * 2 ** Math.max(0, level));
  return withJitter(minutes * 60 * 1000, rand);
}

/** Bậc lùi kế tiếp sau một lần 429 tầng shop: +1, không phình quá bậc đã chạm trần (log2(max/min), làm tròn lên). */
export function nextBackoffLevel(level: number): number {
  const cap = Math.max(0, Math.ceil(Math.log2(ADS_CADENCE.SHOP_BACKOFF_MAX_MIN / ADS_CADENCE.SHOP_BACKOFF_MIN)));
  return Math.min(cap, Math.max(0, level) + 1);
}

/**
 * Giá trị ghi lịch sau một lượt (hàm thuần): hạn kế tiếp có jitter, mốc kéo được số, hạ cờ backfill;
 * LÁT 2: 429 tầng shop ở xung hoặc lịch sử → gian lùi riêng theo bậc (`backoffLevel` hiện tại của gian),
 * hạn xung đẩy tới hết lùi; lượt có kéo được số và không bị chặn → bậc về 0.
 */
export function nextAdsSchedule(
  input: {
    pulse: AdsPulseResult | null;
    history: AdsHistoryResult | null;
    historyRan: boolean;
    backoffLevel?: number;
  },
  now: number,
  rand: () => number = Math.random
): {
  adsLockedAt: null;
  nextAdsPulseAt?: Date;
  nextAdsSyncAt?: Date;
  lastAdsSyncAt?: Date;
  adsBackfillPending?: false;
  adsBackoffLevel?: number;
  adsBackoffUntil?: Date | null;
} {
  const historySynced = input.history?.synced === true;
  const fresh = historySynced || input.pulse?.synced === true;
  const shopLimited = input.pulse?.rateLimited === "shop" || input.history?.rateLimited === "shop";
  const level = Math.max(0, input.backoffLevel ?? 0);
  // Bước A 13.9: cổng gọi sàn bảo "quay lại sau waitMs" → xếp lại đúng ngần ấy (sàn tối thiểu DEFER_MIN_MS cho
  // khớp nhịp nhặt vé), KHÔNG bậc lùi theo gian — khóa đã lùi/hạ nhịp trong DB của cổng, gian không có lỗi.
  const pulseDefer = input.pulse?.deferMs;
  let nextPulseAt = input.pulse
    ? now + withJitter(pulseDefer != null ? Math.max(pulseDefer, DEFER_MIN_MS) : input.pulse.delayMin * 60 * 1000, rand)
    : null;
  let backoff: { adsBackoffLevel: number; adsBackoffUntil: Date | null } | null = null;
  if (shopLimited) {
    const until = now + shopBackoffMs(level, rand);
    backoff = { adsBackoffLevel: nextBackoffLevel(level), adsBackoffUntil: new Date(until) };
    nextPulseAt = Math.max(nextPulseAt ?? 0, until);
  } else if (fresh && level > 0) {
    backoff = { adsBackoffLevel: 0, adsBackoffUntil: null };
  }
  const historyDefer = input.history?.deferMs;
  const nextSyncMs = historyDefer != null ? Math.max(historyDefer, DEFER_MIN_MS) : ADS_CADENCE.FULL_HOURS * 60 * 60 * 1000;
  return {
    adsLockedAt: null,
    ...(nextPulseAt != null ? { nextAdsPulseAt: new Date(nextPulseAt) } : {}),
    ...(input.historyRan ? { nextAdsSyncAt: new Date(now + withJitter(nextSyncMs, rand)) } : {}),
    ...(fresh ? { lastAdsSyncAt: new Date(now) } : {}),
    ...(historySynced ? { adsBackfillPending: false as const } : {}),
    ...(backoff ?? {}),
  };
}

// ---------- Trạng thái worker ----------

let started = false;
/** Gian đang được worker NÀY xử lý — không nhặt lại trong lúc chạy. */
const inFlight = new Set<string>();

export function startAdsLane(): void {
  if (started) return;
  started = true;
  if (adsInOrderSync()) {
    console.log("[Ads-lane] ADS_LANE=0 — đường lui: xung + lịch sử ads chạy trong vòng đồng bộ đơn");
    return;
  }
  const min = Number(process.env.AUTO_SYNC_MINUTES ?? process.env.SHOPEE_AUTO_SYNC_MINUTES ?? 10);
  if (!Number.isFinite(min) || min <= 0) {
    console.log("[Ads-lane] TẮT (AUTO_SYNC_MINUTES=0)");
    return;
  }
  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
  console.log(
    `[Ads-lane] BẬT — làn Ads riêng: Ads Shopee ${ADS_CADENCE.GATEWAY ? "QUA CỔNG GỌI SÀN (GCRA app×endpoint, 13.9 bước A)" : "qua withApiBudget (ADS_GATEWAY=0)"}, song song ${ADS_CADENCE.CONCURRENCY} gian, lùi riêng gian dính 429 ${ADS_CADENCE.SHOP_BACKOFF_MIN}'→${ADS_CADENCE.SHOP_BACKOFF_MAX_MIN}', giãn lệnh trong xung ${ADS_CADENCE.SHOP_CALL_GAP_SEC}s, XUNG Shopee ${ADS_CADENCE.PULSE_MIN}' / Lazada ${ADS_CADENCE.PULSE_LAZADA_MIN}' / TikTok ${ADS_CADENCE.PULSE_TIKTOK_MIN}' cho gian đang chi (im ắng ${ADS_CADENCE.PULSE_IDLE_MIN}'), lịch sử mỗi ${ADS_CADENCE.FULL_HOURS}h (cửa sổ ${ADS_CADENCE.WINDOW_DAYS} ngày, lần đầu ${ADS_CADENCE.BACKFILL_DAYS}), vé mồ côi sau ${ADS_CADENCE.LOCK_STALE_MIN}', trần ${ADS_CADENCE.APP_QPS} call/s mỗi app`
  );
}

/** Một nhịp: nhặt gian đến hạn ads chưa ai cầm, claim bằng adsLockedAt, chạy nền. */
async function tick(): Promise<void> {
  const free = ADS_CADENCE.CONCURRENCY - inFlight.size;
  if (free <= 0) return;
  try {
    const now = new Date();
    const stale = new Date(now.getTime() - ADS_CADENCE.LOCK_STALE_MIN * 60 * 1000);
    const candidates = await prisma.channel.findMany({
      where: adsCandidateWhere(now, stale, [...inFlight]),
      // Gian chưa từng xung (null) lên trước, rồi gian trễ hạn lâu nhất.
      orderBy: { nextAdsPulseAt: { sort: "asc", nulls: "first" } },
      take: free,
    });
    for (const c of candidates) {
      // CLAIM: chỉ thành công nếu adsLockedAt còn đúng như lúc đọc — worker khác vừa cầm thì count = 0.
      const claimed = await prisma.channel.updateMany({
        where: { id: c.id, adsLockedAt: c.adsLockedAt },
        data: { adsLockedAt: now },
      });
      if (claimed.count === 0) continue;
      inFlight.add(c.id);
      void processAdsChannel({ ...c, adsLockedAt: now }).finally(() => inFlight.delete(c.id));
    }
  } catch (err) {
    console.error("[Ads-lane] Lỗi nhặt vé:", (err as Error).message);
  }
}

/** Chạy hai tầng ads đến hạn cho MỘT gian rồi ghi hạn kế tiếp + nhả vé. */
async function processAdsChannel(channel: Channel): Promise<void> {
  const tiers = dueAdsTiers(channel, Date.now());
  let pulse: AdsPulseResult | null = null;
  let history: AdsHistoryResult | null = null;
  let historyRan = false;
  try {
    const configured =
      (channel.channelName === ChannelName.SHOPEE && isShopeeConfigured()) ||
      (channel.channelName === ChannelName.LAZADA && isLazadaConfigured()) ||
      (channel.channelName === ChannelName.TIKTOK && isTikTokConfigured());
    if (!configured) {
      // Thiếu env của sàn: đẩy hạn 1 ngày để gian không bị nhặt lại mỗi tick (vòng đơn có nextFastSyncAt đỡ, làn này không).
      pulse = { delayMin: 24 * 60, synced: false };
      historyRan = tiers.history;
      return;
    }
    // Xung trước (cảnh báo tiền cần sớm nhất), lịch sử sau — cùng thứ tự như vòng cũ.
    if (tiers.pulse) pulse = await runAdsPulse(channel);
    // Lát 2: xung vừa bị 429 tầng shop thì KHÔNG gọi tiếp lịch sử — thêm lệnh chỉ thêm 429 từ cùng gian.
    // Bước A 13.9: cổng vừa bảo "quay lại sau" ở xung thì cũng không gọi lịch sử — hạn lịch sử giữ nguyên, lượt kế làm.
    if (tiers.history && pulse?.rateLimited !== "shop" && pulse?.deferMs == null) {
      historyRan = true;
      history = await runAdsHistory(channel);
    }
  } catch (err) {
    console.error(`[Ads-lane] Lỗi xử lý gian "${channel.shopName}":`, (err as Error).message);
    // Lỗi lọt ra tới đây (hàm tầng vốn tự bắt) → vẫn phải ghi hạn, kẻo gian bị nhặt lại mỗi tick.
    if (tiers.pulse && !pulse) pulse = { delayMin: ADS_CADENCE.PULSE_IDLE_MIN, synced: false };
    if (tiers.history) historyRan = true;
  } finally {
    const data = nextAdsSchedule({ pulse, history, historyRan, backoffLevel: channel.adsBackoffLevel }, Date.now());
    const deferMs = Math.max(pulse?.deferMs ?? 0, history?.deferMs ?? 0);
    if (deferMs > 0) {
      console.log(
        `[Ads-lane] ${channel.channelName} "${channel.shopName}" cổng bảo quay lại sau ${Math.ceil(deferMs / 1000)} s — xếp lại, không bậc`
      );
    }
    if (data.adsBackoffUntil) {
      console.warn(
        `[Ads-lane] ${channel.channelName} "${channel.shopName}" lùi riêng bậc ${data.adsBackoffLevel} tới ${data.adsBackoffUntil.toISOString()} (429 tầng shop — gian khác không ảnh hưởng)`
      );
    } else if (data.adsBackoffLevel === 0 && channel.adsBackoffLevel > 0) {
      console.log(`[Ads-lane] ${channel.channelName} "${channel.shopName}" khỏe lại — bậc lùi về 0`);
    }
    await prisma.channel
      .update({ where: { id: channel.id }, data })
      .catch((err) => console.error(`[Ads-lane] Không ghi được lịch gian "${channel.shopName}":`, (err as Error).message));
  }
}
