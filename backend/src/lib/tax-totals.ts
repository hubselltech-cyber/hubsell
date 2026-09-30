// ============================================================
// THUẾ — BỘ TỔNG HAI NGUỒN (lib thuần, không DB) — docs/SO-CAI-DON.md mục 9.4
//
// Hai nơi của module Thuế cộng từ đơn:
//   · /api/tax/report — đối soát thuế của kỳ (theo ngày TẠO đơn): TaxReportTotals.
//   · /api/tax/declaration — số liệu kê khai theo SÀN (theo ngày GIAO hoặc ngày
//     tạo, xem services/tax-declaration.ts): DeclarationRawRow theo từng sàn.
// Mỗi bộ tổng có hai nguồn cho cùng kết quả: kéo đơn lên RAM (đường cũ) hoặc
// SUM/GROUP BY trong database trên sổ cái đơn (services/order-ledger.ts).
// ============================================================

import { ShippingStatus } from "@prisma/client";
import type { OrderLedgerRow } from "./order-ledger";
import type { PnlRow } from "./pnl-formula";

/** Tổng của các đơn KHÔNG HỦY trong kỳ — đầu vào khối Thuế sàn + Thuế bổ sung. */
export interface TaxReportTotals {
  orderCount: number;
  settledCount: number;
  grossRevenue: number;
  /** Σ profitAfterTax của đơn CÓ giá vốn — cơ sở thuế bổ sung khi tính trên lợi nhuận. */
  profitWithCost: number;
  /** Thuế sàn ĐÃ trích (số thật của đơn đã quyết toán). */
  platformTaxActual: number;
  /** Σ platformRevenue của đơn CHƯA quyết toán — cơ sở ước tính thuế sàn. */
  unsettledPlatformRevenue: number;
  missingCostCount: number;
  missingCostExcludedProfit: number;
}

type TaxRowInput = Pick<
  PnlRow,
  "shippingStatus" | "isSettled" | "revenueGross" | "profitAfterTax" | "missingCostPrice" | "platformTax" | "platformRevenue"
>;

function sumTaxReport(rows: Iterable<TaxRowInput>): TaxReportTotals {
  const t: TaxReportTotals = {
    orderCount: 0,
    settledCount: 0,
    grossRevenue: 0,
    profitWithCost: 0,
    platformTaxActual: 0,
    unsettledPlatformRevenue: 0,
    missingCostCount: 0,
    missingCostExcludedProfit: 0,
  };
  for (const r of rows) {
    if (r.shippingStatus === ShippingStatus.CANCELLED) continue;
    t.orderCount += 1;
    t.grossRevenue += r.revenueGross;
    // Đơn chưa có giá vốn KHÔNG vào lợi nhuận tính thuế bổ sung (anh Trung chốt 30/09/2026).
    if (r.missingCostPrice) {
      t.missingCostCount += 1;
      t.missingCostExcludedProfit += r.profitAfterTax;
    } else {
      t.profitWithCost += r.profitAfterTax;
    }
    if (r.isSettled) {
      t.platformTaxActual += r.platformTax;
      t.settledCount += 1;
    } else {
      t.unsettledPlatformRevenue += r.platformRevenue; // doanh thu thực tế (sau voucher)
    }
  }
  return t;
}

/** ĐƯỜNG CŨ: từ các dòng computePnlRow của kỳ (mọi trạng thái). */
export function taxReportTotalsFromRows(rows: PnlRow[]): TaxReportTotals {
  return sumTaxReport(rows);
}

/** Cộng TRONG RAM từ dòng sổ theo đúng phép cộng của SQL — chỉ để test/đối soát. */
export function taxReportTotalsFromLedgerRows(rows: OrderLedgerRow[]): TaxReportTotals {
  return sumTaxReport(rows);
}

/** Σ THÔ của một sàn cho bảng kê khai (chưa làm tròn, chưa sắp thứ tự). */
export interface DeclarationRawRow {
  channelName: string;
  orderCount: number;
  settledCount: number;
  unsettledCount: number;
  grossRevenue: number;
  sellerVoucher: number;
  refundedAmount: number;
  /** Σ max(0, gross − voucher người bán − hoàn) TỪNG ĐƠN. */
  taxableRevenue: number;
  unsettledTaxableRevenue: number;
  taxWithheldActual: number;
  taxWithheldEstimated: number;
}
