// ============================================================
// BÁO CÁO DÒNG TIỀN — TỔNG THEO NHÓM (lib thuần, không DB)
//
// /api/finance/analytics cần đúng MỘT bộ tổng (CashFlowTotals): số đơn từng
// nhóm, Σ vài cột tiền của nhóm, và ba bảng bóc (giá vốn theo sàn, GMV Max
// theo gian, doanh thu/giá vốn theo ngày). Bộ tổng này có HAI nguồn:
//   1. cashFlowTotalsFromRows(pnlRows)  — đường cũ: kéo đơn lên RAM, cộng
//      bằng JS (giữ lại sau công tắc CASH_FLOW_SOURCE=orders trong 1 tuần).
//   2. cashFlowTotalsFromLedger(summary, breakdown) — đường mới: SUM trong
//      database trên sổ cái đơn (services/order-ledger.ts), RAM không kéo đơn.
// Hai đường PHẢI cho cùng kết quả từng đồng — test lib/__tests__/cash-flow-
// totals.test.ts khóa điều đó; prod so bằng ?source=orders|ledger.
//
// Nguyên tắc (docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md, trụ 1): tiền ghi sổ một
// lần, database cộng; báo cáo không kéo đơn lên RAM.
// ============================================================

import { ShippingStatus } from "@prisma/client";
import { toBusinessDateKey } from "./date-range";
import { countsAsRevenue, isReturning } from "./finance-definitions";
import type { LedgerGroupTotals, LedgerSummary } from "./order-ledger";
import type { PnlRow } from "./pnl-formula";

function pct(amount: number, total: number): number {
  if (!total) return 0;
  return Math.round((amount / total) * 1000) / 10;
}

// ------------------------------------------------------------
// Thác nước Tổng giá trị SP − Tổng khấu trừ = Doanh thu
// ------------------------------------------------------------

/** Σ các cột của nhóm ĐƠN TÍNH DOANH THU mà thác nước cần. */
export interface GrossDeductionTotals {
  revenueGross: number;
  platformRevenue: number;
  feeFixedPayment: number;
  feeService: number;
  feeSellerProtection: number;
  feeAffiliate: number;
  platformTax: number;
  sellerVoucher: number;
  shippingFeeDiff: number;
  adWalletTopup: number;
  platformSubsidy: number;
  refundedAmount: number;
}

export const GROSS_DEDUCTION_COLUMNS = [
  "revenueGross",
  "platformRevenue",
  "feeFixedPayment",
  "feeService",
  "feeSellerProtection",
  "feeAffiliate",
  "platformTax",
  "sellerVoucher",
  "shippingFeeDiff",
  "adWalletTopup",
  "platformSubsidy",
  "refundedAmount",
] as const satisfies readonly (keyof GrossDeductionTotals)[];

/**
 * Đẳng thức thác nước (chốt chủ shop 31/07, khớp từng đồng 16/09/2026):
 *   Tổng giá trị SP − Tổng khấu trừ = Doanh thu (Σ platformRevenue)
 * đúng cho MỌI bộ lọc vì mọi dòng đều là Σ từ cùng tập đơn. Hai dòng bổ sung
 * 16/09 (đối chiếu TikTok 30 ngày lệch 9,88 triệu):
 *   - "Tiền hoàn trả khách": đơn hoàn/trả vẫn còn tính doanh thu — Lãi/Lỗ đã
 *     trừ (refundedAmount) nhưng thác nước trước đây không có dòng này.
 *   - "Lệch quyết toán khác": phần dư = (giá trị SP − Σ dòng đã bóc) − Doanh
 *     thu — đơn hoàn quá doanh thu bị kẹp về 0, tiền về ví lệch số ước tính,
 *     khoản sàn chưa bóc cột. Dương = sàn giữ thêm, âm = sàn trả thêm.
 */
