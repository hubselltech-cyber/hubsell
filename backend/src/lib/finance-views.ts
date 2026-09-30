// ============================================================
// CÁC BẢNG TÀI CHÍNH CÒN LẠI đọc từ sổ cái đơn — phần THUẦN dùng chung cho hai
// nguồn số (docs/SO-CAI-DON.md mục 9.5):
//   · Đơn lỗ (/api/finance/orders-analysis + cảnh báo Trung tâm điều hành);
//   · Phân bổ dòng tiền theo gian (/api/finance/cash-flow);
//   · Lãi/Lỗ theo SKU (/api/finance/sku-pnl).
// Mỗi bảng: đường cũ kéo đơn lên RAM, đường mới SUM/GROUP BY trong database
// (services/order-ledger.ts) — cả hai đổ vào CÙNG hình dạng dưới đây.
// ============================================================

import { ShippingStatus } from "@prisma/client";
import { countsAsRevenue, isLossOrder } from "./finance-definitions";
import type { PnlRow } from "./pnl-formula";

// ------------------------------------------------------------ ĐƠN LỖ

/** Trường tối thiểu của một đơn Đã giao để dựng dòng "Đơn lỗ". */
export interface LossOrderSource {
  id: string;
  orderCode: string;
  customerName: string | null;
  channelName: string;
  shopName: string | null;
  createdAt: Date;
  revenueGross: number;
  /** Toàn bộ sàn khấu trừ = Giá trị đơn − "Tổng tiền" sàn báo. */
  platformDeduction: number;
  isSettled: boolean;
  costSnapshot: number;
  profitAfterTax: number;
  missingCostPrice: boolean;
}

/**
 * Trần số dòng của DANH SÁCH đơn lỗ trả về một lần (lỗ nặng nhất trước). Các
 * con số đếm (đã soát / lỗ / thiếu giá vốn) luôn là số THẬT của cả kỳ; danh
 * sách dài hơn trần thì trả kèm listTotal để giao diện nói rõ, không cắt im
 * lặng. 1.000 là mặc định tự chọn: đủ cho một người rà tay, không kéo hàng
 * chục nghìn dòng về trình duyệt ở shop lớn.
 */
export const LOSS_ORDER_LIST_LIMIT = 1000;

export interface LossOrdersData {
  /** Số đơn Đã giao của kỳ đã soát. */
  analyzedCount: number;
  lossCount: number;
  /** Đơn chưa nhập giá vốn (số liệu chưa đáng tin). */
  warningCount: number;
  /** Tổng số dòng thuộc danh sách (lỗ HOẶC thiếu giá vốn) — có thể lớn hơn items.length. */
  listTotal: number;
  /** Σ |lợi nhuận| của các đơn lỗ — thẻ cảnh báo Trung tâm điều hành. */
  totalLoss: number;
  /** Lỗ nặng nhất trước, tối đa LOSS_ORDER_LIST_LIMIT dòng. */
  items: LossOrderSource[];
}

export function lossOrderSourceOfRow(r: PnlRow): LossOrderSource {
  return {
    id: r.id,
    orderCode: r.orderCode,
    customerName: r.customerName,
    channelName: r.channelName,
    shopName: r.shopName,
    createdAt: r.createdAt,
    revenueGross: r.revenueGross,
    platformDeduction: r.revenueGross - r.platformRevenue,
    isSettled: r.isSettled,
    costSnapshot: r.costSnapshot,
    profitAfterTax: r.profitAfterTax,
    missingCostPrice: r.missingCostPrice,
  };
}

/** ĐƯỜNG CŨ: từ các dòng computePnlRow của đơn ĐÃ GIAO trong kỳ (mới nhất trước). */
export function lossOrdersFromRows(delivered: PnlRow[], limit = LOSS_ORDER_LIST_LIMIT): LossOrdersData {
  let lossCount = 0;
  let warningCount = 0;
  let totalLoss = 0;
  const listed: LossOrderSource[] = [];
  for (const r of delivered) {
    const loss = isLossOrder(r);
    if (loss) {
      lossCount += 1;
      totalLoss += Math.abs(r.profitAfterTax);
    }
    if (r.missingCostPrice) warningCount += 1;
    if (loss || r.missingCostPrice) listed.push(lossOrderSourceOfRow(r));
  }
  // Lỗ nặng nhất lên đầu; sắp xếp ổn định nên đơn cùng mức lỗ giữ thứ tự mới nhất trước.
  listed.sort((a, b) => a.profitAfterTax - b.profitAfterTax);
  return {
    analyzedCount: delivered.length,
    lossCount,
    warningCount,
    listTotal: listed.length,
    totalLoss,
    items: listed.slice(0, limit),
  };
}

