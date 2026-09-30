// ============================================================
// THUẾ — hai nguồn số phải bằng nhau (lib/tax-totals.ts + services/tax-declaration.ts)
//   · đối soát kỳ: tổng từ dòng sổ = tổng từ dòng computePnlRow = phép cộng cũ;
//   · bảng kê khai theo sàn: Σ thô kiểu SQL trên dòng sổ → declarationRowsFromLedger
//     = aggregateDeclaration trên dòng computePnlRow (cùng thứ tự, cùng làm tròn).
// Logic THUẦN, không DB.
// ============================================================

import { describe, expect, it } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { buildLedgerRows, type OrderLedgerRow } from "../order-ledger";
import { computePnlRow } from "../pnl-formula";
import {
  taxReportTotalsFromLedgerRows,
  taxReportTotalsFromRows,
  type DeclarationRawRow,
} from "../tax-totals";
import {
  aggregateDeclaration,
  declarationRowsFromLedger,
  sumRows,
} from "../../services/tax-declaration";
import { FIXTURE_ORDERS, mkOrder, D } from "./ledger-order-fixture";

const ORDERS = [
  ...FIXTURE_ORDERS,
  // Hoàn nhiều hơn tiền hàng → doanh thu tính thuế của ĐƠN kẹp về 0 (không âm).
  mkOrder({ id: "over", sellerVoucher: D(300000), refundedAmount: D(200000), actualPayout: D(0) }),
  // Lazada chưa quyết toán: vào cột ước tính.
  mkOrder({
    id: "lz", channelId: "c3", channel: { channelName: ChannelName.LAZADA, shopName: "LZ", userId: "u1" },
    isSettled: false, actualPayout: D(0), taxWithheld: D(0),
  }),
];
const PNL_ROWS = ORDERS.map((o) => computePnlRow(o));
const LEDGER_ROWS = ORDERS.map((o) => buildLedgerRows(o).order);

/** Σ thô theo sàn như câu GROUP BY của ledgerDeclarationByChannel (cơ sở ngày tạo: mọi đơn không hủy). */
function rawByChannel(rows: OrderLedgerRow[]): DeclarationRawRow[] {
  const map = new Map<string, DeclarationRawRow>();
  for (const r of rows) {
    if (r.shippingStatus === ShippingStatus.CANCELLED) continue;
    const x = map.get(r.channelName) ?? {
      channelName: r.channelName, orderCount: 0, settledCount: 0, unsettledCount: 0,
      grossRevenue: 0, sellerVoucher: 0, refundedAmount: 0, taxableRevenue: 0,
      unsettledTaxableRevenue: 0, taxWithheldActual: 0, taxWithheldEstimated: 0,
    };
    const taxable = Math.max(0, r.revenueGross - r.sellerVoucher - r.refundedAmount);
    x.orderCount += 1;
    x.grossRevenue += r.revenueGross;
    x.sellerVoucher += r.sellerVoucher;
    x.refundedAmount += r.refundedAmount;
    x.taxableRevenue += taxable;
    if (r.isSettled) {
      x.settledCount += 1;
      x.taxWithheldActual += r.platformTax;
    } else {
      x.unsettledCount += 1;
      x.unsettledTaxableRevenue += taxable;
      x.taxWithheldEstimated += r.platformTax;
    }
    map.set(r.channelName, x);
  }
  return [...map.values()].reverse(); // cố ý đảo thứ tự: hàm dựng bảng phải tự sắp lại
}

describe("taxReportTotals — đối soát thuế kỳ: sổ = dòng computePnlRow = phép cộng cũ", () => {
  const fromRows = taxReportTotalsFromRows(PNL_ROWS);
  const fromLedger = taxReportTotalsFromLedgerRows(LEDGER_ROWS);

  it("hai nguồn bằng nhau mọi trường", () => {
    for (const k of Object.keys(fromRows) as (keyof typeof fromRows)[]) {
      expect(fromLedger[k], k).toBeCloseTo(fromRows[k], 6);
    }
  });

  it("bằng đúng vòng cộng của /api/tax/report trước 30/09/2026", () => {
    const rows = PNL_ROWS.filter((r) => r.shippingStatus !== ShippingStatus.CANCELLED);
    let grossRevenue = 0, profit = 0, platformTaxActual = 0, estimateBase = 0, settledCount = 0;
    for (const r of rows) {
      grossRevenue += r.revenueGross;
      if (!r.missingCostPrice) profit += r.profitAfterTax;
      if (r.isSettled) { platformTaxActual += r.platformTax; settledCount += 1; }
      else estimateBase += r.platformRevenue;
    }
    expect(fromRows.orderCount).toBe(rows.length);
    expect(fromRows.settledCount).toBe(settledCount);
    expect(fromRows.grossRevenue).toBeCloseTo(grossRevenue, 6);
    expect(fromRows.profitWithCost).toBeCloseTo(profit, 6);
    expect(fromRows.platformTaxActual).toBeCloseTo(platformTaxActual, 6);
    expect(fromRows.unsettledPlatformRevenue).toBeCloseTo(estimateBase, 6);
    expect(fromRows.missingCostCount).toBe(rows.filter((r) => r.missingCostPrice).length);
  });

  it("đơn hủy bị loại; đơn đang hoàn VẪN vào (thuế không theo định nghĩa 'tính doanh thu')", () => {
    expect(fromRows.orderCount).toBe(ORDERS.length - 1); // chỉ trừ đơn hủy "c"
  });
});

describe("bảng kê khai theo sàn — Σ thô từ sổ → cùng bảng với aggregateDeclaration", () => {
  const old = aggregateDeclaration(PNL_ROWS);
  const fromLedger = declarationRowsFromLedger(rawByChannel(LEDGER_ROWS));

  it("cùng thứ tự sàn cố định, cùng từng số đã làm tròn", () => {
    expect(fromLedger.map((r) => r.channelName)).toEqual(["SHOPEE", "LAZADA", "TIKTOK"]);
    expect(fromLedger).toEqual(old);
    expect(sumRows(fromLedger)).toEqual(sumRows(old));
  });

  it("doanh thu tính thuế kẹp ≥ 0 TỪNG ĐƠN (đơn hoàn quá tiền hàng không kéo âm cả sàn)", () => {
    const shopee = fromLedger.find((r) => r.channelName === "SHOPEE")!;
    expect(shopee.taxableRevenue).toBeGreaterThan(shopee.grossRevenue - shopee.sellerVoucher - shopee.refundedAmount);
  });

  it("sàn không có đơn không sinh dòng rỗng", () => {
    expect(declarationRowsFromLedger([])).toEqual([]);
    expect(
      declarationRowsFromLedger([{ ...rawByChannel(LEDGER_ROWS)[0], channelName: "OFFLINE", orderCount: 0 }])
    ).toEqual([]);
  });
});
