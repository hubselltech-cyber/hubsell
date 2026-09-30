// ============================================================
// LÃI/LỖ THỰC HIỆN — BỘ TỔNG CỦA TẬP ĐƠN KHỚP LỌC (lib thuần, không DB)
//
// /api/finance/realized-pnl có hai phần:
//   · DANH SÁCH đơn của trang đang xem (≤ 100 dòng chi tiết giàu trường);
//   · TỔNG KẾT trên TOÀN BỘ đơn khớp lọc: thẻ KPI, theo sàn, chuỗi ngày.
// Bộ tổng (PnlSummaryTotals) có HAI nguồn cho cùng kết quả (docs/SO-CAI-DON.md
// mục 9.3):
//   1. pnlSummaryTotalsFromRows(rows) — đường cũ: kéo cả kỳ lên RAM rồi cộng.
//   2. services/order-ledger.ts ledgerPnlSummary — SUM/GROUP BY trong database
//      với đúng điều kiện lọc của bảng (LedgerPnlFilter).
// Test lib/__tests__/realized-pnl-totals.test.ts khóa (1) = summarizePnlRows cũ
// và (1) = (2) cộng trong RAM từ dòng sổ; prod so bằng ?source=orders|ledger.
// ============================================================

import type { ShippingStatus } from "@prisma/client";
import { toBusinessDateKey } from "./date-range";
import { isLossOrder } from "./finance-definitions";
import type { OrderLedgerRow } from "./order-ledger";
import { computeReturnLoss, type PnlRow } from "./pnl-formula";

/** Bộ lọc của bảng Lãi/Lỗ — MỘT định nghĩa cho cả hai đường. */
export interface LedgerPnlFilter {
  /** Tab trạng thái giao: Đã giao / Đang giao / Đã hủy. */
  shippingStatus?: ShippingStatus;
  /** Tab "Hoàn/Trả": đơn có hoàn tiền/trả hàng (returnType ≠ null). */
  returnsOnly?: boolean;
  /** Nút "Lợi nhuận âm": chỉ đơn lỗ (profitAfterTax < 0). */
  lossOnly?: boolean;
  /** Tìm MÃ ĐƠN: chứa chuỗi, không phân biệt hoa thường (đã trim, chữ thường). */
  search?: string;
}

/** Đơn có khớp bộ lọc không — dùng cho đường cũ (dòng computePnlRow) và test (dòng sổ). */
export function matchesPnlFilter(
  r: Pick<PnlRow, "shippingStatus" | "returnType" | "profitAfterTax" | "orderCode">
    | Pick<OrderLedgerRow, "shippingStatus" | "returnType" | "profitAfterTax" | "orderCode">,
  f: LedgerPnlFilter
): boolean {
  if (f.shippingStatus && r.shippingStatus !== f.shippingStatus) return false;
  if (f.returnsOnly && r.returnType === null) return false;
  if (f.lossOnly && !isLossOrder(r)) return false;
  if (f.search && !r.orderCode.toLowerCase().includes(f.search)) return false;
  return true;
}

export interface PnlSummaryTotals {
  count: number;
  settledCount: number;
  /** Σ netRevenue — doanh thu thực nhận, ĐÃ trừ tiền hoàn trả khách. */
  netRevenue: number;
  /** Số đơn có hoàn tiền/trả hàng. */
  returnCount: number;
  refundedAmount: number;
  revenueGross: number;
  platformTax: number;
  /** Σ profitAfterTax của đơn CÓ giá vốn (đơn thiếu giá vốn bị loại — chốt 30/09/2026). */
  profitWithCost: number;
  missingCostCount: number;
  missingCostExcludedProfit: number;
  /** Thất thu đơn hoàn — 3 khoản của computeReturnLoss, chỉ trên đơn có hoàn/trả. */
  returnLoss: { costLoss: number; platformKept: number; refundLoss: number };
  byPlatform: Map<string, { count: number; profit: number; returnCount: number; returnLoss: number }>;
  /** Theo NGÀY PHÁT SINH giờ VN. */
  byDay: Map<string, { profit: number; returnLoss: number; orderCount: number; returnCount: number }>;
}

export function emptyPnlSummaryTotals(): PnlSummaryTotals {
  return {
    count: 0,
    settledCount: 0,
    netRevenue: 0,
    returnCount: 0,
    refundedAmount: 0,
    revenueGross: 0,
    platformTax: 0,
    profitWithCost: 0,
    missingCostCount: 0,
    missingCostExcludedProfit: 0,
    returnLoss: { costLoss: 0, platformKept: 0, refundLoss: 0 },
    byPlatform: new Map(),
    byDay: new Map(),
  };
}

