// ============================================================
// I9 — BẰNG CHỨNG BẰNG TEST (thiết kế 13.9, docs/ADS-NHIP-CANH-BAO.md 13.9.1): làn Ads +
// cổng gọi sàn + nhịp tự co chạy trên SÀN GIẢ với N = 40 / 1.000 / 10.000 gian, đồng hồ
// giả. Sàn giả giữ trần THẬT theo app × endpoint THẤP HƠN trần cổng tin (0,7/s vs 1/s)
// để cổng phải tự học bằng AIMD. Bất biến kiểm: không bao giờ "dừng app", 429 < 1 %
// lệnh, lớp 1 không trễ quá hạn chót khi chưa đỏ, 10.000 gian → ĐỎ nhưng sàn vẫn an toàn.
// Mô phỏng tuần tự (một luồng): đủ để chứng minh tính chất, không đo tốc độ tuyệt đối.
//
// 13.9 A2 (22/10/2026, đo thật 13.9.5): sàn giả thêm trần THẬT theo GIAN × endpoint —
// cửa sổ trượt đếm lệnh ĐƯỢC NHẬN của từng gian trên từng endpoint (get_all_cpc 1 lệnh/6',
// chặt hơn 1/5' cổng tin → cổng phải học; endpoint khác 2 lệnh/phút, lỏng hơn cổng tin).
// Làn giả làm đúng A2: sàn 429 → xếp lại ≥ 5', chờ lượt → ≥ 1', lượt sau CHẠY TIẾP từ
// lệnh dở (mốc tươi 15'). Thêm bất biến: không gian nào 429 hai lượt LIỀN NHAU.
// ============================================================
import { describe, expect, it } from "vitest";
import { callMarketplace, DistinctShopStorm, isGatewayDefer, MemoryRateStore, type GatewayDeps } from "../marketplace-gateway";
import {
  computeCadence,
  shopeeAdsCapacity,
  shopeeShopEndpointPerMin,
  SHOPEE_HISTORY_CALLS,
  SHOPEE_PULSE_CALLS,
  type AdsPriority,
  type CadenceResult,
} from "../ads-demand";
import { rng } from "./fake-marketplace";

const APP = "2044679";
const ALL_CPC = "/api/v2/ads/get_all_cpc_ads_daily_performance";
const PERF = "/api/v2/ads/get_product_campaign_daily_performance";
const ENDPOINTS = [...new Set([...Object.values(SHOPEE_PULSE_CALLS), ...Object.values(SHOPEE_HISTORY_CALLS)].flatMap((c) => Object.keys(c)))];
const HISTORY_MIN: Record<AdsPriority, number> = { 1: 360, 2: 360, 3: 1440 };
const MIN = 60_000;

/** Trần THẬT theo gian × endpoint của sàn giả: tối đa `max` lệnh được nhận trong cửa sổ trượt `windowMs`. */
interface ShopWindowLimit {
  windowMs: number;
  max: number;
}

/** Sàn giả: trần THẬT theo app × endpoint (GCRA) + theo GIAN × endpoint (cửa sổ trượt), trả 429 error_rate_limit khi vượt. */
class FakeShopeeAds {
  calls = 0;
  rejected = 0;
  /** 429 theo gian × endpoint (A2) — tách khỏi 429 theo app × endpoint để test đọc được. */
  rejectedByShop = 0;
  private tat = new Map<string, number>();
  private accepted = new Map<string, number[]>();
  constructor(
    private readonly now: () => number,
    private readonly advance: (ms: number) => void,
    private readonly limits: Record<string, { perSec: number; burst: number }>,
    private readonly callMs: number,
    private readonly shopLimits: Record<string, ShopWindowLimit> = {}
  ) {}
  async call(endpoint: string, shop = ""): Promise<{ ok: true }> {
    this.calls++;
    const reject = () => {
      this.rejected++;
      this.advance(this.callMs);
      throw new Error(`Shopee ${endpoint} lỗi: HTTP 429 — vượt trần gọi API (error_rate_limit Too many requests)`);
    };
    const t = this.now();
    // Gian × endpoint: đếm lệnh ĐÃ NHẬN trong cửa sổ (lệnh bị từ chối không tính — như quan sát 22/10: gian qua sau ~4').
    const sl = this.shopLimits[endpoint];
    let acc: number[] | null = null;
    if (sl && shop) {
      const k = `${shop}|${endpoint}`;
      acc = (this.accepted.get(k) ?? []).filter((ts) => t - ts < sl.windowMs);
      this.accepted.set(k, acc);
      if (acc.length >= sl.max) {
        this.rejectedByShop++;
        reject();
      }
    }
    const l = this.limits[endpoint];
    if (l) {
      const em = 1000 / l.perSec;
      const tat = Math.max(this.tat.get(endpoint) ?? 0, t) + em;
      if (tat - t > l.burst * em) reject();
      this.tat.set(endpoint, tat);
    }
    if (acc) acc.push(t);
    this.advance(this.callMs);
    return { ok: true };
  }
}

