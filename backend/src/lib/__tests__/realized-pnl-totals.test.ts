// ============================================================
// LÃI/LỖ THỰC HIỆN — bộ tổng hai nguồn phải bằng nhau (lib/realized-pnl-totals.ts)
//   · pnlSummaryTotalsFromRows  = summarizePnlRows cũ (tổng kết trang Lãi/Lỗ);
//   · cộng từ dòng sổ (phép cộng của SQL) = cộng từ dòng computePnlRow,
//     với MỌI bộ lọc của bảng.
// Logic THUẦN, không DB.
// ============================================================

import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import { buildLedgerRows } from "../order-ledger";
import { computePnlRow } from "../pnl-formula";
import {
  encodePnlCursor,
  escapeLike,
  matchesPnlFilter,
  parsePnlCursor,
  pnlSummaryTotalsFromLedgerRows,
  pnlSummaryTotalsFromRows,
  type LedgerPnlFilter,
  type PnlSummaryTotals,
} from "../realized-pnl-totals";
import { summarizePnlRows } from "../../routes/finance";
import { DEFAULT_TAX_CONFIG } from "../../config/tax-config";
import { FIXTURE_ORDERS, mkOrder, D } from "./ledger-order-fixture";

// Thêm đơn lỗ + mã đơn khác nhau để bộ lọc "Lợi nhuận âm" và tìm mã đơn có việc làm.
const ORDERS = [
  ...FIXTURE_ORDERS.map((o, i) => ({ ...o, orderCode: `2609TEST${String.fromCharCode(65 + i)}` })),
  mkOrder({ id: "loss", orderCode: "2609LOSS01", actualPayout: D(100000) }), // về ví 100k < vốn 171k
];
const PNL_ROWS = ORDERS.map((o) => computePnlRow(o));
const LEDGER_ROWS = ORDERS.map((o) => buildLedgerRows(o).order);

function expectSame(a: PnlSummaryTotals, b: PnlSummaryTotals) {
  for (const k of [
    "count", "settledCount", "netRevenue", "returnCount", "refundedAmount", "revenueGross",
    "platformTax", "profitWithCost", "missingCostCount", "missingCostExcludedProfit",
  ] as const) {
    expect(a[k], k).toBeCloseTo(b[k], 6);
  }
  for (const k of ["costLoss", "platformKept", "refundLoss"] as const) {
    expect(a.returnLoss[k], `returnLoss.${k}`).toBeCloseTo(b.returnLoss[k], 6);
  }
  for (const m of ["byPlatform", "byDay"] as const) {
    expect([...a[m].keys()].sort(), m).toEqual([...b[m].keys()].sort());
    for (const [key, v] of a[m]) {
      const w = b[m].get(key) as unknown as Record<string, number>;
      for (const [f, x] of Object.entries(v)) expect(x, `${m}.${key}.${f}`).toBeCloseTo(w[f], 6);
    }
  }
}

describe("pnlSummaryTotals — bằng tổng kết cũ và bằng phép cộng trên sổ", () => {
  it("pnlSummaryTotalsFromRows = summarizePnlRows (tổng kết trang Lãi/Lỗ trước 30/09/2026)", () => {
    const t = pnlSummaryTotalsFromRows(PNL_ROWS);
    const old = summarizePnlRows(PNL_ROWS, DEFAULT_TAX_CONFIG);
    expect(t.profitWithCost).toBeCloseTo(old.totalProfit, 6);
    expect(t.revenueGross).toBeCloseTo(old.totalGrossRevenue, 6);
    expect(t.platformTax).toBeCloseTo(old.totalPlatformTax, 6);
    expect({ orderCount: t.missingCostCount, excludedProfit: t.missingCostExcludedProfit }).toEqual(old.missingCost);
    expect(t.returnLoss.costLoss).toBeCloseTo(old.returnLoss.costLoss, 6);
    expect(t.returnLoss.platformKept).toBeCloseTo(old.returnLoss.platformKept, 6);
    expect(t.returnLoss.refundLoss).toBeCloseTo(old.returnLoss.refundLoss, 6);
    expect(t.returnLoss.costLoss + t.returnLoss.platformKept + t.returnLoss.refundLoss).toBeCloseTo(old.returnLoss.total, 6);
    expect(Object.fromEntries(t.byPlatform)).toEqual(old.byPlatform);
    expect(Object.fromEntries(t.byDay)).toEqual(Object.fromEntries(old.dayAgg));
    // Bất biến của trang: Σ theo ngày = Σ theo sàn = tổng.
    const sumDay = [...t.byDay.values()].reduce((s, d) => s + d.profit, 0);
    const sumPlatform = [...t.byPlatform.values()].reduce((s, d) => s + d.profit, 0);
    expect(sumDay).toBeCloseTo(t.profitWithCost, 6);
    expect(sumPlatform).toBeCloseTo(t.profitWithCost, 6);
  });

  const FILTERS: { name: string; f: LedgerPnlFilter; count: number }[] = [
    { name: "không lọc", f: {}, count: 10 },
    { name: "Đã giao", f: { shippingStatus: ShippingStatus.DELIVERED }, count: 8 },
    { name: "Đang giao", f: { shippingStatus: ShippingStatus.SHIPPING }, count: 1 },
    { name: "Đã hủy", f: { shippingStatus: ShippingStatus.CANCELLED }, count: 1 },
    { name: "Hoàn/Trả", f: { returnsOnly: true }, count: 2 },
    { name: "Lợi nhuận âm", f: { lossOnly: true }, count: 2 }, // đơn đang hoàn (−171k) + đơn lỗ
    { name: "tìm mã đơn (chứa chuỗi, không phân biệt hoa thường)", f: { search: "loss" }, count: 1 },
    { name: "tìm + lọc chồng nhau", f: { search: "2609test", shippingStatus: ShippingStatus.DELIVERED, lossOnly: true }, count: 1 },
    { name: "không khớp gì", f: { search: "khong-co" }, count: 0 },
  ];
  for (const { name, f, count } of FILTERS) {
    it(`bộ lọc "${name}": dòng sổ và dòng computePnlRow chọn cùng tập đơn, cộng ra cùng số`, () => {
      const rows = PNL_ROWS.filter((r) => matchesPnlFilter(r, f));
      const ledger = LEDGER_ROWS.filter((r) => matchesPnlFilter(r, f));
      expect(rows.map((r) => r.id)).toEqual(ledger.map((r) => r.orderId));
      expect(rows).toHaveLength(count);
      expectSame(pnlSummaryTotalsFromLedgerRows(ledger), pnlSummaryTotalsFromRows(rows));
    });
  }
});

describe("con trỏ danh sách + thoát ký tự LIKE", () => {
  it("encode → parse giữ nguyên mốc thời gian (đến mili giây) và mã đơn", () => {
    const c = { createdAt: new Date("2026-09-10T17:30:00.123Z"), orderId: "cmu123abc" };
    const back = parsePnlCursor(encodePnlCursor(c));
    expect(back?.orderId).toBe("cmu123abc");
    expect(back?.createdAt.getTime()).toBe(c.createdAt.getTime());
  });
  it("con trỏ thiếu/sai dạng → null (đọc từ đầu), không ném lỗi", () => {
    for (const raw of [undefined, "", "abc", "2026-09-10T17:30:00.000Z|", "|id", "khong-phai-ngay|id", ["a"]]) {
      expect(parsePnlCursor(raw)).toBeNull();
    }
  });
  it("escapeLike: %, _ và \\ trong chuỗi tìm là CHỮ, không phải ký tự đại diện", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(escapeLike("2609ABC")).toBe("2609ABC");
  });
});
