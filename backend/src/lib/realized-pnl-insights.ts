// ============================================================
// LÃI/LỖ THỰC HIỆN — TỔNG QUAN LỢI NHUẬN: PHẦN THUẦN (không DB)
//
// /api/finance/realized-pnl/insights nuôi tab "Tổng quan Lợi nhuận" (08/11/2026,
// docs/LAI-LO-TONG-QUAN-LOI-NHUAN.md): mọi số đều là SUM/GROUP BY trên sổ cái
// (services/order-ledger.ts), tệp này chỉ giữ các định nghĩa dùng chung giữa
// SQL, route và test:
//   · kỳ liền trước cùng độ dài (so tăng/giảm) — cùng luật với Tổng quan;
//   · bậc BIÊN LÃI của một đơn (lãi / doanh thu thực nhận) — phân bố đơn;
//   · ghép chuỗi ngày kỳ này ↔ kỳ trước theo thứ tự ngày (ngày 1 so ngày 1);
//   · % thay đổi (kỳ trước 0 → không so được).
// ============================================================

import type { DateRangeFilter } from "./date-range";

const DAY_MS = 86_400_000;

/**
 * Kỳ liền trước CÙNG ĐỘ DÀI, nằm sát phía trước — đúng luật của Tổng quan
 * (routes/analytics.ts) và `previousRange` của web: xem 10/10 → 08/11 (30 ngày)
 * thì so với 10/09 → 09/10. Không lọc ngày → không có gì để so.
 */
export function previousRangeOf(range: DateRangeFilter | undefined): DateRangeFilter | undefined {
  if (!range) return undefined;
  const span = range.lte.getTime() - range.gte.getTime() + 1;
  return { gte: new Date(range.gte.getTime() - span), lte: new Date(range.lte.getTime() - span) };
}

/** Số ngày của kỳ (tính cả hai đầu). */
export function rangeDays(range: DateRangeFilter): number {
  return Math.round((range.lte.getTime() + 1 - range.gte.getTime()) / DAY_MS);
}

/**
 * % thay đổi so kỳ trước. Kỳ trước 0 hoặc không có → null (giao diện ẩn mũi
 * tên thay vì in "+∞"). Mẫu số lấy trị tuyệt đối để lỗ −10 tr → −5 tr là "+50 %".
 */