interface Shop {
  id: string;
  p: AdsPriority;
  due: number;
  lastHistory: number;
  late: number[];
  /** A2: lệnh còn dở của lượt trước (chạy tiếp) + mốc dở. */
  pending: { calls: string[]; historyDue: boolean; at: number } | null;
  /** Lượt trước kết thúc bằng 429 của sàn? (đếm "429 hai lượt liền nhau"). */
  lastWas429: boolean;
  consecutive429: number;
}

interface SimResult {
  pulses: number;
  defers: number;
  hardApp: number;
  calls: number;
  rejected: number;
  rejectedByShop: number;
  /** Số gian từng bị 429 ở hai lượt liền nhau (A2: phải là 0). */
  shopsWithBackToBack429: number;
  cadence: CadenceResult;
  p99LateMin: Record<AdsPriority, number>;
}

function p99(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
}

/** Trần THẬT theo gian × endpoint của sàn giả (A2): get_all_cpc 1 lệnh/6' (chặt hơn 1/5' cổng tin), endpoint khác 2 lệnh/phút. */
const TRUE_SHOP_LIMITS: Record<string, ShopWindowLimit> = Object.fromEntries(
  ENDPOINTS.map((e) => [e, e === ALL_CPC ? { windowMs: 6 * MIN, max: 1 } : { windowMs: MIN, max: 2 }])
);

async function simulate(opts: { shops: Record<AdsPriority, number>; hours: number; trueAllCpcPerSec: number; seed: number }): Promise<SimResult> {
  let now = 1_700_000_000_000;
  const rand = rng(opts.seed);
  const store = new MemoryRateStore(() => now, rand);
  const deps: GatewayDeps = { store, now: () => now, sleep: async (ms) => void (now += ms), storm: new DistinctShopStorm() };
  const limits: Record<string, { perSec: number; burst: number }> = {};
  for (const e of ENDPOINTS) limits[e] = e === ALL_CPC ? { perSec: opts.trueAllCpcPerSec, burst: 2 } : { perSec: 2, burst: 2 };
  const platform = new FakeShopeeAds(() => now, (ms) => void (now += ms), limits, 50, TRUE_SHOP_LIMITS);

  const shops: Shop[] = [];
  for (const p of [1, 2, 3] as const) {
    for (let i = 0; i < opts.shops[p]; i++) {
      shops.push({
        id: `${p}-${i}`,
        p,
        due: now + rand() * 30 * MIN,
        lastHistory: now - rand() * HISTORY_MIN[p] * MIN,
        late: [],
        pending: null,
        lastWas429: false,
        consecutive429: 0,
      });
    }
  }
  const compute = () =>
    computeCadence({
      shops: opts.shops,
      pulseCalls: SHOPEE_PULSE_CALLS,
      historyCalls: SHOPEE_HISTORY_CALLS,
      historyMin: HISTORY_MIN,
      capacityPerSec: shopeeAdsCapacity(
        [...store.keys].map(([key, s]) => ({ key, factor: s.factor, decreasedAtMs: s.decreasedAtMs })),
        now,
        ENDPOINTS
      ),
      baseMin: 30,
      capMin: { 1: 120, 2: 360, 3: 1440 },
      utilization: 0.8,
      shopEndpointPerMin: shopeeShopEndpointPerMin(ENDPOINTS),
    });
  let cadence = compute();
  let cadenceAt = now;
  const end = now + opts.hours * 3_600_000;
  let pulses = 0;
  let defers = 0;
  let hardApp = 0;
  const jitter = (ms: number) => Math.round(ms * (1 + (rand() * 2 - 1) * 0.15));

  while (now < end) {
    if (now - cadenceAt >= 5 * MIN) {
      cadence = compute();
      cadenceAt = now;
    }
    // Làn: lớp ưu tiên thấp nhất trước, trong lớp hạn cũ nhất trước (adsCandidateOrder).
    let pick: Shop | null = null;
    let nextDue = end;
    for (const s of shops) {
      if (s.due <= now) {
        if (!pick || s.p < pick.p || (s.p === pick.p && s.due < pick.due)) pick = s;
      } else if (s.due < nextDue) nextDue = s.due;
    }
    if (!pick) {
      now = Math.max(now + 20_000, nextDue);
      continue;
    }
    const s = pick;
    s.late.push(now - s.due);
    // A2: lượt trước dở (mốc tươi ≤ 15') → chạy tiếp từ lệnh dở; không thì tính lượt mới.
    let historyDue: boolean;
    let calls: string[];
    if (s.pending && now - s.pending.at <= 15 * MIN) {
      historyDue = s.pending.historyDue;
      calls = s.pending.calls;
    } else {
      historyDue = now - s.lastHistory >= HISTORY_MIN[s.p] * MIN;
      // Gộp lệnh (I6): lịch sử trước (có hôm nay) → xung bỏ 2 lệnh hôm nay.
      calls = [
        ...(historyDue ? Object.keys(SHOPEE_HISTORY_CALLS[s.p]) : []),
        ...Object.keys(SHOPEE_PULSE_CALLS[s.p]).filter((e) => !(historyDue && (e === ALL_CPC || e === PERF))),
      ];
    }
    s.pending = null;
    let k = 0;
    try {
      for (; k < calls.length; k++) {
        const e = calls[k];
        await callMarketplace({ platform: "SHOPEE", app: APP, shop: s.id, endpoint: e }, () => platform.call(e, s.id), deps);
      }
      if (historyDue) s.lastHistory = now;
      pulses++;
      s.lastWas429 = false;
      s.due = now + jitter(cadence.pulseMin[s.p] * MIN);
    } catch (err) {
      if (!isGatewayDefer(err)) throw err;
      defers++;
      if (err.reason === "hard_app") hardApp++;
      if (err.reason === "rate_limit") {
        if (s.lastWas429) s.consecutive429++;
        s.lastWas429 = true;
      }
      // A2: sàn 429 → ≥ 5'; chờ lượt → ≥ 1'; lượt sau chạy tiếp từ lệnh dở.
      s.due = now + Math.max(err.waitMs, err.reason === "rate_limit" ? 5 * MIN : MIN);
      s.pending = { calls: calls.slice(k), historyDue, at: now };
    }
  }
  const p99LateMin = { 1: 0, 2: 0, 3: 0 } as Record<AdsPriority, number>;
  // Độ trễ gồm cả gian ĐANG CHỜ chưa được phục vụ (bỏ đói cũng là trễ) — không thì lớp bị nhường chỗ đo ra 0.
  for (const p of [1, 2, 3] as const) {
    p99LateMin[p] = p99(shops.filter((s) => s.p === p).flatMap((s) => [...s.late, ...(s.due < end ? [end - s.due] : [])])) / MIN;
  }
  return {
    pulses,
    defers,
    hardApp,
    calls: platform.calls,
    rejected: platform.rejected,
    rejectedByShop: platform.rejectedByShop,
    shopsWithBackToBack429: shops.filter((s) => s.consecutive429 > 0).length,
    cadence: compute(),
    p99LateMin,
  };
}