export function computeGrossDeductionsFromTotals(t: GrossDeductionTotals) {
  const grossValue = t.revenueGross;
  const actualRevenueTotal = t.platformRevenue;
  // Phí nền tảng = CĐ + thanh toán + dịch vụ + PiShip (bảo hiểm giao hàng).
  const feePlatform = t.feeFixedPayment + t.feeService + t.feeSellerProtection;
  const feeAffiliate = t.feeAffiliate;
  const platformTaxTotal = t.platformTax;
  const feeSellerVoucher = t.sellerVoucher;
  const feeShippingDiff = t.shippingFeeDiff;
  const adWalletTotal = t.adWalletTopup;
  const platformSubsidyTotal = t.platformSubsidy;
  const feeRefund = t.refundedAmount;
  const named =
    feePlatform + feeAffiliate + platformTaxTotal + feeSellerVoucher +
    feeShippingDiff + adWalletTotal + feeRefund - platformSubsidyTotal;
  // Tổng khấu trừ = đúng hiệu số hai thẻ → đẳng thức luôn đóng; phần chưa bóc
  // được cột nào nằm ở dòng "Lệch quyết toán khác".
  const totalDeduction = grossValue - actualRevenueTotal;
  const feeOther = totalDeduction - named;
  const percent = (v: number) => pct(v, grossValue);
  const items = [
    {
      key: "platform",
      label: "Phí nền tảng",
      hint: "Phí sàn thu trên mỗi đơn. Shopee: phí cố định, thanh toán, dịch vụ, PiShip. TikTok: phí hoa hồng, phí giao dịch, phí xử lý đơn hàng, phí dịch vụ Voucher/Freeship Xtra. Lazada: phí cố định, thanh toán, hoa hồng, Freeship Max…",
      amount: feePlatform,
      percent: percent(feePlatform),
    },
    {
      key: "affiliate",
      label: "Phí tiếp thị liên kết",
      hint: "Hoa hồng trả cho người giới thiệu đơn (cộng tác viên, KOL, affiliate/quảng cáo affiliate).",
      amount: feeAffiliate,
      percent: percent(feeAffiliate),
    },
    {
      key: "platformTax",
      label: "Thuế sàn TMĐT (GTGT + TNCN)",
      hint: "Thuế sàn khấu trừ hộ nhà nước (GTGT 1% + TNCN 0,5% với hộ kinh doanh/cá nhân), trừ thẳng vào tiền hàng trước khi trả về shop.",
      amount: platformTaxTotal,
      percent: percent(platformTaxTotal),
    },
    {
      key: "voucher",
      label: "Voucher trợ giá của shop",
      hint: "Giảm giá cho khách do shop tự chịu. Shopee: voucher + xu shop hoàn; TikTok: Giảm giá của người bán; Lazada: giảm giá từ cửa hàng. Không gồm phần sàn tài trợ.",
      amount: feeSellerVoucher,
      percent: percent(feeSellerVoucher),
    },
    {
      key: "shipping",
      label: "Chênh lệch phí vận chuyển",
      hint: "Phần ship shop thực chịu: cước thật cao hơn khách trả + sàn trợ (TikTok: Phí vận chuyển của người bán).",
      amount: feeShippingDiff,
      percent: percent(feeShippingDiff),
    },
    {
      key: "refund",
      label: "Tiền hoàn trả khách",
      hint: "Tiền sàn trả lại khách trên đơn hoàn/trả vẫn còn tính trong Tổng giá trị SP (số thật từ bản kê; đơn hoàn chưa chốt lấy số sàn báo). Đơn hủy không tính ở đây.",
      amount: feeRefund,
      percent: percent(feeRefund),
    },
    {
      key: "adWallet",
      label: "Nạp ví quảng cáo",
      hint: "Tiền sàn giữ lại từ đơn hàng để nạp vào ví quảng cáo của shop (Shopee).",
      amount: adWalletTotal,
      percent: percent(adWalletTotal),
    },
    {
      key: "subsidy",
      label: "Trợ giá từ sàn",
      hint: "Tiền sàn hỗ trợ thêm cho shop — được cộng ngược lại (dấu +).",
      amount: platformSubsidyTotal === 0 ? 0 : -platformSubsidyTotal, // âm vì làm giảm khấu trừ
      percent: platformSubsidyTotal === 0 ? 0 : -percent(platformSubsidyTotal),
    },
    {
      key: "other",
      label: "Lệch quyết toán khác",
      hint: "Phần còn lại để Tổng giá trị SP − Khấu trừ = Doanh thu khớp từng đồng: đơn hoàn nhiều hơn doanh thu (kẹp về 0), tiền về ví lệch số sàn ước tính, khoản sàn chưa bóc cột. Dương = sàn giữ thêm, âm = sàn trả thêm.",
      amount: feeOther,
      percent: percent(feeOther),
    },
  ];
  return {
    grossValue,
    actualRevenueTotal,
    totalDeduction,
    feePlatform,
    feeAffiliate,
    platformTaxTotal,
    feeSellerVoucher,
    feeShippingDiff,
    adWalletTotal,
    platformSubsidyTotal,
    feeRefund,
    feeOther,
    items,
  };
}

/** Đường cũ: cộng các dòng computePnlRow của nhóm đơn tính doanh thu rồi bóc thác nước. */
export function computeGrossDeductions(activeRows: PnlRow[]) {
  const t = {} as GrossDeductionTotals;
  for (const c of GROSS_DEDUCTION_COLUMNS) t[c] = 0;
  for (const r of activeRows) for (const c of GROSS_DEDUCTION_COLUMNS) t[c] += r[c];
  return computeGrossDeductionsFromTotals(t);
}

