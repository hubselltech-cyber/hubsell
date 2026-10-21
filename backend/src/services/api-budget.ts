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

import { createHash } from "crypto";
import { prisma } from "../lib/prisma";
import { ADS_CADENCE } from "../config/ads-cadence";

/**
 * Lỗi ngân sách: caller (worker) bắt để lùi lịch, không coi là lỗi nghiệp vụ.
 * Scope `gateway_defer` (thiết kế 13.9 bước A, 21/10/2026): CỔNG GỌI SÀN bảo "chưa gọi được, quay lại sau
 * `waitMs`" — gian xếp lại đúng ngần ấy, KHÔNG bậc lùi theo gian, không cầu dao; `deferReason` = throttled
 * (chờ lượt GCRA) · rate_limit (sàn 429, khóa đã lùi + hạ nhịp) · hard_app (mã cứng theo app — mọi gian dừng).
 */
export class ApiBudgetError extends Error {
  constructor(
    readonly app: string,
    readonly scope: "app_paused" | "partner_rate_limit" | "shop_rate_limit" | "gateway_defer",
    message: string,
    readonly waitMs: number = 0,
    readonly deferReason: "throttled" | "rate_limit" | "hard_app" | null = null
  ) {
    super(message);
  }
}

export function isApiBudgetError(err: unknown): err is ApiBudgetError {
  return err instanceof ApiBudgetError;
}

