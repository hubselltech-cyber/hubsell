// ============================================================
// TỔNG QUAN LỢI NHUẬN — phần thuần (lib/realized-pnl-insights.ts):
// kỳ liền trước, bậc biên lãi (CÙNG luật với câu CASE trong SQL), ghép chuỗi
// ngày hai kỳ, % thay đổi; và cầu nối Lợi nhuận ròng (lib/net-profit.ts
// cashFlowNetProfit) phải bằng phép tính cũ của Báo cáo dòng tiền.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  alignDaily,
  deltaPercent,
  marginBucketKey,
  MARGIN_BUCKETS,
  previousRangeOf,
  rangeDays,
} from "../realized-pnl-insights";
import { cashFlowNetProfit } from "../net-profit";

const DAY = 86_400_000;
const vn = (iso: string) => new Date(iso); // mốc tuyệt đối

describe("previousRangeOf", () => {
  it("kỳ liền trước cùng độ dài, sát phía trước (30 ngày → 30 ngày)", () => {
    // 10/10 00:00 VN → 08/11 23:59:59.999 VN
    const range = { gte: vn("2026-10-09T17:00:00.000Z"), lte: vn("2026-11-08T16:59:59.999Z") };
    const prev = previousRangeOf(range)!;
    expect(rangeDays(range)).toBe(30);
    expect(rangeDays(prev)).toBe(30);
    expect(prev.lte.getTime()).toBe(range.gte.getTime() - 1);
    expect(prev.gte.toISOString()).toBe("2026-09-09T17:00:00.000Z");
  });
  it("không lọc ngày → không có kỳ trước", () => {
    expect(previousRangeOf(undefined)).toBeUndefined();
  });
});

describe("deltaPercent", () => {
  it("kỳ trước 0 / thiếu → null; lỗ bớt là dương", () => {
    expect(deltaPercent(10, 0)).toBeNull();
    expect(deltaPercent(10, null)).toBeNull();
    expect(deltaPercent(120, 100)).toBeCloseTo(20);
    expect(deltaPercent(-5, -10)).toBeCloseTo(50);
    expect(deltaPercent(-15, -10)).toBeCloseTo(-50);
  });
});

describe("marginBucketKey — cùng luật với SQL", () => {
  // Phiên bản SQL (ledgerPnlMarginBuckets) viết bằng phép nhân; đây là bản
  // JS tham chiếu — hai bên phải cho cùng kết quả trên mọi biên.
  const sqlRule = (profit: number, net: number) =>
    net <= 0 ? "none"
      : profit < 0 ? "loss"
        : profit * 10 < net ? "m0"
          : profit * 5 < net ? "m10"
            : profit * 10 < net * 3 ? "m20"
              : profit * 2 < net ? "m30"
                : "m50";
  it("bảy bậc đúng biên", () => {
    expect(marginBucketKey(5, 0)).toBe("none");
    expect(marginBucketKey(5, -100)).toBe("none");
    expect(marginBucketKey(-1, 100)).toBe("loss");
    expect(marginBucketKey(0, 100)).toBe("m0");
    expect(marginBucketKey(9.99, 100)).toBe("m0");
    expect(marginBucketKey(10, 100)).toBe("m10");
    expect(marginBucketKey(20, 100)).toBe("m20");
    expect(marginBucketKey(30, 100)).toBe("m30");
    expect(marginBucketKey(49.99, 100)).toBe("m30");
    expect(marginBucketKey(50, 100)).toBe("m50");
  });
  it("khớp SQL trên lưới ngẫu nhiên", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const net = Math.round((rnd() - 0.1) * 500_000);
      const profit = Math.round((rnd() - 0.3) * 300_000);
      expect(marginBucketKey(profit, net)).toBe(sqlRule(profit, net));
    }
    expect(MARGIN_BUCKETS.map((b) => b.key)).toEqual(["loss", "m0", "m10", "m20", "m30", "m50", "none"]);
  });
});

describe("alignDaily", () => {
  it("lấp ngày trống = 0, ngày k so ngày k của kỳ trước", () => {
    const start = Date.UTC(2026, 10, 1); // 01/11 (khóa ngày = UTC date cho test)
    const keyOf = (t: number) => new Date(t).toISOString().slice(0, 10);
    const current = new Map([["2026-11-02", { date: "2026-11-02", profit: 100, netRevenue: 400, orderCount: 2, returnLoss: 5 }]]);
    const previous = new Map([["2026-10-30", { date: "2026-10-30", profit: 40, netRevenue: 90, orderCount: 1, returnLoss: 0 }]]);
    const out = alignDaily({
      days: 3,
      dateKeyOf: (i) => keyOf(start + i * DAY),
      prevKeyOf: (i) => keyOf(start - 3 * DAY + i * DAY),
      labelOf: (k) => k.slice(8, 10) + "/" + k.slice(5, 7),
      current,
      previous,
    });
    expect(out.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(out.map((d) => d.profit)).toEqual([0, 100, 0]);
    expect(out.map((d) => d.prevDate)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(out.map((d) => d.prevProfit)).toEqual([0, 40, 0]);
    expect(out[1].label).toBe("02/11");
  });
  it("không có kỳ trước → prev null", () => {
    const out = alignDaily({
      days: 1,
      dateKeyOf: () => "2026-11-01",
      prevKeyOf: null,
      labelOf: (k) => k,
      current: new Map(),
      previous: new Map(),
    });
    expect(out[0].prevDate).toBeNull();
    expect(out[0].prevProfit).toBeNull();
  });
});

describe("cashFlowNetProfit = phép tính cũ của /api/finance/analytics", () => {
  it("số prod 08/11/2026 (10/10–08/11, Chủ Shop Hubsell): 91.527.678 − 20.009.899 − 18.385.000 = 53.132.779", () => {
    const r = cashFlowNetProfit({
      orderProfit: 37_850_434 + 20_009_899 + 18_385_000 + 15_282_345, // settled + pending (trước khi trừ chi phí)
      adsSpend: 20_009_899,
      operatingExpense: 18_385_000,
      operatingIncome: 0,
      additionalTaxOf: () => 0,
    });
    expect(r.provisionalProfit).toBe(53_132_779);
    expect(r.netProfit).toBe(53_132_779);
  });
  it("thuế dự phòng tính trên LN trước thuế, thu khác cộng vào", () => {
    const r = cashFlowNetProfit({
      orderProfit: 1_000_000,
      adsSpend: 200_000,
      operatingExpense: 100_000,
      operatingIncome: 50_000,
      additionalTaxOf: (p) => p * 0.1,
    });
    expect(r.provisionalProfit).toBe(750_000);
    expect(r.additionalTax).toBe(75_000);
    expect(r.netProfit).toBe(675_000);
  });
});
