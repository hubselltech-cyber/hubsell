import { describe, expect, it } from "vitest";
import { TaxCalculationBase, TaxFilterPeriod } from "@prisma/client";
import { netProfitAfterProvision } from "../net-profit";
import { additionalTaxOn } from "../../config/tax-config";

/**
 * Đẳng thức hai báo cáo phải cho CÙNG một Lợi nhuận ròng trên cùng tập đơn:
 *   Tổng quan:      Σ revenueGross − Σ cost − Σ (revenueGross − platformRevenue)
 *                   − LN đơn thiếu vốn − chi phí + thu khác − thuế
 *   Dòng tiền:      Σ profitAfterTax(đơn có vốn) − chi phí + thu khác − thuế
 * với profitAfterTax = platformRevenue − cost (lib/pnl-formula.ts).
 */
describe("netProfitAfterProvision — một đẳng thức cho Tổng quan và Báo cáo dòng tiền", () => {
  const orders = [
    { revenueGross: 300_000, platformRevenue: 250_000, cost: 120_000, missingCost: false },
    { revenueGross: 200_000, platformRevenue: 170_000, cost: 0, missingCost: true }, // chưa có giá vốn
    { revenueGross: 150_000, platformRevenue: 130_000, cost: 160_000, missingCost: false }, // đơn lỗ
  ];
  const ads = 67_000;
  const ops = 15_000;
  const income = 40_000;
  const taxCfg = {
    customTaxRate: 0.1,
    calculationBase: TaxCalculationBase.PROFIT,
    filterPeriod: TaxFilterPeriod.MONTH,
  };

  const revenueGross = orders.reduce((s, o) => s + o.revenueGross, 0);
  const cost = orders.reduce((s, o) => s + o.cost, 0);
  const platformFee = orders.reduce((s, o) => s + (o.revenueGross - o.platformRevenue), 0);
  const excludedProfit = orders
    .filter((o) => o.missingCost)
    .reduce((s, o) => s + (o.platformRevenue - o.cost), 0);

  it("Tổng quan (thác nước) = Báo cáo dòng tiền (cột Lợi nhuận)", () => {
    const overview = netProfitAfterProvision({
      grossProfit: revenueGross - cost,
      platformFee,
      operatingExpense: ads + ops,
      excludedProfit,
      operatingIncome: income,
      additionalTaxOf: (p) => additionalTaxOn({ grossRevenue: revenueGross, profit: p }, taxCfg),
    });

    // Cách tính của /api/finance/analytics
    const profitWithCost = orders
      .filter((o) => !o.missingCost)
      .reduce((s, o) => s + (o.platformRevenue - o.cost), 0);
    const provisional = profitWithCost - ads - ops + income;
    const cashFlowNet =
      provisional - additionalTaxOn({ grossRevenue: revenueGross, profit: provisional }, taxCfg);

    expect(overview.provisionalProfit).toBe(provisional);
    expect(overview.netProfit).toBe(cashFlowNet);
    // Số cụ thể để ai đọc test cũng tự cộng lại được:
    // (250−120) + (130−160) = 100k; −67k −15k +40k = 58k; thuế 10% = 5,8k → 52,2k
    expect(overview.provisionalProfit).toBe(58_000);
    expect(overview.additionalTax).toBe(5_800);
    expect(overview.netProfit).toBe(52_200);
  });

  it("không thu khác, không thuế → công thức cũ của Tổng quan", () => {
    const r = netProfitAfterProvision({
      grossProfit: 1_000,
      platformFee: 100,
      operatingExpense: 200,
      excludedProfit: 50,
      operatingIncome: 0,
      additionalTaxOf: () => 0,
    });
    expect(r.netProfit).toBe(650);
    expect(r.additionalTax).toBe(0);
  });

  it("lỗ trước thuế thì thuế dự phòng = 0 (additionalTaxOn kẹp max 0)", () => {
    const r = netProfitAfterProvision({
      grossProfit: -500_000,
      platformFee: 0,
      operatingExpense: 0,
      excludedProfit: 0,
      operatingIncome: 0,
      additionalTaxOf: (p) => additionalTaxOn({ grossRevenue: 0, profit: p }, taxCfg),
    });
    expect(r.additionalTax).toBe(0);
    expect(r.netProfit).toBe(-500_000);
  });
});
