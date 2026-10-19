import { describe, expect, it } from "vitest";
import { backoffMs, currentFactor, FRESH_KEY, gcraTake, penalize, type KeyLimit, type KeyState } from "../rate-gate";

const REC = 60 * 60_000;

function run(limits: KeyLimit[], times: number[], n = 1) {
  const states = new Map<string, KeyState>();
  return times.map((t) => {
    const d = gcraTake(states, limits, t, n, REC);
    if (d.waitMs === 0) for (const [k, tat] of d.newTat) states.set(k, { ...(states.get(k) ?? FRESH_KEY), tatMs: tat });
    return d.waitMs;
  });
}

describe("GCRA nhiều khóa (N4)", () => {
  it("2 lượt/giây dồn 2: hai lượt đầu qua, lượt ba chờ 500 ms", () => {
    const lim = [{ key: "a", emissionMs: 500, burst: 2 }];
    expect(run(lim, [0, 0, 0])).toEqual([0, 0, 500]);
    expect(run(lim, [0, 0, 500])).toEqual([0, 0, 0]);
  });

  it("tất cả hoặc không: khóa chặt hơn chặn thì khóa kia KHÔNG bị trừ lượt", () => {
    const states = new Map<string, KeyState>();
    const lim = [
      { key: "loose", emissionMs: 100, burst: 10 },
      { key: "tight", emissionMs: 1000, burst: 1 },
    ];
    const a = gcraTake(states, lim, 0, 1, REC);
    for (const [k, tat] of a.newTat) states.set(k, { ...FRESH_KEY, tatMs: tat });
    const b = gcraTake(states, lim, 0, 1, REC);
    expect(b.waitMs).toBe(1000);
    expect(states.get("loose")!.tatMs).toBe(100);
  });

  it("xin theo lô bị kẹp ≤ burst; khóa không trần chỉ xét mốc lùi", () => {
    const lim = [
      { key: "a", emissionMs: 100, burst: 3 },
      { key: "free", emissionMs: 0, burst: 1 },
    ];
    expect(run(lim, [0], 50)).toEqual([0]);
    const states = new Map<string, KeyState>([["free", { ...FRESH_KEY, blockedUntilMs: 5_000, failures: 2 }]]);
    const d = gcraTake(states, lim, 1_000, 1, REC);
    expect(d.waitMs).toBe(4_000);
    expect(d.failedKeys).toEqual(["free"]);
  });

  it("AIMD: nhịp hạ một nửa thì khoảng cách lượt gấp đôi, hồi dần theo thời gian", () => {
    const s: KeyState = { ...FRESH_KEY, factor: 0.5, decreasedAtMs: 0 };
    expect(currentFactor(s, 0, REC)).toBe(0.5);
    expect(currentFactor(s, REC / 4, REC)).toBe(0.75);
    expect(currentFactor(s, REC, REC)).toBe(1);
    const d = gcraTake(new Map([["a", s]]), [{ key: "a", emissionMs: 500, burst: 1 }], 0, 1, REC);
    expect(d.newTat.get("a")).toBe(1000);
  });
});

describe("lùi theo khóa (N5)", () => {
  const rule = { baseMs: 1000, capMs: 60_000, jitter: true };
  it("full jitter trong [0, gốc × 2^(n−1)], trần; Retry-After là sàn dưới", () => {
    expect(backoffMs(1, rule, 1)).toBe(1000);
    expect(backoffMs(4, rule, 1)).toBe(8000);
    expect(backoffMs(4, rule, 0.25)).toBe(2000);
    expect(backoffMs(20, rule, 1)).toBe(60_000);
    expect(backoffMs(1, rule, 0, 30_000)).toBe(30_000);
    expect(backoffMs(3, { ...rule, jitter: false }, 0)).toBe(4000);
  });

  it("penalize tăng đếm, đẩy mốc lùi, hạ nhịp khi có decrease", () => {
    const a = penalize(FRESH_KEY, { ...rule, decrease: true, minFactor: 0.1 }, 10_000, 1, REC);
    expect(a.failures).toBe(1);
    expect(a.blockedUntilMs).toBe(11_000);
    expect(a.factor).toBe(0.5);
    const b = penalize(a, { ...rule, decrease: true, minFactor: 0.4 }, 10_000, 1, REC);
    expect(b.factor).toBe(0.4);
    expect(b.blockedUntilMs).toBe(12_000);
  });
});
