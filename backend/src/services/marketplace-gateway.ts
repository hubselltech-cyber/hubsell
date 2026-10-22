// ============================================================
// CỔNG GỌI SÀN (N4 + N5) — Pha B "Nền" lát B2, docs/CUNG-HOA-LOP-GOI-SAN.md mục 5b
//
// MỘT đoạn mã cho mọi lệnh sàn: xin lượt (GCRA dùng chung trong Postgres, theo
// lô) → gọi → phân loại lỗi theo bảng từng sàn → lùi theo ĐÚNG khóa → ném
// GatewayDeferError cho làn xếp lại. Thay cho 3 cơ chế rời rạc hiện tại
// (token bucket RAM + cầu dao "bão 429" của api-budget, nhịp RAM của TikTok
// rate-limit) — Pha C mới chuyển lệnh sang đây, Pha D mới gỡ cái cũ.
//
//   Khóa                      Bật trần khi                  Lùi khi
//   <SÀN>:<app>               có bằng chứng trần app        lỗi cứng theo app (exceed_partner_api,
//                                                           Lazada ApiCallLimit) — "cầu dao" chỉ còn ở đây
//   <SÀN>:<app>|shop:<id>     TikTok (App × gian, docs sàn)  429 tầng gian
//   <SÀN>:<app>|ep:<path>     Shopee daily_performance (H4)  429 không rõ tầng (lệnh KHÔNG có khóa gian × endpoint)
//                                                           → lùi + hạ nhịp AIMD
//   <SÀN>:<app>|shop:<id>|ep:<path>  nhóm Ads Shopee          429 không rõ tầng → lùi ĐÚNG gian × endpoint 60 s × 2^n
//                             (13.9 A2, đo 22/10)           + hạ nhịp AIMD khóa ấy; khóa app × endpoint KHÔNG hạ
//
// Một gian 429 KHÔNG làm gian khác chờ (khóa gian riêng); "bão vài gian → tắt cả
// app" (giả dương 12 lần/ngày, H4) không còn. 22/10 (docs ADS-NHIP-CANH-BAO 13.9.5):
// hạ AIMD khóa app × endpoint vì 429 của MỘT gian = hạ oan cả app (tụt sàn 0,1 vẫn
// 429) → lệnh có khóa gian × endpoint chỉ lùi + hạ khóa ấy.
// ============================================================

import { prisma } from "../lib/prisma";
import { GATEWAY, RATE_LIMITS, type RateLimit } from "../config/marketplace-read";
import { gcraTake, penalize, FRESH_KEY, type KeyLimit, type KeyState, type PenaltyRule } from "../lib/rate-gate";
import { TiktokRateLimitError } from "../integrations/tiktok/rate-limit";

export type Platform = "SHOPEE" | "TIKTOK" | "LAZADA";

/** Kết quả phân loại một lỗi sàn. */
export type Classified =
  | { kind: "rate_limit"; scope: "shop" | "endpoint" | "unknown"; retryAfterMs?: number | null }
  | { kind: "hard_app" }
  | { kind: "auth" }
  | { kind: "transient" }
  | { kind: "other" };

/** Cổng bảo "chưa gọi được, quay lại sau waitMs" — làn bắt để xếp lại, không phải lỗi nghiệp vụ. */
export class GatewayDeferError extends Error {
  constructor(
    readonly waitMs: number,
    readonly reason: "throttled" | "rate_limit" | "hard_app",
    readonly key: string,
    readonly cause?: unknown
  ) {
    super(`[gateway] ${reason} ${key} — chờ ${Math.round(waitMs / 1000)} s`);
    this.name = "GatewayDeferError";
  }
}

export function isGatewayDefer(err: unknown): err is GatewayDeferError {
  return err instanceof GatewayDeferError;
}

