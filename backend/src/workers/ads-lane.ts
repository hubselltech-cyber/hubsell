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
// Lát 2 (cách ly theo gian, bậc lùi lưu DB) và lát 3 (AIMD) nối vào đây.
// ============================================================

import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ADS_CADENCE } from "../config/ads-cadence";
import { isShopeeConfigured } from "../integrations/shopee/config";
import { isLazadaConfigured } from "../integrations/lazada/config";
import { isTikTokConfigured } from "../integrations/tiktok/config";
import { runAdsHistory, runAdsPulse, type AdsPulseResult } from "./ads-tiers";
import { adsInOrderSync, withJitter } from "./order-auto-sync";

/** Nhịp nhặt vé (ms) — như vòng đơn. */
const TICK_MS = 20 * 1000;
/** Lượt đầu sớm sau boot. */
const FIRST_RUN_DELAY_MS = 20 * 1000;

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
      { OR: [{ nextAdsPulseAt: null }, { nextAdsPulseAt: { lte: now } }, { nextAdsSyncAt: { lte: now } }] },
    ],
  };
}

/** Giá trị ghi lịch sau một lượt (hàm thuần): hạn kế tiếp có jitter, mốc kéo được số, hạ cờ backfill. */
export function nextAdsSchedule(
  input: { pulse: AdsPulseResult | null; history: boolean; historyRan: boolean },
  now: number,
  rand: () => number = Math.random
): {
  adsLockedAt: null;
  nextAdsPulseAt?: Date;
  nextAdsSyncAt?: Date;
  lastAdsSyncAt?: Date;
  adsBackfillPending?: false;
} {
  const fresh = input.history || input.pulse?.synced === true;
  return {
    adsLockedAt: null,
    ...(input.pulse ? { nextAdsPulseAt: new Date(now + withJitter(input.pulse.delayMin * 60 * 1000, rand)) } : {}),
    ...(input.historyRan
      ? { nextAdsSyncAt: new Date(now + withJitter(ADS_CADENCE.FULL_HOURS * 60 * 60 * 1000, rand)) }
      : {}),
    ...(fresh ? { lastAdsSyncAt: new Date(now) } : {}),
    ...(input.history ? { adsBackfillPending: false as const } : {}),
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
    `[Ads-lane] BẬT — làn Ads riêng: song song ${ADS_CADENCE.CONCURRENCY} gian, XUNG Shopee ${ADS_CADENCE.PULSE_MIN}' / Lazada ${ADS_CADENCE.PULSE_LAZADA_MIN}' / TikTok ${ADS_CADENCE.PULSE_TIKTOK_MIN}' cho gian đang chi (im ắng ${ADS_CADENCE.PULSE_IDLE_MIN}'), lịch sử mỗi ${ADS_CADENCE.FULL_HOURS}h (cửa sổ ${ADS_CADENCE.WINDOW_DAYS} ngày, lần đầu ${ADS_CADENCE.BACKFILL_DAYS}), vé mồ côi sau ${ADS_CADENCE.LOCK_STALE_MIN}', trần ${ADS_CADENCE.APP_QPS} call/s mỗi app`
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
  let history = false;
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
    if (tiers.history) {
      historyRan = true;
      history = await runAdsHistory(channel);
    }
  } catch (err) {
    console.error(`[Ads-lane] Lỗi xử lý gian "${channel.shopName}":`, (err as Error).message);
    // Lỗi lọt ra tới đây (hàm tầng vốn tự bắt) → vẫn phải ghi hạn, kẻo gian bị nhặt lại mỗi tick.
    if (tiers.pulse && !pulse) pulse = { delayMin: ADS_CADENCE.PULSE_IDLE_MIN, synced: false };
    if (tiers.history) historyRan = true;
  } finally {
    await prisma.channel
      .update({ where: { id: channel.id }, data: nextAdsSchedule({ pulse, history, historyRan }, Date.now()) })
      .catch((err) => console.error(`[Ads-lane] Không ghi được lịch gian "${channel.shopName}":`, (err as Error).message));
  }
}