// ------------------------------------------------------------
// Bộ tổng của Báo cáo dòng tiền
// ------------------------------------------------------------

export interface CashFlowTotals {
  /** Mọi đơn trong kỳ (mẫu số của tỷ lệ hủy / hoàn). */
  orderCount: number;
  cancelled: { count: number; revenueGross: number };
  returning: { count: number; revenueGross: number };
  /** Đơn tính doanh thu (không hủy, không đang hoàn/trả). */
  active: GrossDeductionTotals & {
    count: number;
    costSnapshot: number;
    /** Đơn chưa có giá vốn: đếm + phần lợi nhuận bị loại (anh Trung chốt 30/09/2026). */
    missingCostCount: number;
    missingCostExcludedProfit: number;
  };
  /** Đơn tính doanh thu đã quyết toán. profitAfterTaxWithCost = Σ profitAfterTax của đơn CÓ giá vốn. */
  settled: { count: number; actualPayout: number; platformTax: number; platformRevenue: number; profitAfterTaxWithCost: number };
  /** Đơn tính doanh thu chờ quyết toán. */
  pending: { count: number; netRevenue: number; platformTax: number; platformRevenue: number; profitAfterTaxWithCost: number };
  /** Đơn tính doanh thu ở trạng thái Đã giao. platformFee = CĐ + thanh toán + dịch vụ + PiShip + affiliate. */
  delivered: { count: number; revenueGross: number; costSnapshot: number; platformFee: number };
  /** Σ feeGmvMax ≠ 0 theo gian (đơn tính doanh thu) — gian bị sàn thu GMV Max theo đơn. */
  gmvMaxByChannelId: Map<string, number>;
  /** Σ giá vốn theo sàn (đơn tính doanh thu). */
  cogsByChannelName: Map<string, number>;
  /** Doanh thu (platformRevenue) và giá vốn của đơn tính doanh thu theo NGÀY PHÁT SINH giờ VN. */
  revenueByDay: Map<string, number>;
  cogsByDay: Map<string, number>;
}

const sumInto = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/**
 * ĐƯỜNG CŨ: từ các dòng computePnlRow (fetchPnlRows) — logic nguyên văn của
 * /api/finance/analytics trước 30/09/2026, chỉ dời vào hàm thuần.
 */
export function cashFlowTotalsFromRows(pnlRows: PnlRow[]): CashFlowTotals {
  const active = {
    count: 0,
    costSnapshot: 0,
    missingCostCount: 0,
    missingCostExcludedProfit: 0,
  } as CashFlowTotals["active"];
  for (const c of GROSS_DEDUCTION_COLUMNS) active[c] = 0;
  const t: CashFlowTotals = {
    orderCount: pnlRows.length,
    cancelled: { count: 0, revenueGross: 0 },
    returning: { count: 0, revenueGross: 0 },
    active,
    settled: { count: 0, actualPayout: 0, platformTax: 0, platformRevenue: 0, profitAfterTaxWithCost: 0 },
    pending: { count: 0, netRevenue: 0, platformTax: 0, platformRevenue: 0, profitAfterTaxWithCost: 0 },
    delivered: { count: 0, revenueGross: 0, costSnapshot: 0, platformFee: 0 },
    gmvMaxByChannelId: new Map(),
    cogsByChannelName: new Map(),
    revenueByDay: new Map(),
    cogsByDay: new Map(),
  };
  for (const r of pnlRows) {
    if (r.shippingStatus === ShippingStatus.CANCELLED) {
      t.cancelled.count += 1;
      t.cancelled.revenueGross += r.revenueGross;
    } else if (isReturning(r)) {
      // Đơn ĐANG hoàn/trả KHÔNG tính doanh thu (anh Trung chốt 30/09/2026).
      t.returning.count += 1;
      t.returning.revenueGross += r.revenueGross;
    }
    if (!countsAsRevenue(r)) continue;

    active.count += 1;
    for (const c of GROSS_DEDUCTION_COLUMNS) active[c] += r[c];
    active.costSnapshot += r.costSnapshot;
    if (r.missingCostPrice) {
      active.missingCostCount += 1;
      active.missingCostExcludedProfit += r.profitAfterTax;
    }
    const profitWithCost = r.missingCostPrice ? 0 : r.profitAfterTax;
    if (r.isSettled) {
      t.settled.count += 1;
      t.settled.actualPayout += r.actualPayout;
      t.settled.platformTax += r.platformTax;
      t.settled.platformRevenue += r.platformRevenue;
      t.settled.profitAfterTaxWithCost += profitWithCost;
    } else {
      // "Chờ quyết toán" = sàn chưa giải ngân: đang đi đường HOẶC đã giao
      // nhưng chưa đối soát — đúng trục isSettled của Lãi/Lỗ.
      t.pending.count += 1;
      t.pending.netRevenue += r.netRevenue;
      t.pending.platformTax += r.platformTax;
      t.pending.platformRevenue += r.platformRevenue;
      t.pending.profitAfterTaxWithCost += profitWithCost;
    }
    if (r.shippingStatus === ShippingStatus.DELIVERED) {
      t.delivered.count += 1;
      t.delivered.revenueGross += r.revenueGross;
      t.delivered.costSnapshot += r.costSnapshot;
      t.delivered.platformFee +=
        r.feeFixedPayment + r.feeService + r.feeSellerProtection + r.feeAffiliate;
    }
    if (r.feeGmvMax !== 0) sumInto(t.gmvMaxByChannelId, r.channelId, r.feeGmvMax);
    sumInto(t.cogsByChannelName, r.channelName, r.costSnapshot);
    const day = toBusinessDateKey(r.createdAt);
    sumInto(t.revenueByDay, day, r.platformRevenue);
    sumInto(t.cogsByDay, day, r.costSnapshot);
  }
  return t;
}