export interface GatewayCall {
  platform: Platform;
  app: string;
  shop?: string;
  /** Đường dẫn API (Shopee "/api/v2/...", TikTok "/order/202309/orders/search"). */
  endpoint: string;
  /** Xin lượt theo lô (vd K trang một lần) — H5: chia nhỏ chi phí xin lượt. */
  tokens?: number;
  classify?: (err: unknown) => Classified;
}

/** Kho trạng thái khóa — Postgres ở prod, RAM trong test. */
export interface RateStore {
  take(limits: KeyLimit[], n: number): Promise<{ waitMs: number; failedKeys: string[] }>;
  penalize(key: string, rule: PenaltyRule, retryAfterMs: number | null | undefined, error: string): Promise<number>;
  reset(keys: string[]): Promise<void>;
}

export interface GatewayDeps {
  store: RateStore;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** 13.9 A2: bộ đếm "bão theo gian khác nhau" (mặc định một bộ chung của tiến trình). */
  storm?: DistinctShopStorm;
}

/**
 * 13.9 A2 — bằng chứng tầng app cho 429 không rõ tầng: đếm GIAN KHÁC NHAU dính 429 trên cùng khóa endpoint trong cửa
 * sổ. Một gian dính 4 lần liền (HPGear 22/10) = 1 gian → không phải bão. Trong tiến trình (worker Ads là một tiến trình;
 * nhiều tiến trình thì mỗi tiến trình tự thấy phần của mình — yếu hơn, không sai). Hàm thuần, test được.
 */
export class DistinctShopStorm {
  private readonly seen = new Map<string, Map<string, number>>();
  constructor(
    private readonly shops: number = GATEWAY.UNKNOWN_429_STORM.shops,
    private readonly windowMs: number = GATEWAY.UNKNOWN_429_STORM.windowMs
  ) {}
  /** Ghi một lần 429 của `shop` trên `key`; trả số gian khác nhau trong cửa sổ và có đủ bão không. */
  note(key: string, shop: string, now: number): { shops: number; storm: boolean } {
    let m = this.seen.get(key);
    if (!m) {
      m = new Map();
      this.seen.set(key, m);
    }
    m.set(shop, now);
    for (const [s, t] of m) if (now - t > this.windowMs) m.delete(s);
    return { shops: m.size, storm: m.size >= this.shops };
  }
}

const defaultStorm = new DistinctShopStorm();

const keyOf = {
  app: (c: GatewayCall) => `${c.platform}:${c.app}`,
  shop: (c: GatewayCall) => `${c.platform}:${c.app}|shop:${c.shop}`,
  endpoint: (c: GatewayCall) => `${c.platform}:${c.app}|ep:${c.endpoint}`,
  /** 13.9 A2: gian × endpoint — chỉ khi lệnh có gian VÀ cấu hình có trần cho (sàn, endpoint) ở shopEndpoint*. */
  shopEndpoint: (c: GatewayCall) => `${c.platform}:${c.app}|shop:${c.shop}|ep:${c.endpoint}`,
};

function limitOf(key: string, rl: RateLimit | undefined): KeyLimit {
  return rl ? { key, emissionMs: 1000 / rl.perSec, burst: rl.burst } : { key, emissionMs: 0, burst: 1 };
}

/** Dòng riêng thắng, không có thì tiền tố dài nhất khớp. */
function matchLimit(full: string, exact: Record<string, RateLimit>, prefixes: Record<string, RateLimit> | undefined): RateLimit | undefined {
  const e = exact[full];
  if (e) return e;
  let best: { len: number; rl: RateLimit } | undefined;
  for (const [prefix, rl] of Object.entries(prefixes ?? {})) {
    if (full.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, rl };
  }
  return best?.rl;
}

/** Trần app × endpoint của một endpoint: dòng riêng thắng, không có thì tiền tố dài nhất khớp (hàm thuần — test). */
export function endpointLimit(platform: Platform, endpoint: string, limits = RATE_LIMITS): RateLimit | undefined {
  return matchLimit(`${platform} ${endpoint}`, limits.endpoint, limits.endpointPrefix);
}

