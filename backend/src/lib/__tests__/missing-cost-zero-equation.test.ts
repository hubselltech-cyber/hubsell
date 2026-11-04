// ============================================================
// ĐƠN THIẾU GIÁ VỐN TÍNH NHƯ GIÁ VỐN 0 — đẳng thức khóa bằng test (anh Trung
// chốt 02/11/2026, áp 04/11; docs/TAI-CHINH-GIA-VON-0-ROI-ROAS-KHAO-SAT-02-11.md
// mục 8.1 + 8.3). Fixture dùng chung có 2 đơn thiếu giá vốn (f, f2) — mọi báo
// cáo phải cho:   Doanh thu − Σ chi phí = Lợi nhuận   đúng từng đồng, KHÔNG còn
// bậc "phần lợi nhuận bị loại" (đẳng thức 3 vế 30/09 → 04/11). Logic thuần, không DB.
// ============================================================

import { describe, expect, it } from "vitest";
import { cashFlowTotalsFromRows } from "../cash-flow-totals";
import { countsAsRevenue, missingCostApiSummary, summarizeMissingCost } from "../finance-definitions";
import { netProfitAfterProvision } from "../net-profit";
import { overviewTotalsFromRows } from "../overview-totals";
import { computePnlRow } from "../pnl-formula";
import { pnlSummaryTotalsFromRows } from "../realized-pnl-totals";
import { taxReportTotalsFromRows } from "../tax-totals";
import { FIXTURE_ORDERS } from "./ledger-order-fixture";

const PNL_ROWS = FIXTURE_ORDERS.map((o) => computePnlRow(o));
const ACTIVE = PNL_ROWS.filter((r) => countsAsRevenue(r));
/** Σ lợi nhuận MỌI đơn tính doanh thu — đơn thiếu giá vốn góp trọn tiền về (giá vốn 0). */
const PROFIT_ALL_ACTIVE = ACTIVE.reduce((s, r) => s + r.profitAfterTax, 0);

describe("đơn thiếu giá vốn tính như giá vốn 0 — Doanh thu − Σ chi phí = Lợi nhuận ở mọi báo cáo", () => {
  const missing = summarizeMissingCost(ACTIVE);

  it("fixture có đơn thiếu giá vốn và phần lợi nhuận của chúng khác 0 (test mới có ý nghĩa)", () => {
    expect(missing.orderCount).toBe(2);
    expect(missing.profitAtZeroCost).not.toBe(0);
  });

  it("Tổng quan: Doanh thu − Giá vốn − Sàn khấu trừ = Σ lợi nhuận mọi đơn (kể cả đơn thiếu giá vốn)", () => {
    const t = overviewTotalsFromRows(PNL_ROWS);
    const a = t.active;
    expect(a.revenueGross - a.costSnapshot - a.platformDeduction).toBeCloseTo(PROFIT_ALL_ACTIVE, 6);
    // Không có bậc nào khác xen vào: netProfitAfterProvision không opex/thu khác/thuế ra đúng số đó.
    const net = netProfitAfterProvision({
      grossProfit: a.revenueGross - a.costSnapshot,
      platformFee: a.platformDeduction,
      operatingExpense: 0,
      operatingIncome: 0,
      additionalTaxOf: () => 0,
    });
    expect(net.netProfit).toBeCloseTo(PROFIT_ALL_ACTIVE, 6);
    // Số đơn thiếu vẫn đếm để nhắc; Σ lợi nhuận của chúng chỉ tham khảo, KHÔNG trừ.
    expect(a.missingCostCount).toBe(2);
    expect(a.missingCostProfit).toBeCloseTo(missing.profitAtZeroCost, 6);
  });

  it("Báo cáo dòng tiền: Lợi nhuận thực tế + dự kiến = Σ lợi nhuận mọi đơn = số của Tổng quan", () => {
    const t = cashFlowTotalsFromRows(PNL_ROWS);
    expect(t.settled.profitAfterTax + t.pending.profitAfterTax).toBeCloseTo(PROFIT_ALL_ACTIVE, 6);
    // Thẻ Doanh thu (Σ platformRevenue) − giá vốn = lợi nhuận: cùng đẳng thức với Tổng quan.
    const revenue = t.settled.platformRevenue + t.pending.platformRevenue;
    expect(revenue - t.active.costSnapshot).toBeCloseTo(PROFIT_ALL_ACTIVE, 6);
    expect(t.active.missingCostCount).toBe(2);
  });

  it("Lãi/Lỗ thực hiện: tổng kỳ = Σ sàn = Σ ngày = Σ lợi nhuận mọi đơn khớp lọc", () => {
    const t = pnlSummaryTotalsFromRows(ACTIVE);
    expect(t.profit).toBeCloseTo(PROFIT_ALL_ACTIVE, 6);
    expect([...t.byPlatform.values()].reduce((s, b) => s + b.profit, 0)).toBeCloseTo(PROFIT_ALL_ACTIVE, 6);
    expect([...t.byDay.values()].reduce((s, d) => s + d.profit, 0)).toBeCloseTo(PROFIT_ALL_ACTIVE, 6);
    expect(t.missingCostCount).toBe(2);
  });

  it("Thuế bổ sung đi theo cùng lợi nhuận: cơ sở = Σ lợi nhuận mọi đơn không hủy (thuế cộng cả đơn đang hoàn)", () => {
    const t = taxReportTotalsFromRows(PNL_ROWS);
    const expected = PNL_ROWS.filter((r) => r.shippingStatus !== "CANCELLED").reduce((s, r) => s + r.profitAfterTax, 0);
    expect(t.profit).toBeCloseTo(expected, 6);
    expect(t.missingCostCount).toBe(2);
  });

  it("hợp đồng API màn khách: missingCost.excludedProfit luôn 0 → mobile cũ không trừ hai lần", () => {
    expect(missingCostApiSummary(missing.orderCount)).toEqual({ orderCount: 2, excludedProfit: 0 });
  });
});