describe("I9 — hệ thống Ads cho MỌI N gian trên sàn giả (trần thật get_all_cpc 0,7/s app + 1/6' mỗi gian; cổng tin 1/s + 1/5' → phải tự học)", () => {
  it("N = 40 (hôm nay): 0 lần dừng app, 429 < 1 % lệnh, không gian nào 429 hai lượt liền, không lớp nào giãn, lớp 1 không trễ hạn chót", async () => {
    const r = await simulate({ shops: { 1: 10, 2: 25, 3: 5 }, hours: 6, trueAllCpcPerSec: 0.7, seed: 1 });
    expect(r.hardApp).toBe(0);
    expect(r.rejected / r.calls).toBeLessThan(0.01);
    expect(r.shopsWithBackToBack429).toBe(0);
    expect(r.cadence.stretched).toEqual({ 1: false, 2: false, 3: false });
    expect(r.cadence.red).toBe(false);
    expect(r.p99LateMin[1]).toBeLessThanOrEqual(r.cadence.pulseMin[1] * 2);
    expect(r.pulses).toBeGreaterThan(40 * 6 * 2 * 0.9); // ~12 xung/gian trong 6 h cho lớp 1–2
  }, 30_000);

  it("N = 1.000: 0 lần dừng app, 429 < 1 % (bão app ≥ 3 gian/60 s → học trần app), < 2 % gian 429 hai lượt liền, chưa đỏ, lớp 1 giữ nhịp gốc và không trễ hạn chót dù lớp 2 có thể giãn", async () => {
    const r = await simulate({ shops: { 1: 100, 2: 700, 3: 200 }, hours: 3, trueAllCpcPerSec: 0.7, seed: 2 });
    expect(r.hardApp).toBe(0);
    expect(r.rejected / r.calls).toBeLessThan(0.01);
    // Bão app (≥ 3 gian/60 s) phải được nhận ra → khóa app × endpoint học xuống; gian dính liền do tranh chấp tầng app là của pha học.
    expect(r.shopsWithBackToBack429).toBeLessThan(1_000 * 0.02);
    expect(r.cadence.red).toBe(false);
    expect(r.cadence.stretched[1]).toBe(false);
    expect(r.p99LateMin[1]).toBeLessThanOrEqual(r.cadence.pulseMin[1] * 2);
  }, 60_000);

  it("N = 10.000: nhu cầu vượt quota thật → ĐỎ (lớp 1 phải giãn) NHƯNG sàn vẫn an toàn: 0 dừng app, 429 < 1 %, < 2 % gian 429 hai lượt liền, lớp 1 được phục vụ trước lớp 3", async () => {
    const r = await simulate({ shops: { 1: 3_000, 2: 5_000, 3: 2_000 }, hours: 2, trueAllCpcPerSec: 0.7, seed: 3 });
    expect(r.hardApp).toBe(0);
    expect(r.rejected / r.calls).toBeLessThan(0.01);
    expect(r.shopsWithBackToBack429).toBeLessThan(10_000 * 0.02);
    expect(r.cadence.red).toBe(true);
    expect(r.cadence.stretched[1]).toBe(true);
    expect(r.cadence.pulseMin[1]).toBe(120);
    // Ưu tiên: lớp 1 trễ ít hơn lớp 3 (lớp 3 bị nhường chỗ khi thiếu quota).
    expect(r.p99LateMin[1]).toBeLessThanOrEqual(r.p99LateMin[3]);
  }, 120_000);

  it("A2 — tái hiện HPGear VN 22/10: gian bị 429 get_all_cpc (trần thật 1/6' < cổng tin 1/5') → cổng học về gian ấy, lượt sau CHẠY TIẾP từ lệnh dở, gian khác không bị kéo, app × endpoint không hạ", async () => {
    let now = 1_700_000_000_000;
    const rand = rng(7);
    const store = new MemoryRateStore(() => now, rand);
    const deps: GatewayDeps = { store, now: () => now, sleep: async (ms) => void (now += ms) };
    const platform = new FakeShopeeAds(() => now, (ms) => void (now += ms), {}, 50, TRUE_SHOP_LIMITS);
    const run = async (shop: string, calls: string[]) => {
      for (let k = 0; k < calls.length; k++) {
        try {
          await callMarketplace({ platform: "SHOPEE", app: APP, shop, endpoint: calls[k] }, () => platform.call(calls[k], shop), deps);
        } catch (err) {
          if (!isGatewayDefer(err)) throw err;
          return { deferredAt: k, reason: err.reason, waitMs: err.waitMs };
        }
      }
      return null;
    };
    const PULSE = Object.keys(SHOPEE_PULSE_CALLS[2]);
    // Lượt 1 của HPGear: 5 lệnh đi lọt (gian mới, cửa sổ trống).
    expect(await run("hpgear", PULSE)).toBeNull();
    // 5' sau Trợ lý trên app "Làm mới" → xung sớm: cổng cho get_all_cpc (1/5' đã hết) nhưng sàn thật 1/6' → 429 ở lệnh thứ 4.
    now += 5 * MIN + 1_000;
    const d = await run("hpgear", PULSE);
    expect(d).toMatchObject({ deferredAt: 3, reason: "rate_limit", waitMs: 60_000 });
    expect(platform.rejectedByShop).toBe(1);
    // Khóa gian × get_all_cpc của HPGear bị hạ; khóa app × endpoint KHÔNG; gian khác gọi get_all_cpc ngay được.
    expect(store.keys.get(`SHOPEE:${APP}|shop:hpgear|ep:${ALL_CPC}`)!.factor).toBe(0.5);
    expect(store.keys.get(`SHOPEE:${APP}|ep:${ALL_CPC}`)?.factor ?? 1).toBe(1);
    expect(await run("xbuy", PULSE)).toBeNull();
    // Làn: ≥ 5' sau chạy TIẾP từ lệnh thứ 4 (không gọi lại 3 lệnh đầu): cửa sổ 6' của sàn đã trôi → 2 lệnh còn lại đi lọt.
    // Tổng 429 của cả màn: 1, lệnh phí: 0 (trước 22/10: 4 lần 429 liền + 9 lệnh phí).
    now += 5 * MIN;
    const calls = platform.calls;
    expect(await run("hpgear", PULSE.slice(3))).toBeNull();
    expect(platform.calls).toBe(calls + 2);
    expect(platform.rejectedByShop).toBe(1);
    expect(store.keys.get(`SHOPEE:${APP}|ep:${ALL_CPC}`)?.factor ?? 1).toBe(1);
  });
});