/**
 * Dòng hiển thị của trang Đơn lỗ. Lợi nhuận đơn = Doanh thu thực tế ("Tổng
 * tiền" sàn báo) − Giá vốn; < 0 ⇒ ĐƠN LỖ (lib/finance-definitions.ts).
 * BÓC TÁCH LÝ DO LỖ:
 *   - COST: bán dưới giá vốn (lỗ ngay từ khâu nhập hàng/định giá)
 *   - FEE : bán trên giá vốn nhưng sàn khấu trừ ăn hết lãi
 */
export function toLossOrderItem(r: LossOrderSource) {
  const revenue = r.revenueGross;
  const cost = r.costSnapshot;
  const profit = r.profitAfterTax; // = Doanh thu thực tế − giá vốn
  const isLoss = isLossOrder(r); // lãi < 0 (anh Trung chốt 30/09/2026)
  let lossReason: "COST" | "FEE" | null = null;
  if (isLoss && !r.missingCostPrice) {
    lossReason = revenue < cost ? "COST" : "FEE";
  }
  return {
    id: r.id,
    orderCode: r.orderCode,
    customerName: r.customerName,
    channelName: r.channelName,
    shopName: r.shopName,
    createdAt: r.createdAt,
    revenue,
    platformFee: r.platformDeduction, // toàn bộ sàn khấu trừ
    isSettled: r.isSettled, // khấu trừ đã là số quyết toán hay còn chờ đối soát
    cost,
    profit, // âm = lỗ
    isLoss,
    lossReason,
    ...(r.missingCostPrice ? { warning: "Chưa nhập giá vốn" } : {}),
  };
}

// ------------------------------------------------------------ DÒNG TIỀN THEO GIAN

/** Σ "Tổng tiền" sàn báo của đơn CHƯA quyết toán theo gian: đang giao / đã giao chờ đối soát. */
export interface OpenCashByChannel {
  inTransit: Map<string, number>;
  pendingSettle: Map<string, number>;
}

/** ĐƯỜNG CŨ: từ dòng computePnlRow của đơn chưa quyết toán. */
export function openCashFromRows(
  rows: Pick<PnlRow, "isSettled" | "shippingStatus" | "channelId" | "platformRevenue">[]
): OpenCashByChannel {
  const inTransit = new Map<string, number>();
  const pendingSettle = new Map<string, number>();
  for (const r of rows) {
    if (r.isSettled) continue;
    // PENDING/PROCESSED (chưa bàn giao) và CANCELLED: không thuộc dòng tiền dự kiến.
    const m =
      r.shippingStatus === ShippingStatus.SHIPPING
        ? inTransit
        : r.shippingStatus === ShippingStatus.DELIVERED
          ? pendingSettle
          : null;
    if (m) m.set(r.channelId, (m.get(r.channelId) ?? 0) + r.platformRevenue);
  }
  return { inTransit, pendingSettle };
}

/** Tổng + số đơn chưa quyết toán của ĐƠN TÍNH DOANH THU (câu "tiền đang ở đâu" của Trợ lý hỏi đáp). */
export interface OpenCashTotals {
  inTransit: number;
  inTransitCount: number;
  pendingSettle: number;
  pendingCount: number;
}

/** ĐƯỜNG CŨ: từ dòng computePnlRow của đơn chưa quyết toán đang giao / đã giao — chỉ đơn tính doanh thu. */
export function openCashTotalsFromRows(
  rows: Pick<PnlRow, "isSettled" | "shippingStatus" | "returnStatus" | "platformRevenue">[]
): OpenCashTotals {
  const t: OpenCashTotals = { inTransit: 0, inTransitCount: 0, pendingSettle: 0, pendingCount: 0 };
  for (const r of rows) {
    if (!countsAsRevenue(r)) continue;
    if (r.isSettled) continue; // tiền đã nằm trong ví sàn — cộng nữa là đếm đôi
    if (r.shippingStatus === ShippingStatus.SHIPPING) {
      t.inTransit += r.platformRevenue;
      t.inTransitCount += 1;
    } else if (r.shippingStatus === ShippingStatus.DELIVERED) {
      t.pendingSettle += r.platformRevenue;
      t.pendingCount += 1;
    }
  }
  return t;
}

/**
 * Tập đơn mà phép "đơn lỗ" soát:
 *   - "delivered": đơn ĐÃ GIAO (trang Đơn lỗ, thẻ cảnh báo Trung tâm điều hành);
 *   - "active": đơn TÍNH DOANH THU — không hủy, không đang hoàn (Trợ lý hỏi đáp).
 */
export type LossOrderBasis = "delivered" | "active";

// ------------------------------------------------------------ LÃI/LỖ THEO SKU

/** Phần gom TỪ ĐƠN của một SKU (chưa gồm chi phí marketing gắn SKU). */
export interface SkuAgg {
  sku: string;
  productName: string;
  imageUrl: string | null;
  quantitySold: number;
  revenue: number;
  cogs: number;
  /** Sàn khấu trừ của đơn phân bổ theo tỷ trọng giá trị dòng hàng. */
  allocatedFee: number;
}
