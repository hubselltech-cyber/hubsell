// ============================================================
// VAN AN TOÀN GỌI API SÀN THEO APP — tầng C của docs/ADS-NHIP-CANH-BAO.md
//
// Vì sao: Shopee giới hạn nhóm Ads API theo 3 tầng (ads.rate_limit.exceed_
// partner_api = theo APP, exceed_shop_api = theo shop, exceed_api = toàn hệ
// thống) và FAQ 570 nói rõ: vượt ngưỡng kéo dài + retry dồn dập = KHÓA API
// của app, mở lại phải ticket. Với hàng chục ngàn gian, một app bị khóa là
// mọi seller mất số ads cùng lúc. Nên:
//
//   1. TOKEN BUCKET theo app (trong tiến trình): mọi call ads chờ lấy token
//      với trần ADS_CADENCE.APP_QPS call/giây. Nhiều worker → mỗi worker một
//      bucket, trần thật = QPS × số worker (đặt env tương ứng).
//   2. CẦU DAO CHUNG trong DB (ApiThrottleState): gặp vượt trần theo app →
//      KHÔNG retry, đặt pausedUntil = now + 5' × 2^level (trần 60'). MỌI tiến
//      trình đọc cầu dao trước khi gọi (cache 10s) → không có chuyện 10k gian
//      cùng đập vào sàn khi đã bị chặn.
//   3. Vượt trần theo SHOP chỉ lùi lịch gian đó (caller xử), không đóng cầu dao.
//
// Áp cho path Ads của Shopee (mọi partner: app chính lẫn Hubsell Ads) và
// Sponsored Solutions của Lazada. Các API đơn/kho/đối soát KHÔNG đi qua đây
// (nhịp khác, mã lỗi khác) — mở rộng sau khi có số chính thức.
// ============================================================

import { prisma } from "../lib/prisma";
import { ADS_CADENCE } from "../config/ads-cadence";

/** Lỗi ngân sách: caller (worker) bắt để lùi lịch, không coi là lỗi nghiệp vụ. */
export class ApiBudgetError extends Error {
  constructor(
    readonly app: string,
    readonly scope: "app_paused" | "partner_rate_limit" | "shop_rate_limit",
    message: string
  ) {
    super(message);
  }
}

export function isApiBudgetError(err: unknown): err is ApiBudgetError {
  return err instanceof ApiBudgetError;
}

// ---------- 1. Token bucket theo app ----------

interface Bucket {
  tokens: number;
  updatedAt: number;
}
const buckets = new Map<string, Bucket>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Chờ tới khi có token cho app (trần APP_QPS/giây, burst = 2 giây). */
export async function acquireApiToken(app: string, qps: number = ADS_CADENCE.APP_QPS): Promise<void> {
  const burst = Math.max(1, qps * 2);
  for (;;) {
    const now = Date.now();
    let b = buckets.get(app);
    if (!b) {
      b = { tokens: burst, updatedAt: now };
      buckets.set(app, b);
    }
    b.tokens = Math.min(burst, b.tokens + ((now - b.updatedAt) / 1000) * qps);
    b.updatedAt = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    await sleep(Math.ceil(((1 - b.tokens) / qps) * 1000));
  }
}

// ---------- 2. Cầu dao chung trong DB ----------

/** Nghỉ lần đầu 5', nhân đôi mỗi lần trip liên tiếp, trần 60'. Hàm thuần (test). */
export function pauseMsForLevel(level: number): number {
  const base = 5 * 60 * 1000;
  return Math.min(60 * 60 * 1000, base * 2 ** Math.max(0, level));
}

/** Sau bao lâu không trip thì bậc về 0 (ms). */
const LEVEL_DECAY_MS = 2 * 60 * 60 * 1000;
/** Cache đọc cầu dao — mỗi tiến trình hỏi DB tối đa 1 lần/10s/app. */
const BREAKER_CACHE_MS = 10 * 1000;
const breakerCache = new Map<string, { pausedUntil: number; checkedAt: number }>();

/** Ném ApiBudgetError nếu app đang bị cầu dao chặn. */
export async function assertAppOpen(app: string): Promise<void> {
  const now = Date.now();
  const cached = breakerCache.get(app);
  let pausedUntil = cached && now - cached.checkedAt < BREAKER_CACHE_MS ? cached.pausedUntil : null;
  if (pausedUntil == null) {
    const row = await prisma.apiThrottleState.findUnique({ where: { app } });
    pausedUntil = row?.pausedUntil?.getTime() ?? 0;
    breakerCache.set(app, { pausedUntil, checkedAt: now });
  }
  if (pausedUntil > now) {
    throw new ApiBudgetError(
      app,
      "app_paused",
      `App ${app} đang tạm ngừng gọi Ads API tới ${new Date(pausedUntil).toISOString()} (sàn báo vượt trần theo app)`
    );
  }
}

/** Sàn báo vượt trần THEO APP → đóng cầu dao cho mọi tiến trình. */
export async function tripAppBreaker(app: string, reason: string): Promise<number> {
  const now = new Date();
  const prev = await prisma.apiThrottleState.findUnique({ where: { app } });
  const stale = !prev || now.getTime() - prev.updatedAt.getTime() > LEVEL_DECAY_MS;
  const level = stale ? 0 : prev.level + 1;
  const pauseMs = pauseMsForLevel(level);
  const pausedUntil = new Date(now.getTime() + pauseMs);
  await prisma.apiThrottleState.upsert({
    where: { app },
    update: { pausedUntil, level, reason, tripCount: { increment: 1 } },
    create: { app, pausedUntil, level, reason, tripCount: 1 },
  });
  breakerCache.set(app, { pausedUntil: pausedUntil.getTime(), checkedAt: now.getTime() });
  console.error(
    `[ApiBudget] CẦU DAO ĐÓNG app "${app}" ${Math.round(pauseMs / 60000)}' (bậc ${level}): ${reason}`
  );
  return pauseMs;
}

/**
 * Bọc MỘT call Ads API: chờ cầu dao mở → lấy token → gọi. `classify` đọc lỗi
 * sàn trả về: "partner" → đóng cầu dao + ném; "shop" → ném để caller lùi gian;
 * null → ném nguyên lỗi.
 */
export async function withApiBudget<T>(
  app: string,
  fn: () => Promise<T>,
  classify: (err: unknown) => "partner" | "shop" | null
): Promise<T> {
  await assertAppOpen(app);
  await acquireApiToken(app);
  try {
    return await fn();
  } catch (err) {
    const scope = classify(err);
    if (scope === "partner") {
      await tripAppBreaker(app, (err as Error).message.slice(0, 300));
      throw new ApiBudgetError(app, "partner_rate_limit", (err as Error).message);
    }
    if (scope === "shop") {
      throw new ApiBudgetError(app, "shop_rate_limit", (err as Error).message);
    }
    throw err;
  }
}
