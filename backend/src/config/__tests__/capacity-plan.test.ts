// Hàm thuần của kế hoạch sức chứa (mục Sức khỏe HQ, docs/HQ-SUC-KHOE.md).
import { describe, expect, it } from "vitest";
import {
  CAPACITY_MILESTONES,
  daysToReach,
  isMilestoneReached,
  levelFor,
  locateOnTimeline,
  milestoneEta,
  slopePerDay,
  type GrowthMetrics,
} from "../capacity-plan";

const base: GrowthMetrics = { channels: 3, owners: 5, ordersPerDay: 40, dbPct: 10, ramPct: 30, connPct: 10 };

describe("timeline mốc", () => {
  it("M0 luôn chạm; 3 gian đang ở M0, kế tiếp M1", () => {
    const { current, next } = locateOnTimeline(base);
    expect(current.key).toBe("M0");
    expect(next?.key).toBe("M1");
  });
  it("chạm mốc khi BẤT KỲ điều kiện đúng — 25 gian đủ M1 dù chủ shop ít", () => {
    const m1 = CAPACITY_MILESTONES.find((m) => m.key === "M1")!;
    expect(isMilestoneReached(m1, { ...base, channels: 25 })).toBe(true);
    expect(isMilestoneReached(m1, { ...base, dbPct: 65 })).toBe(true);
    expect(isMilestoneReached(m1, base)).toBe(false);
  });
  it("mốc đang ở = mốc cao nhất đã chạm theo thứ tự; 120 gian → M2, kế M3", () => {
    const { current, next } = locateOnTimeline({ ...base, channels: 120, owners: 200 });
    expect(current.key).toBe("M2");
    expect(next?.key).toBe("M3");
  });
  it("vượt mọi mốc → next = null", () => {
    expect(locateOnTimeline({ ...base, channels: 20000 }).next).toBeNull();
  });
  it("mốc nào cũng có checklist, mốc ≥M1 có điều kiện + nâng gói", () => {
    for (const m of CAPACITY_MILESTONES) {
      expect(m.checklist.length).toBeGreaterThan(0);
      if (m.key !== "M0") {
        expect(m.conditions.length).toBeGreaterThan(0);
        expect(m.upgrades.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("dự báo ETA", () => {
  const day = 24 * 3600 * 1000;
  const series = (start: number, perDay: number, n = 10) =>
    Array.from({ length: n }, (_, i) => ({ t: i * day, v: start + perDay * i }));

  it("slope theo ngày từ chuỗi tăng đều; thiếu điểm hoặc không tăng → null", () => {
    expect(slopePerDay(series(3, 2))).toBeCloseTo(2, 5);
    expect(slopePerDay(series(3, 2, 5))).toBeNull();
    expect(slopePerDay(series(10, 0))).toBeNull();
    expect(slopePerDay(series(10, -1))).toBeNull();
  });
  it("daysToReach: đã vượt = 0; không tăng = null; tăng 2/ngày từ 3 tới 20 = 9 ngày", () => {
    expect(daysToReach(25, 20, 2)).toBe(0);
    expect(daysToReach(3, 20, null)).toBeNull();
    expect(daysToReach(3, 20, 2)).toBe(9);
  });
  it("milestoneEta lấy điều kiện chạm SỚM NHẤT", () => {
    const m1 = CAPACITY_MILESTONES.find((m) => m.key === "M1")!;
    const eta = milestoneEta(m1, base, { channels: 1, owners: 10 }); // owners 5→50 = 5 ngày, channels 3→20 = 17
    expect(eta.days).toBe(5);
    expect(eta.by?.metric).toBe("owners");
    expect(milestoneEta(m1, base, {}).days).toBeNull();
  });
});

describe("levelFor", () => {
  it("vàng/đỏ theo ngưỡng", () => {
    expect(levelFor(10, 60, 80)).toBe("ok");
    expect(levelFor(65, 60, 80)).toBe("warn");
    expect(levelFor(80, 60, 80)).toBe("crit");
  });
});
