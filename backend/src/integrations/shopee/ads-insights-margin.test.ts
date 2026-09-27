// Biên lãi Shopee/Lazada: đơn THIẾU GIÁ VỐN bị loại khỏi phép tính (28/09/2026,
// anh Trung: "không được sai giá vốn trong lãi lỗ kéo theo ROAS hòa vốn").
import { describe, expect, it } from "vitest";
import {
  MARGIN_MIN_COST_COVERAGE_PCT,
  lowCostCoverage,
  marginOf,
  marginOverRows,
  type PnlRow,
} from "./ads-insights";

function row(p: { sku: string; price: number; qty?: number; revenue: number; profit: number; missing?: boolean }): PnlRow {
  return {
    items: [{ sku: p.sku, price: p.price, quantity: p.qty ?? 1 }],
    actualRevenue: p.revenue,
    profit: p.profit,
    missingCostPrice: p.missing ?? false,
  } as unknown as PnlRow;
}

describe("marginOverRows — loại đơn thiếu giá vốn", () => {
  it("đơn giá vốn 0 không được cộng vào tử/mẫu; doanh thu của nó vào missingCostRevenue", () => {
    const rows = [
      row({ sku: "A", price: 100, revenue: 100, profit: 30 }),
      // giá vốn 0 → profit "ảo" 80 (chỉ trừ phí sàn); trước 28/09 bị cộng vào
      row({ sku: "A", price: 100, revenue: 100, profit: 80, missing: true }),
    ];
    const base = marginOverRows(rows, null);
    expect(base.orders).toBe(1);
    expect(base.revenue).toBe(100);
    expect(base.profit).toBe(30);
    expect(base.missingCostOrders).toBe(1);
    expect(base.missingCostRevenue).toBe(100);
    expect(base.costCoveragePct).toBe(50);
    // biên lãi thật 30% (không phải (30+80)/200 = 55% như trước)
    expect(base.profit / base.revenue).toBeCloseTo(0.3);
  });

  it("độ phủ dưới ngưỡng → marginOf null, lowCostCoverage true (không kết luận ROAS hòa vốn)", () => {
    const rows = [
      row({ sku: "A", price: 100, revenue: 100, profit: 30 }),
      row({ sku: "A", price: 100, revenue: 100, profit: 80, missing: true }),
    ];
    const base = marginOverRows(rows, null);
    expect(base.costCoveragePct).toBeLessThan(MARGIN_MIN_COST_COVERAGE_PCT);
    expect(marginOf(base)).toBeNull();
    expect(lowCostCoverage(base)).toBe(true);
  });

  it("đủ độ phủ → biên lãi tính trên đúng các đơn có giá vốn", () => {
    const rows = Array.from({ length: 19 }, () => row({ sku: "A", price: 100, revenue: 100, profit: 25 }));
    rows.push(row({ sku: "A", price: 100, revenue: 100, profit: 90, missing: true }));
    const base = marginOverRows(rows, null);
    expect(base.costCoveragePct).toBe(95);
    expect(marginOf(base)).toBeCloseTo(0.25);
    expect(lowCostCoverage(base)).toBe(false);
  });

  it("lọc theo SKU: đơn nhiều SKU phân bổ theo tỷ trọng, đơn thiếu giá vốn vẫn bị loại", () => {
    const multi = {
      items: [
        { sku: "A", price: 100, quantity: 1 },
        { sku: "B", price: 300, quantity: 1 },
      ],
      actualRevenue: 400,
      profit: 100,
      missingCostPrice: false,
    } as unknown as PnlRow;
    const missingA = row({ sku: "A", price: 100, revenue: 100, profit: 90, missing: true });
    const base = marginOverRows([multi, missingA], new Set(["A"]));
    expect(base.orders).toBe(1);
    expect(base.revenue).toBeCloseTo(100); // 400 × 1/4
    expect(base.profit).toBeCloseTo(25);
    expect(base.missingCostOrders).toBe(1);
    expect(base.missingCostRevenue).toBeCloseTo(100);
  });

  it("chưa có đơn nào → coverage null, margin null, không coi là độ phủ thấp", () => {
    const base = marginOverRows([], null);
    expect(base.costCoveragePct).toBeNull();
    expect(marginOf(base)).toBeNull();
    expect(lowCostCoverage(base)).toBe(false);
  });
});
