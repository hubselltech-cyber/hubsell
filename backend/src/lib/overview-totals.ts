// ============================================================
// TỔNG QUAN — BỘ TỔNG CỦA ĐƠN TÍNH DOANH THU (lib thuần, không DB)
//
// /api/analytics (trang Tổng quan) cần: Σ vài cột của nhóm đơn tính doanh thu
// (không hủy, không đang hoàn/trả), bóc theo GIAN và theo NGÀY PHÁT SINH giờ
// VN. Bộ tổng có HAI nguồn cho cùng kết quả (docs/SO-CAI-DON.md mục 9.2):
//   1. overviewTotalsFromRows(pnlRows)   — đường cũ: kéo đơn lên RAM.
//   2. overviewTotalsFromLedger(summary, breakdown) — SUM/GROUP BY trong
//      database trên sổ cái đơn.
// Test lib/__tests__/overview-totals.test.ts khóa hai đường bằng nhau; prod so
// bằng ?source=orders|ledger.
// ============================================================

import { toBusinessDateKey } from "./date-range";
import { ShippingStatus } from "@prisma/client";
import { adsChargedInOrder, countsAsRevenue } from "./finance-definitions";
import type { LedgerSummary } from "./order-ledger";
import type { PnlRow } from "./pnl-formula";

/** Các cột cộng thẳng từ dòng (tên cột sổ = tên trường computePnlRow). */
export const OVERVIEW_SUM_COLUMNS = [
  "revenueGross",
  "platformTax",
  "feeFixedPayment",
  "feeService",
  "feeSellerProtection",
  "feeAffiliate",
  "sellerVoucher",
  "shippingFeeDiff",
  "adWalletTopup",
  "platformSubsidy",
  "refundedAmount",
  "costSnapshot",
] as const;

type SumColumn = (typeof OVERVIEW_SUM_COLUMNS)[number];

export interface OverviewTotals {
  /** Số đơn HỦY của kỳ (tham khảo cạnh số đơn phát sinh — báo cáo kỳ của Trợ lý). */
  cancelledCount: number;
  /** Đơn tính doanh thu của kỳ. */
  active: Record<SumColumn, number> & {
    count: number;
    /** Số MÓN bán ra = Σ quantity các dòng hàng. */
    totalQuantity: number;
    /** SÀN KHẤU TRỪ = Σ (Giá trị đơn − "Tổng tiền" sàn báo). */
    platformDeduction: number;
    /** Số đơn chưa có giá vốn — chỉ để nhắc nhập; lợi nhuận tính như giá vốn 0 (04/11/2026, lib/finance-definitions.ts). */
    missingCostCount: number;
  };
  /** Theo GIAN: số đơn, doanh thu, Σ tiền quảng cáo sàn thu trong đơn (adsChargedInOrder; ≠ 0 → AdSpend gian đó chỉ cộng phần vượt). */
  byChannelId: Map<string, { count: number; revenueGross: number; adsCharged: number }>;
  /** Theo NGÀY PHÁT SINH giờ VN: số đơn, doanh thu, giá vốn, sàn khấu trừ. */
  byDay: Map<string, { count: number; revenueGross: number; costSnapshot: number; platformDeduction: number }>;
}

function emptyActive(): OverviewTotals["active"] {
  const a = {
    count: 0,
    totalQuantity: 0,
    platformDeduction: 0,
    missingCostCount: 0,
  } as OverviewTotals["active"];
  for (const c of OVERVIEW_SUM_COLUMNS) a[c] = 0;
  return a;
}

/** ĐƯỜNG CŨ: từ các dòng computePnlRow của kỳ (mọi trạng thái) — tự lọc đơn tính doanh thu. */
export function overviewTotalsFromRows(pnlRows: PnlRow[]): OverviewTotals {
  const active = emptyActive();
  const byChannelId: OverviewTotals["byChannelId"] = new Map();
  const byDay: OverviewTotals["byDay"] = new Map();
  let cancelledCount = 0;
  for (const r of pnlRows) {
    if (r.shippingStatus === ShippingStatus.CANCELLED) cancelledCount += 1;
    if (!countsAsRevenue(r)) continue;
    const deduction = r.revenueGross - r.platformRevenue;
    active.count += 1;
    active.totalQuantity += r.totalQuantity;
    active.platformDeduction += deduction;
    for (const c of OVERVIEW_SUM_COLUMNS) active[c] += r[c];
    if (r.missingCostPrice) active.missingCostCount += 1;
    const ch = byChannelId.get(r.channelId) ?? { count: 0, revenueGross: 0, adsCharged: 0 };
    ch.count += 1;
    ch.revenueGross += r.revenueGross;
    ch.adsCharged += adsChargedInOrder(r);
    byChannelId.set(r.channelId, ch);
    const key = toBusinessDateKey(r.createdAt);
    const d = byDay.get(key) ?? { count: 0, revenueGross: 0, costSnapshot: 0, platformDeduction: 0 };
    d.count += 1;
    d.revenueGross += r.revenueGross;
    d.costSnapshot += r.costSnapshot;
    d.platformDeduction += deduction;
    byDay.set(key, d);
  }
  return { cancelledCount, active, byChannelId, byDay };
}

/** Hai bảng bóc GROUP BY trong database của nhóm đơn tính doanh thu (services/order-ledger.ts). */
export interface LedgerOverviewBreakdown {
  byChannelId: OverviewTotals["byChannelId"];
  byDay: OverviewTotals["byDay"];
}

/** ĐƯỜNG MỚI: nhóm `active` của ledgerSummary + hai bảng bóc. */
export function overviewTotalsFromLedger(
  s: LedgerSummary,
  b: LedgerOverviewBreakdown
): OverviewTotals {
  const active = emptyActive();
  active.count = s.active.count;
  active.totalQuantity = s.active.totalQuantity;
  active.platformDeduction = s.active.platformDeduction;
  active.missingCostCount = s.active.missingCostCount;
  for (const c of OVERVIEW_SUM_COLUMNS) active[c] = s.active[c];
  return {
    cancelledCount: s.cancelled.count,
    active,
    byChannelId: new Map(b.byChannelId),
    byDay: new Map(b.byDay),
  };
}

/**
 * Dạng mà platformAdsSpend cần để biết gian nào bị sàn thu tiền quảng cáo trong
 * đơn: mỗi gian một dòng (Σ adsChargedInOrder của gian) — cùng kết quả với đưa từng đơn.
 */
export function adsChargedRowsOf(t: OverviewTotals): { channelId: string; adsCharged: number }[] {
  return [...t.byChannelId].map(([channelId, v]) => ({ channelId, adsCharged: v.adsCharged }));
}