/** 13.9 A2: trần GIAN × endpoint (mỗi gian một xô riêng cho endpoint ấy); undefined = lệnh không lấy khóa này. Hàm thuần. */
export function shopEndpointLimit(platform: Platform, endpoint: string, limits = RATE_LIMITS): RateLimit | undefined {
  return matchLimit(`${platform} ${endpoint}`, limits.shopEndpoint ?? {}, limits.shopEndpointPrefix);
}

/** Các khóa một lệnh phải qua (hàm thuần — test). */
export function gatewayLimits(c: GatewayCall, limits = RATE_LIMITS): KeyLimit[] {
  const out = [limitOf(keyOf.app(c), limits.app[c.platform])];
  if (c.shop) out.push(limitOf(keyOf.shop(c), limits.shop[c.platform]));
  out.push(limitOf(keyOf.endpoint(c), endpointLimit(c.platform, c.endpoint, limits)));
  if (c.shop) {
    const se = shopEndpointLimit(c.platform, c.endpoint, limits);
    if (se) out.push(limitOf(keyOf.shopEndpoint(c), se));
  }
  return out;
}

const SHOP_RULE: PenaltyRule = { ...GATEWAY.SHOP_BACKOFF, jitter: true };
const ENDPOINT_RULE: PenaltyRule = { ...GATEWAY.ENDPOINT_BACKOFF, jitter: true, decrease: true, minFactor: GATEWAY.AIMD_MIN_FACTOR };
/** 13.9 A2: gian × endpoint lùi 60 s × 2^n không xáo trộn (làn đã xáo trộn) + hạ nhịp AIMD khóa ấy. */
const SHOP_ENDPOINT_RULE: PenaltyRule = { ...GATEWAY.SHOP_ENDPOINT_BACKOFF, jitter: false, decrease: true, minFactor: GATEWAY.AIMD_MIN_FACTOR };
const APP_HARD_RULE: PenaltyRule = { ...GATEWAY.APP_HARD, jitter: false };