/** Cộng một đơn vào bộ tổng — dùng chung cho dòng computePnlRow (đường cũ) và dòng sổ (test). */
function addOrder(
  t: PnlSummaryTotals,
  o: {
    channelName: string;
    day: string;
    isSettled: boolean;
    isReturn: boolean;
    missingCostPrice: boolean;
    netRevenue: number;
    refundedAmount: number;
    revenueGross: number;
    platformTax: number;
    profitAfterTax: number;
    rl: { costLoss: number; platformKept: number; refundLoss: number };
  }
) {
  const profit = o.missingCostPrice ? 0 : o.profitAfterTax;
  const rlTotal = o.rl.costLoss + o.rl.platformKept + o.rl.refundLoss;
  t.count += 1;
  if (o.isSettled) t.settledCount += 1;
  t.netRevenue += o.netRevenue;
  t.refundedAmount += o.refundedAmount;
  t.revenueGross += o.revenueGross;
  t.platformTax += o.platformTax;
  t.profitWithCost += profit;
  if (o.missingCostPrice) {
    t.missingCostCount += 1;
    t.missingCostExcludedProfit += o.profitAfterTax;
  }
  const b = t.byPlatform.get(o.channelName) ?? { count: 0, profit: 0, returnCount: 0, returnLoss: 0 };
  b.count += 1;
  b.profit += profit;
  const d = t.byDay.get(o.day) ?? { profit: 0, returnLoss: 0, orderCount: 0, returnCount: 0 };
  d.profit += profit;
  d.orderCount += 1;
  if (o.isReturn) {
    t.returnCount += 1;
    t.returnLoss.costLoss += o.rl.costLoss;
    t.returnLoss.platformKept += o.rl.platformKept;
    t.returnLoss.refundLoss += o.rl.refundLoss;
    b.returnCount += 1;
    b.returnLoss += rlTotal;
    d.returnCount += 1;
    d.returnLoss += rlTotal;
  }
  t.byPlatform.set(o.channelName, b);
  t.byDay.set(o.day, d);
}

/** ĐƯỜNG CŨ: từ các dòng computePnlRow ĐÃ LỌC của kỳ. */
export function pnlSummaryTotalsFromRows(rows: PnlRow[]): PnlSummaryTotals {
  const t = emptyPnlSummaryTotals();
  for (const r of rows) {
    addOrder(t, {
      channelName: r.channelName,
      day: toBusinessDateKey(r.createdAt),
      isSettled: r.isSettled,
      isReturn: r.returnType !== null,
      missingCostPrice: r.missingCostPrice,
      netRevenue: r.netRevenue,
      refundedAmount: r.refundedAmount,
      revenueGross: r.revenueGross,
      platformTax: r.platformTax,
      profitAfterTax: r.profitAfterTax,
      rl: computeReturnLoss(r),
    });
  }
  return t;
}

/**
 * Cộng TRONG RAM từ dòng sổ theo đúng phép cộng mà SQL làm (ledgerPnlSummary) —
 * chỉ để TEST/đối soát, báo cáo cộng trong database.
 */
export function pnlSummaryTotalsFromLedgerRows(rows: OrderLedgerRow[]): PnlSummaryTotals {
  const t = emptyPnlSummaryTotals();
  for (const r of rows) {
    addOrder(t, {
      channelName: r.channelName,
      day: r.createdDate,
      isSettled: r.isSettled,
      isReturn: r.returnType !== null,
      missingCostPrice: r.missingCostPrice,
      netRevenue: r.netRevenue,
      refundedAmount: r.refundedAmount,
      revenueGross: r.revenueGross,
      platformTax: r.platformTax,
      profitAfterTax: r.profitAfterTax,
      rl: { costLoss: r.returnLossCost, platformKept: r.returnLossPlatformKept, refundLoss: r.returnLossRefund },
    });
  }
  return t;
}

// ------------------------------------------------------------
// Con trỏ danh sách (mới nhất trước): (createdAt, orderId) của dòng cuối trang
// ------------------------------------------------------------

export interface PnlListCursor {
  createdAt: Date;
  orderId: string;
}

export function encodePnlCursor(c: PnlListCursor): string {
  return `${c.createdAt.toISOString()}|${c.orderId}`;
}

/** Chuỗi con trỏ từ ?cursor= → null nếu thiếu hoặc sai dạng (coi như đọc từ đầu). */
export function parsePnlCursor(raw: unknown): PnlListCursor | null {
  if (typeof raw !== "string") return null;
  const i = raw.indexOf("|");
  if (i <= 0 || i === raw.length - 1) return null;
  const createdAt = new Date(raw.slice(0, i));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, orderId: raw.slice(i + 1) };
}

/** Thoát ký tự đại diện của LIKE để chuỗi tìm được hiểu là chữ thường, không phải mẫu. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
