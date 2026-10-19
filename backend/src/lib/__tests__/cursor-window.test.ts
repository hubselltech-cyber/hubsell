import { describe, expect, it } from "vitest";
import { canShrink, growWindow, planWindow, shrinkWindow, totalOverflows, type WindowConfig } from "../cursor-window";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const cfg: WindowConfig = {
  pagesPerWindow: 20,
  minWindowMs: MIN,
  maxWindowMs: 15 * DAY,
  growBelowRatio: 0.25,
  shrinkTargetRatio: 0.7,
};

describe("cửa sổ tự co (N3)", () => {
  it("planWindow cắt ở mốc cuối, null khi đã đuổi kịp", () => {
    expect(planWindow(0, 10 * MIN, 4 * MIN, cfg)).toEqual({ from: 0, to: 4 * MIN });
    expect(planWindow(0, 30 * DAY, 100 * DAY, cfg)).toEqual({ from: 0, to: 15 * DAY });
    expect(planWindow(5, MIN, 5, cfg)).toBeNull();
  });

  it("shrinkWindow: không tổng → chia đôi; có tổng → co theo tỷ lệ; luôn nhỏ hơn, không dưới đáy", () => {
    const w = { from: 0, to: 8 * 60 * MIN };
    expect(shrinkWindow(w, cfg)).toBe(4 * 60 * MIN);
    // 20 trang × 100 × 0,7 = 1.400 dòng vừa; tổng 14.000 → 1/10 cửa sổ
    expect(shrinkWindow(w, cfg, { total: 14_000, pageSize: 100 })).toBe(48 * MIN);
    expect(shrinkWindow({ from: 0, to: 90_000 }, cfg)).toBe(MIN);
    expect(canShrink({ from: 0, to: MIN }, cfg)).toBe(false);
  });

  it("growWindow: chỉ nới khi đọc đủ độ dài đã học và dùng ≤ 25 % K", () => {
    const learned = 60 * MIN;
    expect(growWindow(learned, { from: 0, to: learned }, 5, cfg)).toBe(2 * learned);
    expect(growWindow(learned, { from: 0, to: learned }, 6, cfg)).toBe(learned);
    expect(growWindow(learned, { from: 0, to: learned / 2 }, 1, cfg)).toBe(learned);
    expect(growWindow(10 * DAY, { from: 0, to: 10 * DAY }, 1, cfg)).toBe(15 * DAY);
  });

  it("totalOverflows biết trước cửa sổ tràn K trang", () => {
    expect(totalOverflows(2_000, 100, cfg)).toBe(false);
    expect(totalOverflows(2_001, 100, cfg)).toBe(true);
    expect(totalOverflows(undefined, 100, cfg)).toBe(false);
  });
});