/** Gọi MỘT lệnh sàn qua cổng. Lỗi không thuộc rate limit / lỗi cứng app ném nguyên vẹn. */
export async function callMarketplace<T>(c: GatewayCall, fn: () => Promise<T>, deps: GatewayDeps = defaultDeps): Promise<T> {
  const limits = gatewayLimits(c);
  const classify = c.classify ?? classifierFor(c.platform);
  let failedKeys: string[] = [];
  for (let attempt = 0; ; attempt++) {
    const t = await deps.store.take(limits, c.tokens ?? 1);
    if (t.waitMs === 0) {
      failedKeys = t.failedKeys;
      break;
    }
    if (t.waitMs > GATEWAY.MAX_INLINE_WAIT_MS || attempt >= 3) {
      throw new GatewayDeferError(t.waitMs, "throttled", limits.map((l) => l.key).join(" "));
    }
    await deps.sleep(t.waitMs);
  }

  try {
    const result = await fn();
    if (failedKeys.length) await deps.store.reset(failedKeys).catch(() => {});
    return result;
  } catch (err) {
    const k = classify(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (k.kind === "hard_app") {
      const key = keyOf.app(c);
      const until = await deps.store.penalize(key, APP_HARD_RULE, null, msg);
      console.error(`[gateway] LỖI CỨNG THEO APP ${key} — dừng app tới ${new Date(until).toISOString()}: ${msg.slice(0, 200)}`);
      throw new GatewayDeferError(Math.max(0, until - deps.now()), "hard_app", key, err);
    }
    if (k.kind === "rate_limit") {
      const shopKey = c.shop ? keyOf.shop(c) : null;
      const epKey = keyOf.endpoint(c);
      const shopEpKey = c.shop && shopEndpointLimit(c.platform, c.endpoint) ? keyOf.shopEndpoint(c) : null;
      let until = 0;
      let key = epKey;
      let scope: string = k.scope;
      if (k.scope === "unknown" && shopEpKey) {
        // 13.9 A2 (đo 22/10): lệnh có trần gian × endpoint mà sàn 429 không rõ tầng → đó là xô của ĐÚNG gian × endpoint
        // này: lùi 60 s × 2^n + hạ nhịp khóa ấy. KHÔNG đụng khóa gian chung (đơn hàng của gian vẫn đi). Khóa app ×
        // endpoint CHỈ hạ khi có bằng chứng tầng app = ≥ N gian KHÁC NHAU dính cùng endpoint trong 60 s (một gian dính
        // 4 lần liền không tính — 21–22/10 hạ theo lần làm cả app tụt sàn 0,1 mà vẫn 429).
        until = await deps.store.penalize(shopEpKey, SHOP_ENDPOINT_RULE, k.retryAfterMs, msg);
        key = shopEpKey;
        scope = "shop×ep";
        const storm = (deps.storm ?? defaultStorm).note(epKey, c.shop!, deps.now());
        if (storm.storm) {
          until = Math.max(until, await deps.store.penalize(epKey, ENDPOINT_RULE, k.retryAfterMs, msg));
          scope = `shop×ep + bão app (${storm.shops} gian/60 s → hạ nhịp ${epKey})`;
        }
      } else {
        // shop: chỉ gian đó lùi. endpoint: khóa endpoint lùi + hạ nhịp. unknown không có khóa gian × endpoint (Lazada
        // 901, Shopee ngoài nhóm Ads): cả hai — gian lùi để không đập tiếp, endpoint hạ nhịp (H4).
        if ((k.scope === "shop" || k.scope === "unknown") && shopKey) {
          until = await deps.store.penalize(shopKey, SHOP_RULE, k.retryAfterMs, msg);
          key = shopKey;
        }
        if (k.scope === "endpoint" || k.scope === "unknown" || !shopKey) {
          until = Math.max(until, await deps.store.penalize(epKey, ENDPOINT_RULE, k.retryAfterMs, msg));
        }
      }
      console.warn(`[gateway] 429 ${scope} ${key} — lùi tới ${new Date(until).toISOString()}: ${msg.slice(0, 160)}`);
      throw new GatewayDeferError(Math.max(0, until - deps.now()), "rate_limit", key, err);
    }
    throw err;
  }
}

// ---------- Bảng phân loại lỗi từng sàn (căn cứ: mã hiện có trong integrations/*, docs sàn) ----------

const msgOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const AUTH_RE = /invalid_access_token|invalid_acceess_token|error_auth|access_token.*expired|IllegalAccessToken|105002/i;
const TRANSIENT_RE = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|HTTP 5\d\d|timeout/i;

export function classifyShopee(err: unknown): Classified {
  const m = msgOf(err);
  if (/exceed_partner_api|exceed_api[^_a-z]|exceed_api$/i.test(m)) return { kind: "hard_app" };
  if (/exceed_shop_api/i.test(m)) return { kind: "rate_limit", scope: "shop" };
  if (/error_rate_limit|HTTP 429|too many requests/i.test(m)) return { kind: "rate_limit", scope: "unknown" };
  if (AUTH_RE.test(m)) return { kind: "auth" };
  if (TRANSIENT_RE.test(m)) return { kind: "transient" };
  return { kind: "other" };
}

export function classifyTiktok(err: unknown): Classified {
  // Docs TikTok: đơn vị cô lập nhỏ nhất là App × gian → tầng gian; Retry-After có thì tôn trọng.
  if (err instanceof TiktokRateLimitError) return { kind: "rate_limit", scope: "shop", retryAfterMs: err.info.retryAfterMs };
  const m = msgOf(err);
  if (/36009002|HTTP 429/i.test(m)) return { kind: "rate_limit", scope: "shop" };
  if (AUTH_RE.test(m)) return { kind: "auth" };
  if (TRANSIENT_RE.test(m)) return { kind: "transient" };
  return { kind: "other" };
}

export function classifyLazada(err: unknown): Classified {
  const m = msgOf(err);
  if (/ApiCallLimit|AppCallLimit|CallLimit|call limit/i.test(m)) return { kind: "hard_app" };
  if (/rate limit|too many|HTTP 429|(^|[^0-9])901([^0-9]|$)/i.test(m)) return { kind: "rate_limit", scope: "unknown" };
  if (AUTH_RE.test(m)) return { kind: "auth" };
  if (TRANSIENT_RE.test(m)) return { kind: "transient" };
  return { kind: "other" };
}

export function classifierFor(p: Platform): (err: unknown) => Classified {
  return p === "SHOPEE" ? classifyShopee : p === "TIKTOK" ? classifyTiktok : classifyLazada;
}

// ---------- Kho Postgres ----------

export const pgRateStore: RateStore = {
  async take(limits, n) {
    const rows = await prisma.$queryRaw<{ wait_ms: bigint; failed_keys: string[] }[]>`
      SELECT wait_ms, failed_keys FROM api_rate_take(
        ${limits.map((l) => l.key)}::text[],
        ${limits.map((l) => l.emissionMs)}::double precision[],
        ${limits.map((l) => l.burst)}::integer[],
        ${n}::integer,
        ${GATEWAY.AIMD_RECOVER_MS}::double precision)`;
    return { waitMs: Number(rows[0]?.wait_ms ?? 0), failedKeys: rows[0]?.failed_keys ?? [] };
  },
  async penalize(key, rule, retryAfterMs, error) {
    const rows = await prisma.$queryRaw<{ until: bigint }[]>`
      SELECT api_rate_penalize(${key}, ${rule.baseMs}::double precision, ${rule.capMs}::double precision,
        ${rule.jitter}, ${retryAfterMs ?? null}::double precision, ${rule.decrease ?? false},
        ${rule.minFactor ?? GATEWAY.AIMD_MIN_FACTOR}::double precision, ${GATEWAY.AIMD_RECOVER_MS}::double precision,
        ${error}) AS until`;
    return Number(rows[0]?.until ?? 0);
  },
  async reset(keys) {
    if (!keys.length) return;
    await prisma.$executeRaw`UPDATE "api_rate_keys" SET "failures" = 0 WHERE "key" = ANY(${keys}::text[]) AND "failures" > 0`;
  },
};

const defaultDeps: GatewayDeps = {
  store: pgRateStore,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
};

// ---------- Kho RAM (test, công cụ đo) — cùng công thức lib/rate-gate ----------

export class MemoryRateStore implements RateStore {
  readonly keys = new Map<string, KeyState>();
  constructor(
    private readonly now: () => number,
    private readonly rand: () => number = Math.random
  ) {}
  async take(limits: KeyLimit[], n: number) {
    const d = gcraTake(this.keys, limits, this.now(), n, GATEWAY.AIMD_RECOVER_MS);
    if (d.waitMs === 0) {
      for (const [k, tat] of d.newTat) this.keys.set(k, { ...(this.keys.get(k) ?? FRESH_KEY), tatMs: tat });
    }
    return { waitMs: d.waitMs, failedKeys: d.failedKeys };
  }
  async penalize(key: string, rule: PenaltyRule, retryAfterMs: number | null | undefined) {
    const next = penalize(this.keys.get(key) ?? FRESH_KEY, rule, this.now(), this.rand(), GATEWAY.AIMD_RECOVER_MS, retryAfterMs);
    this.keys.set(key, next);
    return next.blockedUntilMs;
  }
  async reset(keys: string[]) {
    for (const k of keys) {
      const s = this.keys.get(k);
      if (s) this.keys.set(k, { ...s, failures: 0 });
    }
  }
}