/** Ba bảng bóc đọc từ sổ (GROUP BY trong database) — services/order-ledger.ts cung cấp. */
export interface LedgerCashFlowBreakdown {
  cogsByChannelName: Map<string, number>;
  gmvMaxByChannelId: Map<string, number>;
  byDay: Map<string, { platformRevenue: number; costSnapshot: number }>;
}

/**
 * ĐƯỚNG MỚI: từ tổng theo nhóm của sổ cái (ledgerSummary — SUM FILTER trong
 * database) + ba bảng bóc. Nhóm của sổ = đúng bộ lọc cũ của báo cáo:
 *   all → mẫu số; cancelled; returning (không hủy AND đang hoàn/trả);
 *   active (countsAsRevenue); settled/pending (active × isSettled);
 *   delivered (active AND DELIVERED).
 * "Σ profitAfterTax của đơn CÓ giá vốn" = profitAfterTax − missingCostExcludedProfit.
 */
export function cashFlowTotalsFromLedger(
  s: LedgerSummary,
  b: LedgerCashFlowBreakdown
): CashFlowTotals {
  const withCost = (g: LedgerGroupTotals) => g.profitAfterTax - g.missingCostExcludedProfit;
  const active = {
    count: s.active.count,
    costSnapshot: s.active.costSnapshot,
    missingCostCount: s.active.missingCostCount,
    missingCostExcludedProfit: s.active.missingCostExcludedProfit,
  } as CashFlowTotals["active"];
  for (const c of GROSS_DEDUCTION_COLUMNS) active[c] = s.active[c];
  const revenueByDay = new Map<string, number>();
  const cogsByDay = new Map<string, number>();
  for (const [day, v] of b.byDay) {
    revenueByDay.set(day, v.platformRevenue);
    cogsByDay.set(day, v.costSnapshot);
  }
  return {
    orderCount: s.all.count,
    cancelled: { count: s.cancelled.count, revenueGross: s.cancelled.revenueGross },
    returning: { count: s.returning.count, revenueGross: s.returning.revenueGross },
    active,
    settled: {
      count: s.settled.count,
      actualPayout: s.settled.actualPayout,
      platformTax: s.settled.platformTax,
      platformRevenue: s.settled.platformRevenue,
      profitAfterTaxWithCost: withCost(s.settled),
    },
    pending: {
      count: s.pending.count,
      netRevenue: s.pending.netRevenue,
      platformTax: s.pending.platformTax,
      platformRevenue: s.pending.platformRevenue,
      profitAfterTaxWithCost: withCost(s.pending),
    },
    delivered: {
      count: s.delivered.count,
      revenueGross: s.delivered.revenueGross,
      costSnapshot: s.delivered.costSnapshot,
      platformFee:
        s.delivered.feeFixedPayment + s.delivered.feeService +
        s.delivered.feeSellerProtection + s.delivered.feeAffiliate,
    },
    gmvMaxByChannelId: new Map(b.gmvMaxByChannelId),
    cogsByChannelName: new Map(b.cogsByChannelName),
    revenueByDay,
    cogsByDay,
  };
}

/** Nguồn số của Báo cáo dòng tiền: sổ cái (mặc định từ 30/09/2026) hoặc kéo đơn (đường cũ). */
export type CashFlowSource = "ledger" | "orders";

/**
 * Chọn nguồn: ?source= của request thắng (để so hai đường trên prod), rồi env
 * CASH_FLOW_SOURCE (công tắc lui về đường cũ), mặc định sổ cái.
 */
export function resolveCashFlowSource(query: unknown, env = process.env.CASH_FLOW_SOURCE): CashFlowSource {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (q === "orders" || q === "ledger") return q;
  return env === "orders" ? "orders" : "ledger";
}
