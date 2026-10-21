// ============================================================
// I9 — BẰNG CHỨNG BẰNG TEST (thiết kế 13.9, docs/ADS-NHIP-CANH-BAO.md 13.9.1): làn Ads +
// cổng gọi sàn + nhịp tự co chạy trên SÀN GIẢ với N = 40 / 1.000 / 10.000 gian, đồng hồ
// giả. Sàn giả giữ trần THẬT theo app × endpoint THẤP HƠN trần cổng tin (0,7/s vs 1/s)
// để cổng phải tự học bằng AIMD. Bất biến kiểm: không bao giờ "dừng app", 429 < 1 %
// lệnh, lớp 1 không trễ quá hạn chót khi chưa đỏ, 10.000 gian → ĐỎ nhưng sàn vẫn an toàn.
// Mô phỏng tuần tự (một luồng): đủ để chứng minh tính chất, không đo tốc độ tuyệt đối.
// ============================================================
import { describe, expect, it } from "vitest";
import { callMarketplace, isGatewayDefer, MemoryRateStore, type GatewayDeps } from "../marketplace-gateway";
import {
  computeCadence,
  shopeeAdsCapacity,
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

/** Sàn giả: trần THẬT theo endpoint (GCRA), trả 429 error_rate_limit khi vượt. */
class FakeShopeeAds {
  calls = 0;
  rejected = 0;
  private tat = new Map<string, number>();
  constructor(
    private readonly now: () => number,
    private readonly advance: (ms: number) => void,
    private readonly limits: Record<string, { perSec: number; burst: number }>,
    private readonly callMs: number
  ) {}
  async call(endpoint: string): Promise<{ ok: true }> {
    this.calls++;
    const l = this.limits[endpoint];
    if (l) {
      const em = 1000 / l.perSec;
      const t = this.now();
      const tat = Math.max(this.tat.get(endpoint) ?? 0, t) + em;
      if (tat - t > l.burst * em) {
        this.rejected++;
        this.advance(this.callMs);
        throw new Error(`Shopee ${endpoint} lỗi: HTTP 429 — vượt trần gọi API (error_rate_limit)`);
      }
      this.tat.set(endpoint, tat);
    }
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
}

interface SimResult {
  pulses: number;
  defers: number;
  hardApp: number;
  calls: number;
  rejected: number;
  cadence: CadenceResult;
  p99LateMin: Record<AdsPriority, number>;
}

function p99(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
}

async function simulate(opts: { shops: Record<AdsPriority, number>; hours: number; trueAllCpcPerSec: number; seed: number }): Promise<SimResult> {
  let now = 1_700_000_000_000;
  const rand = rng(opts.seed);
  const store = new MemoryRateStore(() => now, rand);
  const deps: GatewayDeps = { store, now: () => now, sleep: async (ms) => void (now += ms) };
  const limits: Record<string, { perSec: number; burst: number }> = {};
  for (const e of ENDPOINTS) limits[e] = e === ALL_CPC ? { perSec: opts.trueAllCpcPerSec, burst: 2 } : { perSec: 2, burst: 2 };
  const platform = new FakeShopeeAds(() => now, (ms) => void (now += ms), limits, 50);

  const shops: Shop[] = [];
  for (const p of [1, 2, 3] as const) {
    for (let i = 0; i < opts.shops[p]; i++) {
      shops.push({ id: `${p}-${i}`, p, due: now + rand() * 30 * MIN, lastHistory: now - rand() * HISTORY_MIN[p] * MIN, late: [] });
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
    const historyDue = now - s.lastHistory >= HISTORY_MIN[s.p] * MIN;
    // Gộp lệnh (I6): lịch sử trước (có hôm nay) → xung bỏ 2 lệnh hôm nay.
    const calls = [
      ...(historyDue ? Object.keys(SHOPEE_HISTORY_CALLS[s.p]) : []),
      ...Object.keys(SHOPEE_PULSE_CALLS[s.p]).filter((e) => !(historyDue && (e === ALL_CPC || e === PERF))),
    ];
    try {
      for (const e of calls) {
        await callMarketplace({ platform: "SHOPEE", app: APP, shop: s.id, endpoint: e }, () => platform.call(e), deps);
      }
      if (historyDue) s.lastHistory = now;
      pulses++;
      s.due = now + jitter(cadence.pulseMin[s.p] * MIN);
    } catch (err) {
      if (!isGatewayDefer(err)) throw err;
      defers++;
      if (err.reason === "hard_app") hardApp++;
      s.due = now + Math.max(err.waitMs, MIN);
    }
  }
  const p99LateMin = { 1: 0, 2: 0, 3: 0 } as Record<AdsPriority, number>;
  // Độ trễ gồm cả gian ĐANG CHỜ chưa được phục vụ (bỏ đói cũng là trễ) — không thì lớp bị nhường chỗ đo ra 0.
  for (const p of [1, 2, 3] as const) {
    p99LateMin[p] = p99(shops.filter((s) => s.p === p).flatMap((s) => [...s.late, ...(s.due < end ? [end - s.due] : [])])) / MIN;
  }
  return { pulses, defers, hardApp, calls: platform.calls, rejected: platform.rejected, cadence: compute(), p99LateMin };
}

describe("I9 — hệ thống Ads cho MỌI N gian trên sàn giả (trần thật get_all_cpc 0,7/s, cổng tin 1/s → phải tự học)", () => {
  it("N = 40 (hôm nay): 0 lần dừng app, 429 < 1 % lệnh, không lớp nào giãn, lớp 1 không trễ hạn chót", async () => {
    const r = await simulate({ shops: { 1: 10, 2: 25, 3: 5 }, hours: 6, trueAllCpcPerSec: 0.7, seed: 1 });
    expect(r.hardApp).toBe(0);
    expect(r.rejected / r.calls).toBeLessThan(0.01);
    expect(r.cadence.stretched).toEqual({ 1: false, 2: false, 3: false });
    expect(r.cadence.red).toBe(false);
    expect(r.p99LateMin[1]).toBeLessThanOrEqual(r.cadence.pulseMin[1] * 2);
    expect(r.pulses).toBeGreaterThan(40 * 6 * 2 * 0.9); // ~12 xung/gian trong 6 h cho lớp 1–2
  }, 30_000);

  it("N = 1.000: 0 lần dừng app, 429 < 1 %, chưa đỏ, lớp 1 giữ nhịp gốc và không trễ hạn chót dù lớp 2 có thể giãn", async () => {
    const r = await simulate({ shops: { 1: 100, 2: 700, 3: 200 }, hours: 3, trueAllCpcPerSec: 0.7, seed: 2 });
    expect(r.hardApp).toBe(0);
    expect(r.rejected / r.calls).toBeLessThan(0.01);
    expect(r.cadence.red).toBe(false);
    expect(r.cadence.stretched[1]).toBe(false);
    expect(r.p99LateMin[1]).toBeLessThanOrEqual(r.cadence.pulseMin[1] * 2);
  }, 60_000);

  it("N = 10.000: nhu cầu vượt quota thật → ĐỎ (lớp 1 phải giãn) NHƯNG sàn vẫn an toàn: 0 dừng app, 429 < 1 %, lớp 1 được phục vụ trước lớp 3", async () => {
    const r = await simulate({ shops: { 1: 3_000, 2: 5_000, 3: 2_000 }, hours: 2, trueAllCpcPerSec: 0.7, seed: 3 });
    expect(r.hardApp).toBe(0);
    expect(r.rejected / r.calls).toBeLessThan(0.01);
    expect(r.cadence.red).toBe(true);
    expect(r.cadence.stretched[1]).toBe(true);
    expect(r.cadence.pulseMin[1]).toBe(120);
    // Ưu tiên: lớp 1 trễ ít hơn lớp 3 (lớp 3 bị nhường chỗ khi thiếu quota).
    expect(r.p99LateMin[1]).toBeLessThanOrEqual(r.p99LateMin[3]);
  }, 120_000);
});
