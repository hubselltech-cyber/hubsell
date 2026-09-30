// ============================================================
// TỔNG QUAN — hai nguồn số phải cho CÙNG bộ tổng (lib/overview-totals.ts).
//   Đường cũ:  overviewTotalsFromRows(computePnlRow(đơn)...)
//   Đường mới: overviewTotalsFromLedger(nhóm active của sổ, bảng bóc GROUP BY)
// Logic THUẦN, không DB.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildLedgerRows,
  summarizeLedgerRowsInMemory,
  type OrderLedgerRow,
} from "../order-ledger";
import { computePnlRow } from "../pnl-formula";
import {
  gmvMaxRowsOf,
  overviewTotalsFromLedger,
  overviewTotalsFromRows,
  type LedgerOverviewBreakdown,
  type OverviewTotals,
} from "../overview-totals";
import { resolveReportSource } from "../report-source";
import { FIXTURE_ORDERS } from "./ledger-order-fixture";

/** Bảng bóc GROUP BY như services/order-ledger.ts làm trong database, cộng trong RAM từ dòng sổ. */
function breakdownInMemory(rows: OrderLedgerRow[]): LedgerOverviewBreakdown {
  const byChannelId: LedgerOverviewBreakdown["byChannelId"] = new Map();
  const byDay: LedgerOverviewBreakdown["byDay"] = new Map();
  for (const r of rows) {
    if (!r.countsAsRevenue) continue;
    const ch = byChannelId.get(r.channelId) ?? { count: 0, revenueGross: 0, feeGmvMax: 0 };
    ch.count += 1;
    ch.revenueGross += r.revenueGross;
    ch.feeGmvMax += r.feeGmvMax;
    byChannelId.set(r.channelId, ch);
    const d = byDay.get(r.createdDate) ?? { count: 0, revenueGross: 0, costSnapshot: 0, platformDeduction: 0 };
    d.count += 1;
    d.revenueGross += r.revenueGross;
    d.costSnapshot += r.costSnapshot;
    d.platformDeduction += r.platformDeduction;
    byDay.set(r.createdDate, d);
  }
  return { byChannelId, byDay };
}

function expectSameTotals(a: OverviewTotals, b: OverviewTotals) {
  const ga = a.active as unknown as Record<string, number>;
  const gb = b.active as unknown as Record<string, number>;
  expect(Object.keys(ga).sort()).toEqual(Object.keys(gb).sort());
  for (const k of Object.keys(ga)) expect(ga[k], `active.${k}`).toBeCloseTo(gb[k], 6);
  for (const m of ["byChannelId", "byDay"] as const) {
    expect([...a[m].keys()].sort(), m).toEqual([...b[m].keys()].sort());
    for (const [k, v] of a[m]) {
      const w = b[m].get(k) as unknown as Record<string, number>;
      for (const [f, x] of Object.entries(v)) expect(x, `${m}.${k}.${f}`).toBeCloseTo(w[f], 6);
    }
  }
}

describe("overviewTotals — đường sổ cái = đường kéo đơn từng đồng", () => {
  const pnlRows = FIXTURE_ORDERS.map((o) => computePnlRow(o));
  const fromRows = overviewTotalsFromRows(pnlRows);
  const ledgerRows = FIXTURE_ORDERS.map((o) => buildLedgerRows(o).order);
  const fromLedger = overviewTotalsFromLedger(summarizeLedgerRowsInMemory(ledgerRows), breakdownInMemory(ledgerRows));

  it("mọi cột của nhóm đơn tính doanh thu, bóc theo gian và theo ngày đều bằng nhau", () => {
    expectSameTotals(fromLedger, fromRows);
  });

  it("chỉ cộng đơn tính doanh thu: bỏ đơn hủy và đơn đang hoàn", () => {
    expect(fromRows.active.count).toBe(7);
    // 6 đơn 369k + đơn g 369k (269k + 2 × 50k)
    expect(fromRows.active.revenueGross).toBe(7 * 369000);
    // Số món: a, b, b2, e mỗi đơn 2 món; f, f2 mỗi đơn 1 món; g 3 món (1 + 2)
    expect(fromRows.active.totalQuantity).toBe(4 * 2 + 2 * 1 + 3);
    expect(fromRows.active.missingCostCount).toBe(2);
    expect(fromRows.byChannelId.get("c1")?.count).toBe(6);
    expect(fromRows.byChannelId.get("c2")?.count).toBe(1);
    expect([...fromRows.byDay.keys()].sort()).toEqual(["2026-09-11", "2026-09-12", "2026-09-20"]);
    expect(fromRows.byDay.get("2026-09-11")?.count).toBe(5);
  });

  it("sàn khấu trừ = Σ (giá trị đơn − tổng tiền sàn báo); Σ theo ngày = Σ theo gian = tổng", () => {
    const expected = pnlRows
      .filter((r) => fromRows.byChannelId.has(r.channelId))
      .filter((r) => r.shippingStatus !== "CANCELLED" && !["AWAITING", "RECEIVED", "DAMAGED"].includes(r.returnStatus))
      .reduce((s, r) => s + (r.revenueGross - r.platformRevenue), 0);
    expect(fromLedger.active.platformDeduction).toBeCloseTo(expected, 6);
    const sumDay = [...fromLedger.byDay.values()].reduce((s, d) => s + d.platformDeduction, 0);
    expect(sumDay).toBeCloseTo(fromLedger.active.platformDeduction, 6);
    const sumRevCh = [...fromLedger.byChannelId.values()].reduce((s, d) => s + d.revenueGross, 0);
    expect(sumRevCh).toBeCloseTo(fromLedger.active.revenueGross, 6);
    const sumCount = [...fromLedger.byDay.values()].reduce((s, d) => s + d.count, 0);
    expect(sumCount).toBe(fromLedger.active.count);
  });

  it("gmvMaxRowsOf: mỗi gian một dòng Σ feeGmvMax (đầu vào của platformAdsSpend)", () => {
    const rows = gmvMaxRowsOf(fromLedger);
    expect(rows.map((r) => r.channelId).sort()).toEqual(["c1", "c2"]);
    for (const r of rows) expect(r.feeGmvMax).toBe(0);
  });

  it("tập rỗng → mọi số 0", () => {
    const e = overviewTotalsFromRows([]);
    expect(e.active.count).toBe(0);
    expect(e.active.revenueGross).toBe(0);
    expect(e.byDay.size).toBe(0);
  });
});

describe("resolveReportSource — ?source= thắng env, mặc định sổ cái", () => {
  it("mặc định ledger; env orders lui về đường cũ; query hợp lệ thắng env", () => {
    expect(resolveReportSource(undefined, undefined)).toBe("ledger");
    expect(resolveReportSource(undefined, "orders")).toBe("orders");
    expect(resolveReportSource("ledger", "orders")).toBe("ledger");
    expect(resolveReportSource("ORDERS", undefined)).toBe("orders");
    expect(resolveReportSource("x", undefined)).toBe("ledger");
  });
});