export function deltaPercent(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ------------------------------------------------------------
// Bậc biên lãi của một đơn
// ------------------------------------------------------------

/**
 * Biên lãi = profitAfterTax / netRevenue của ĐƠN. Bậc theo % để shop bán hàng
 * 50 k hay 5 tr đều đọc được một thang (tiền tuyệt đối thì mỗi shop một cỡ).
 * Đơn không có doanh thu thực nhận dương (hủy, hoàn đủ, chưa có số) xếp riêng.
 * Thứ tự mảng = thứ tự vẽ (trái → phải).
 */
export const MARGIN_BUCKETS = [
  { key: "loss", label: "Lỗ", min: Number.NEGATIVE_INFINITY, max: 0 },
  { key: "m0", label: "0–10 %", min: 0, max: 10 },
  { key: "m10", label: "10–20 %", min: 10, max: 20 },
  { key: "m20", label: "20–30 %", min: 20, max: 30 },
  { key: "m30", label: "30–50 %", min: 30, max: 50 },
  { key: "m50", label: "Trên 50 %", min: 50, max: Number.POSITIVE_INFINITY },
  { key: "none", label: "Không có doanh thu", min: Number.NaN, max: Number.NaN },
] as const;

export type MarginBucketKey = (typeof MARGIN_BUCKETS)[number]["key"];

/** Bậc của một đơn — CÙNG luật với câu CASE trong SQL (ledgerPnlMarginBuckets). */
export function marginBucketKey(profitAfterTax: number, netRevenue: number): MarginBucketKey {
  if (!(netRevenue > 0)) return "none";
  if (profitAfterTax < 0) return "loss";
  const pct = (profitAfterTax / netRevenue) * 100;
  if (pct < 10) return "m0";
  if (pct < 20) return "m10";
  if (pct < 30) return "m20";
  if (pct < 50) return "m30";
  return "m50";
}

// ------------------------------------------------------------
// Chuỗi ngày kỳ này ↔ kỳ trước
// ------------------------------------------------------------

export interface DailyPoint {
  date: string;
  profit: number;
  netRevenue: number;
  orderCount: number;
  returnLoss: number;
}

export interface AlignedDailyPoint extends DailyPoint {
  label: string;
  /** Ngày tương ứng của kỳ trước (cùng thứ tự) — null khi không có kỳ trước. */
  prevDate: string | null;
  prevProfit: number | null;
  prevOrderCount: number | null;
}

/**
 * Trục ngày liền mạch của kỳ (lấp ngày trống = 0) ghép với kỳ trước theo
 * THỨ TỰ: ngày thứ k của kỳ này so ngày thứ k của kỳ trước. `dateKeyOf(i)`
 * trả khóa ngày thứ i của kỳ (giờ VN), `prevKeyOf` của kỳ trước.
 */
export function alignDaily(input: {
  days: number;
  dateKeyOf: (i: number) => string;
  prevKeyOf: ((i: number) => string) | null;
  labelOf: (key: string) => string;
  current: Map<string, DailyPoint>;
  previous: Map<string, DailyPoint>;
}): AlignedDailyPoint[] {
  const out: AlignedDailyPoint[] = [];
  for (let i = 0; i < input.days; i++) {
    const key = input.dateKeyOf(i);
    const cur = input.current.get(key);
    const prevKey = input.prevKeyOf ? input.prevKeyOf(i) : null;
    const prev = prevKey ? input.previous.get(prevKey) : undefined;
    out.push({
      date: key,
      label: input.labelOf(key),
      profit: cur?.profit ?? 0,
      netRevenue: cur?.netRevenue ?? 0,
      orderCount: cur?.orderCount ?? 0,
      returnLoss: cur?.returnLoss ?? 0,
      prevDate: prevKey,
      prevProfit: prevKey ? (prev?.profit ?? 0) : null,
      prevOrderCount: prevKey ? (prev?.orderCount ?? 0) : null,
    });
  }
  return out;
}

// ------------------------------------------------------------
// Kiểu dữ liệu trả về (route + web dùng chung tên trường)
// ------------------------------------------------------------

export interface PnlPeriodTotals {
  count: number;
  settledCount: number;
  /** Σ netRevenue — doanh thu thực nhận, đã trừ tiền hoàn. */
  netRevenue: number;
  /** Σ profitAfterTax — lãi đơn hàng sau phí sàn, trước chi phí ngoài đơn. */
  profit: number;
  returnCount: number;
  returnLoss: { costLoss: number; platformKept: number; refundLoss: number; total: number };
  lossCount: number;
  /** Σ lãi (âm) của đơn lỗ. */
  lossAmount: number;
  missingCostCount: number;
}

export interface PnlPlatformTotals {
  key: string;
  count: number;
  profit: number;
  netRevenue: number;
  returnCount: number;
  returnLoss: number;
  lossCount: number;
}

export interface PnlMarginBucketRow {
  key: MarginBucketKey;
  count: number;
  profit: number;
  netRevenue: number;
}

export interface PnlHeatCell {
  /** 1 = Thứ Hai … 7 = Chủ Nhật (isodow, giờ VN). */
  dow: number;
  hour: number;
  count: number;
  profit: number;
}

export interface PnlTopProductRow {
  sku: string;
  productName: string;
  imageUrl: string | null;
  orders: number;
  quantity: number;
  returnedQuantity: number;
  revenue: number;
  cost: number;
  profit: number;
  /** Kỳ trước của cùng mã — null khi mã không bán kỳ trước. */
  prev: { orders: number; quantity: number; revenue: number; profit: number } | null;
}

export interface PnlTopProducts {
  byProfit: PnlTopProductRow[];
  byLoss: PnlTopProductRow[];
  rising: PnlTopProductRow[];
  falling: PnlTopProductRow[];
  /** Tổng số mã bán trong kỳ (để ghi "10 / 1.234 mã"). */
  skuCount: number;
}

/** Số đơn tối thiểu để một mã được xếp hạng tăng/giảm (tránh mã 1 đơn nhảy +900 %). */
export const TOP_PRODUCT_MIN_ORDERS = 3;
export const TOP_PRODUCT_LIMIT = 10;