/** Lỗi cổng "quay lại sau" → ApiBudgetError để MỌI chỗ đang bắt `isApiBudgetError` (xung, lịch sử, route) không phải đổi. Hàm thuần. */
export function budgetErrorFromDefer(
  app: string,
  defer: { waitMs: number; reason: "throttled" | "rate_limit" | "hard_app"; key: string; cause?: unknown }
): ApiBudgetError {
  const cause = defer.cause instanceof Error ? ` — ${defer.cause.message.slice(0, 200)}` : "";
  return new ApiBudgetError(
    app,
    "gateway_defer",
    `Cổng gọi sàn: ${defer.reason} ${defer.key} — chờ ${Math.ceil(defer.waitMs / 1000)} s${cause}`,
    Math.max(0, defer.waitMs),
    defer.reason
  );
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

// ---------- 3. Bão 429 theo shop → mới đóng cầu dao chung ----------
//
// ★ 28/09/2026: HTTP 429 trần (không mã exceed_partner_api) giờ là tầng SHOP
// (client.ts) — một gian dính không kéo cả app nghỉ. Nhưng nếu NHIỀU gian cùng
// dính trong thời gian ngắn thì đó là dấu hiệu trần theo app thật (hoặc sàn
// đang siết) → vẫn phải đóng cầu dao, không được để hàng loạt gian tiếp tục
// đập vào. Ngưỡng: ≥ 3 GIAN KHÁC NHAU và ≥ 20 % số gian đã gọi, trong 10'.
// ★ 16/10/2026: bản cũ đếm theo LẦN (giả định "mỗi gian 1 call/30' nên 3 lần =
// 3 gian") — sai: một xung Shopee gọi 5–7 call liền cho MỘT gian, gian đã bị
// sàn chặn thì call sau cũng 429 → 3 lần trong vài giây từ một gian → cầu dao
// đóng cả app (HQ 16/10 báo ĐÓNG shopee:2044679 khi mới vài gian). Nay mỗi
// mốc kèm khóa gian, bão = số gian KHÁC NHAU trong cửa sổ. Đếm trong RAM từng
// tiến trình — nhiều instance thì mỗi bên tự đếm, vẫn an toàn (chỉ nhạy hơn).
// ★ 17/10/2026: vẫn đóng ~8 lần/ngày (lần 102 → 114 trong ~35 giờ) dù đã đếm
// theo gian — vì Shopee trả 429 mã chung error_rate_limit LẺ TẺ, rơi ngẫu nhiên
// vào từng gian (có từ 28/09, mỗi gian 1 call/30' vẫn dính). 7 gian thì hiếm khi
// 3 gian trùng 10'; 29 gian thì thành chuyện thường, 50.000 gian thì đóng liên
// tục. Ngưỡng cố định "3 gian" không theo quy mô → thêm điều kiện TỶ LỆ: số gian
// dính phải ≥ STORM_RATIO số gian ĐÃ GỌI trong cùng cửa sổ. Vượt trần theo app
// thật thì Shopee trả mã exceed_partner_api → đóng ngay ở nhánh "partner", không
// phụ thuộc luật này.
export const RATE_LIMIT_STORM = {
  /** Sàn tối thiểu: số GIAN khác nhau dính 429 tầng shop trong cửa sổ. */
  trips: 3,
  /**
   * Và phải chiếm ≥ tỷ lệ này trong số gian đã gọi trong cửa sổ. 0,2 là số TỰ
   * CHỌN (17/10, chưa có căn cứ từ sàn): 429 lẻ tẻ đo được ~1–4 %/gian/ngày,
   * còn trần app thật thì gần như mọi gian cùng dính. Số đọc từ env
   * ADS_STORM_RATIO qua config/ads-cadence.ts (lát 1, 19/10) — đo xong chỉ đổi env.
   */
  ratio: ADS_CADENCE.STORM_RATIO,
  windowMs: 10 * 60 * 1000,
} as const;

/** Một lần 429 tầng shop: gian nào, lúc nào (ms). */
export interface RateLimitHit {
  shop: string;
  at: number;
}
const shopRateLimitHits = new Map<string, RateLimitHit[]>();
/** Gian đã gọi gần nhất lúc nào (ms), theo app — mẫu số của tỷ lệ bão. */
const shopLastCalledAt = new Map<string, Map<string, number>>();

/**
 * Hàm thuần (test): ghi thêm mốc `now` của gian `shop`, loại mốc ngoài cửa sổ,
 * trả true nếu số GIAN KHÁC NHAU trong `windowMs` ≥ `trips` VÀ ≥ `ratio` ×
 * `calledShops` (số gian đã gọi trong cùng cửa sổ; 0 = chỉ xét `trips`).
 */
export function isRateLimitStorm(
  hits: RateLimitHit[],
  now: number,
  shop: string,
  calledShops: number = 0,
  trips: number = RATE_LIMIT_STORM.trips,
  ratio: number = RATE_LIMIT_STORM.ratio,
  windowMs: number = RATE_LIMIT_STORM.windowMs
): boolean {
  hits.push({ shop, at: now });
  const cutoff = now - windowMs;
  while (hits.length && hits[0].at < cutoff) hits.shift();
  const distinct = new Set(hits.map((h) => h.shop)).size;
  return distinct >= trips && distinct >= Math.ceil(ratio * calledShops);
}

/**
 * LÁT 2 (19/10/2026) — giãn lệnh trong một xung của cùng gian. Hàm thuần: lệnh trước của gian lúc `lastAt`
 * (ms, undefined = chưa gọi), khoảng cách tối thiểu `gapMs` → phải chờ thêm bao nhiêu ms (0 = gọi ngay).
 */
export function shopCallWaitMs(lastAt: number | undefined, now: number, gapMs: number): number {
  if (gapMs <= 0 || lastAt == null) return 0;
  return Math.max(0, lastAt + gapMs - now);
}

/** Ghi nhận MỘT lần gọi của gian (mọi kết quả) — mẫu số tỷ lệ bão. */
function noteShopCall(app: string, shop: string, now: number): void {
  let m = shopLastCalledAt.get(app);
  if (!m) {
    m = new Map();
    shopLastCalledAt.set(app, m);
  }
  m.set(shop, now);
}

/** Số gian đã gọi trong cửa sổ; dọn mốc cũ luôn (chỉ chạy khi gặp 429 — hiếm). */
function countCalledShops(app: string, now: number): number {
  const m = shopLastCalledAt.get(app);
  if (!m) return 0;
  const cutoff = now - RATE_LIMIT_STORM.windowMs;
  for (const [shop, at] of m) if (at < cutoff) m.delete(shop);
  return m.size;
}

/** Trả danh sách gian khác nhau của bão nếu là bão (rồi xóa sổ đếm), không thì null. */
function noteShopRateLimit(app: string, shop: string): { shops: string[]; called: number } | null {
  let hits = shopRateLimitHits.get(app);
  if (!hits) {
    hits = [];
    shopRateLimitHits.set(app, hits);
  }
  const now = Date.now();
  const called = countCalledShops(app, now);
  if (!isRateLimitStorm(hits, now, shop, called)) return null;
  const shops = [...new Set(hits.map((h) => h.shop))];
  hits.length = 0; // đã đóng cầu dao → đếm lại từ đầu sau khi mở
  return { shops, called };
}

/**
 * Khóa gian Lazada = access_token → KHÔNG được ghi nguyên văn ra log/lý do.
 * Băm ngắn để vẫn đếm theo gian được. Hàm thuần (test).
 */
export function lazadaShopKey(accessToken: string | undefined): string | undefined {
  if (!accessToken) return undefined;
  return `lzd#${createHash("sha256").update(accessToken).digest("hex").slice(0, 10)}`;
}

/** "ANO, Gia Hân, 123456" — tên gian Shopee theo shop_id; khóa băm Lazada giữ nguyên. */
async function shopLabels(shops: string[]): Promise<string> {
  const numeric = shops.filter((s) => /^\d+$/.test(s));
  const rows = numeric.length
    ? await prisma.channel
        .findMany({ where: { externalShopId: { in: numeric } }, select: { externalShopId: true, shopName: true } })
        .catch(() => [])
    : [];
  const nameById = new Map(rows.map((r) => [r.externalShopId!, r.shopName] as const));
  return shops.map((s) => nameById.get(s) ?? s).join(", ");
}

/**
 * Bọc MỘT call Ads API: chờ cầu dao mở → lấy token → gọi. `classify` đọc lỗi
 * sàn trả về: "partner" → đóng cầu dao + ném; "shop" → ném để caller lùi gian
 * (≥3 gian KHÁC NHAU và ≥20 % gian đã gọi trong 10' → coi như partner, đóng cầu dao);
 * null → ném nguyên lỗi. `shop` = khóa gian (shop_id Shopee / access_token
 * Lazada đã băm — lazadaShopKey) để bão đếm theo gian; thiếu thì mỗi call tính là một gian riêng
 * (hành vi cũ, nhạy hơn).
 */
export async function withApiBudget<T>(
  app: string,
  fn: () => Promise<T>,
  classify: (err: unknown) => "partner" | "shop" | null,
  shop?: string
): Promise<T> {
  await assertAppOpen(app);
  await acquireApiToken(app);
  if (shop) {
    // Giãn lệnh của CÙNG gian (ADS_SHOP_CALL_GAP_SEC, 0 = tắt): mốc gọi cuối theo gian đã có sẵn cho tỷ lệ bão.
    const wait = shopCallWaitMs(shopLastCalledAt.get(app)?.get(shop), Date.now(), ADS_CADENCE.SHOP_CALL_GAP_SEC * 1000);
    if (wait > 0) await sleep(wait);
    noteShopCall(app, shop, Date.now());
  }
  try {
    return await fn();
  } catch (err) {
    const scope = classify(err);
    const message = (err as Error).message;
    if (scope === "partner") {
      await tripAppBreaker(app, message.slice(0, 300));
      throw new ApiBudgetError(app, "partner_rate_limit", message);
    }
    if (scope === "shop") {
      const shopKey = shop || `?${Date.now()}`;
      const storm = noteShopRateLimit(app, shopKey);
      if (storm) {
        const names = await shopLabels(storm.shops);
        await tripAppBreaker(
          app,
          `Bão 429: ${storm.shops.length}/${storm.called} gian đã gọi trong ${RATE_LIMIT_STORM.windowMs / 60000}' bị chặn (${names}) — ${message}`.slice(0, 300)
        );
        throw new ApiBudgetError(app, "partner_rate_limit", message);
      }
      console.warn(`[ApiBudget] 429 tầng shop app "${app}" gian ${shop ?? "?"} (chỉ lùi gian): ${message}`);
      throw new ApiBudgetError(app, "shop_rate_limit", message);
    }
    throw err;
  }
}
