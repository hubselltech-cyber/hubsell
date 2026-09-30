// ============================================================
// DỰNG DÒNG SỔ CÁI TỪ MỘT ĐƠN — HÀM THUẦN (không DB, có test)
//
// Sổ cái đơn (docs/SO-CAI-DON.md) = kết quả computePnlRow ghi xuống database
// để báo cáo cộng bằng SQL. Tệp này là cầu nối duy nhất giữa công thức và hai
// bảng order_ledger / order_line_ledger:
//   · buildLedgerRows(order) → { order: dòng sổ đơn, lines: dòng sổ dòng hàng }
//   · các cờ lọc (countsAsRevenue, isReturning, isLoss) lấy từ lib/finance-
//     definitions.ts — SQL chỉ WHERE trên cột đã ghi, không tự diễn giải lại.
//   · tiền của đơn PHÂN BỔ xuống dòng theo tỷ trọng giá trị dòng (cùng cách
//     /sku-pnl, biên lãi quảng cáo và hòa vốn TikTok đang làm), làm tròn 2 số
//     lẻ và dồn phần dư về dòng lớn nhất → Σ dòng = đơn từng xu.
//
// LEDGER_FORMULA_VERSION: tăng mỗi khi computePnlRow / cách phân bổ đổi. Worker
// thấy dòng có version cũ hơn thì tính lại nền; báo cáo không trộn hai phiên
// bản trong một kỳ (services/order-ledger.ts).
// ============================================================

import type { Prisma } from "@prisma/client";
import {
  computePnlRow,
  computeReturnLoss,
  PNL_INCLUDE,
  returnGoodsRecovered,
  type PnlRow,
} from "./pnl-formula";
import { countsAsRevenue, isLossOrder, isReturning } from "./finance-definitions";
import { toBusinessDateKey } from "./date-range";

/** Phiên bản công thức đang ghi sổ. Đổi công thức → tăng số này. */
export const LEDGER_FORMULA_VERSION = 1;

/** Đơn kèm quan hệ để ghi sổ = tập PnlOrder + chủ shop của gian. */
export const LEDGER_INCLUDE = {
  ...PNL_INCLUDE,
  channel: { select: { channelName: true, shopName: true, userId: true } },
} satisfies Prisma.OrderInclude;

export type LedgerOrder = Prisma.OrderGetPayload<{ include: typeof LEDGER_INCLUDE }>;

export type LedgerReturnTypeValue =
  | "REFUND_ONLY"
  | "PARTIAL_REFUND"
  | "PARTIAL_RETURN"
  | "FULL_RETURN";

/** Một dòng order_ledger (chưa gồm cột sổ sách dirtyAt/claimedAt — worker đặt). */
export interface OrderLedgerRow {
  orderId: string;
  /** yyyy-mm-dd theo giờ VN. */
  createdDate: string;
  channelId: string;
  ownerId: string;
  channelName: LedgerOrder["channel"]["channelName"];
  orderCode: string;
  createdAt: Date;
  deliveredAt: Date | null;
  deliveredDate: string | null;
  settledAt: Date | null;
  settledDate: string | null;
  shippingStatus: LedgerOrder["shippingStatus"];
  returnStatus: LedgerOrder["returnStatus"];
  isSettled: boolean;
  returnType: LedgerReturnTypeValue | null;
  countsAsRevenue: boolean;
  isReturning: boolean;
  isLoss: boolean;
  missingCostPrice: boolean;
  itemCount: number;
  totalQuantity: number;
  returnedQuantity: number;
  revenueGross: number;
  sellerVoucher: number;
  actualRevenue: number;
  platformSubsidy: number;
  shippingFeeQuoted: number;
  shippingFeeActual: number;
  shippingFeeDiff: number;
  shipSubsidyPlatform: number;
  shipSubsidyShop: number;
  feeFixedPayment: number;
  feeService: number;
  feeSellerProtection: number;
  feeGmvMax: number;
  feeAffiliate: number;
  adWalletTopup: number;
  platformTax: number;
  refundedAmount: number;
  refundEstimated: boolean;
  refundSource: string | null;
  returnedCostAtSale: number;
  recoveredCost: number;
  costSnapshot: number;
  netRevenue: number;
  actualPayout: number;
  platformRevenue: number;
  platformDeduction: number;
  profit: number;
  profitAfterTax: number;
  returnLossCost: number;
  returnLossPlatformKept: number;
  returnLossRefund: number;
  formulaVersion: number;
}

/** Một dòng order_line_ledger. */
export interface OrderLineLedgerRow {
  orderItemId: string;
  createdDate: string;
  orderId: string;
  channelId: string;
  ownerId: string;
  channelName: LedgerOrder["channel"]["channelName"];
  productId: string | null;
  channelSku: string;
  productName: string;
  createdAt: Date;
  deliveredDate: string | null;
  settledDate: string | null;
  shippingStatus: LedgerOrder["shippingStatus"];
  returnStatus: LedgerOrder["returnStatus"];
  isSettled: boolean;
  countsAsRevenue: boolean;
  missingCostPrice: boolean;
  quantity: number;
  returnedQuantity: number;
  recoveredQuantity: number;
  price: number;
  costPriceAtSale: number;
  lineGross: number;
  lineCost: number;
  costSnapshot: number;
  recoveredCost: number;
  share: number;
  revenueGross: number;
  actualRevenue: number;
  platformRevenue: number;
  platformDeduction: number;
  refundedAmount: number;
  feeGmvMax: number;
  profit: number;
  profitAfterTax: number;
  formulaVersion: number;
}

/** Danh sách cột TIỀN của dòng sổ đơn — dùng chung cho SQL ghi, SQL cộng và đối soát. */
export const ORDER_LEDGER_MONEY_COLUMNS = [
  "revenueGross",
  "sellerVoucher",
  "actualRevenue",
  "platformSubsidy",
  "shippingFeeQuoted",
  "shippingFeeActual",
  "shippingFeeDiff",
  "shipSubsidyPlatform",
  "shipSubsidyShop",
  "feeFixedPayment",
  "feeService",
  "feeSellerProtection",
  "feeGmvMax",
  "feeAffiliate",
  "adWalletTopup",
  "platformTax",
  "refundedAmount",
  "returnedCostAtSale",
  "recoveredCost",
  "costSnapshot",
  "netRevenue",
  "actualPayout",
  "platformRevenue",
  "platformDeduction",
  "profit",
  "profitAfterTax",
  "returnLossCost",
  "returnLossPlatformKept",
  "returnLossRefund",
] as const satisfies readonly (keyof OrderLedgerRow)[];

export type OrderLedgerMoneyColumn = (typeof ORDER_LEDGER_MONEY_COLUMNS)[number];

/** Làm tròn 2 số lẻ, tránh -0 và sai số nhị phân kiểu 1.005. */
export function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Chia `total` theo `weights`, làm tròn 2 số lẻ, phần dư dồn về phần tử có
 * trọng số lớn nhất (đầu tiên nếu hòa) → Σ kết quả = round2(total) LUÔN đúng.
 * Trọng số toàn 0 → chia đều. Mảng rỗng → mảng rỗng.
 */
export function allocateByWeight(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const target = round2(total);
  const sum = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  const useEqual = sum <= 0;
  const parts = weights.map((w) => round2(useEqual ? target / n : (target * Math.max(w, 0)) / sum));
  const allocated = parts.reduce((s, p) => s + p, 0);
  const remainder = round2(target - allocated);
  if (remainder !== 0) {
    let idx = 0;
    if (!useEqual) {
      for (let i = 1; i < n; i++) if (weights[i] > weights[idx]) idx = i;
    }
    parts[idx] = round2(parts[idx] + remainder);
  }
  return parts;
}

/** Date → "yyyy-mm-dd" giờ VN (null giữ null). */
function vnDate(d: Date | null | undefined): string | null {
  return d ? toBusinessDateKey(d) : null;
}

/**
 * Số lượng THU HỒI vốn của từng dòng — chép đúng luật orderCost trong
 * lib/pnl-formula.ts (dòng đã restock → phần trả; hàng đã về/hủy → phần trả
 * nếu có dữ liệu dòng, không thì cả dòng). Để dòng sổ ghi được costSnapshot
 * riêng từng dòng mà Σ dòng = costSnapshot của đơn.
 */
function recoveredQuantityOf(
  it: LedgerOrder["items"][number],
  recoveredAll: boolean,
  hasLineData: boolean
): number {
  if (it.returnRestocked) return Math.min(it.returnedQuantity, it.quantity);
  if (recoveredAll) return hasLineData ? Math.min(it.returnedQuantity, it.quantity) : it.quantity;
  return 0;
}

/**
 * DỰNG DÒNG SỔ của một đơn. Không gọi DB. Mọi số tiền làm tròn 2 số lẻ.
 * Trả kèm `pnl` (dòng computePnlRow gốc) cho nơi gọi cần đối chiếu.
 */
export function buildLedgerRows(o: LedgerOrder): {
  order: OrderLedgerRow;
  lines: OrderLineLedgerRow[];
  pnl: PnlRow;
} {
  const r = computePnlRow(o);
  const rl = computeReturnLoss(r);
  const createdDate = toBusinessDateKey(o.createdAt);
  const deliveredDate = vnDate(o.deliveredAt);
  const settledDate = vnDate(o.settledAt);
  const revenueFlag = countsAsRevenue(o);
  const returning = isReturning(o);
  const platformDeduction = round2(r.revenueGross - r.platformRevenue);

  const order: OrderLedgerRow = {
    orderId: o.id,
    createdDate,
    channelId: o.channelId,
    ownerId: o.channel.userId,
    channelName: o.channel.channelName,
    orderCode: o.orderCode,
    createdAt: o.createdAt,
    deliveredAt: o.deliveredAt,
    deliveredDate,
    settledAt: o.settledAt,
    settledDate,
    shippingStatus: o.shippingStatus,
    returnStatus: o.returnStatus,
    isSettled: o.isSettled,
    returnType: r.returnType,
    countsAsRevenue: revenueFlag,
    isReturning: returning,
    isLoss: isLossOrder(r),
    missingCostPrice: r.missingCostPrice,
    itemCount: o.items.length,
    totalQuantity: r.totalQuantity,
    returnedQuantity: r.returnedQuantity,
    revenueGross: round2(r.revenueGross),
    sellerVoucher: round2(r.sellerVoucher),
    actualRevenue: round2(r.actualRevenue),
    platformSubsidy: round2(r.platformSubsidy),
    shippingFeeQuoted: round2(r.shippingFeeQuoted),
    shippingFeeActual: round2(r.shippingFeeActual),
    shippingFeeDiff: round2(r.shippingFeeDiff),
    shipSubsidyPlatform: round2(r.shipSubsidyPlatform),
    shipSubsidyShop: round2(r.shipSubsidyShop),
    feeFixedPayment: round2(r.feeFixedPayment),
    feeService: round2(r.feeService),
    feeSellerProtection: round2(r.feeSellerProtection),
    feeGmvMax: round2(r.feeGmvMax),
    feeAffiliate: round2(r.feeAffiliate),
    adWalletTopup: round2(r.adWalletTopup),
    platformTax: round2(r.platformTax),
    refundedAmount: round2(r.refundedAmount),
    refundEstimated: r.refundEstimated,
    refundSource: r.refundSource,
    returnedCostAtSale: round2(r.returnedCostAtSale),
    recoveredCost: round2(r.recoveredCost),
    costSnapshot: round2(r.costSnapshot),
    netRevenue: round2(r.netRevenue),
    actualPayout: round2(r.actualPayout),
    platformRevenue: round2(r.platformRevenue),
    platformDeduction,
    profit: round2(r.profit),
    profitAfterTax: round2(r.profitAfterTax),
    returnLossCost: round2(rl.costLoss),
    returnLossPlatformKept: round2(rl.platformKept),
    returnLossRefund: round2(rl.refundLoss),
    formulaVersion: LEDGER_FORMULA_VERSION,
  };

  // ---- Dòng hàng: tỷ trọng theo giá trị dòng (quantity × price) ----
  const items = o.items;
  const weights = items.map((it) => it.quantity * Number(it.price));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const shares =
    items.length === 0
      ? []
      : weightSum > 0
        ? weights.map((w) => w / weightSum)
        : items.map(() => 1 / items.length);
  const alloc = (total: number) => allocateByWeight(total, weights);
  const aRevenueGross = alloc(r.revenueGross);
  const aActualRevenue = alloc(r.actualRevenue);
  const aPlatformRevenue = alloc(r.platformRevenue);
  const aDeduction = alloc(platformDeduction);
  const aRefunded = alloc(r.refundedAmount);
  const aFeeGmvMax = alloc(r.feeGmvMax);
  const aProfit = alloc(r.profit);
  const aProfitAfterTax = alloc(r.profitAfterTax);

  // Giá vốn từng dòng: cùng luật thu hồi với orderCost (chỉ áp khi đơn có dòng
  // hàng — đơn cũ không có dòng thì costSnapshot nằm ở cấp đơn, không phân bổ).
  const recoveredAll = returnGoodsRecovered(o);
  const hasLineData = items.some((it) => it.returnedQuantity > 0);

  const lines: OrderLineLedgerRow[] = items.map((it, i) => {
    const unitCost = Number(it.costPriceAtSale);
    const recoveredQty = recoveredQuantityOf(it, recoveredAll, hasLineData);
    return {
      orderItemId: it.id,
      createdDate,
      orderId: o.id,
      channelId: o.channelId,
      ownerId: o.channel.userId,
      channelName: o.channel.channelName,
      productId: it.productId,
      channelSku: it.channelSku,
      productName: it.productName,
      createdAt: o.createdAt,
      deliveredDate,
      settledDate,
      shippingStatus: o.shippingStatus,
      returnStatus: o.returnStatus,
      isSettled: o.isSettled,
      countsAsRevenue: revenueFlag,
      missingCostPrice: r.missingCostPrice,
      quantity: it.quantity,
      returnedQuantity: it.returnedQuantity,
      recoveredQuantity: recoveredQty,
      price: round2(Number(it.price)),
      costPriceAtSale: round2(unitCost),
      lineGross: round2(weights[i]),
      lineCost: round2(it.quantity * unitCost),
      costSnapshot: round2((it.quantity - recoveredQty) * unitCost),
      recoveredCost: round2(recoveredQty * unitCost),
      share: Math.round(shares[i] * 1e10) / 1e10,
      revenueGross: aRevenueGross[i],
      actualRevenue: aActualRevenue[i],
      platformRevenue: aPlatformRevenue[i],
      platformDeduction: aDeduction[i],
      refundedAmount: aRefunded[i],
      feeGmvMax: aFeeGmvMax[i],
      profit: aProfit[i],
      profitAfterTax: aProfitAfterTax[i],
      formulaVersion: LEDGER_FORMULA_VERSION,
    };
  });

  return { order, lines, pnl: r };
}

/**
 * So một dòng sổ ĐÃ GHI với dòng vừa tính lại từ đơn gốc — trả danh sách cột
 * lệch quá `tolerance` (mặc định 0,5 đồng: sổ lưu 2 số lẻ). Dùng cho job đối
 * soát đêm và test tích hợp.
 */
export function diffLedgerRows(
  stored: Partial<Record<OrderLedgerMoneyColumn, number | { toString(): string }>> & {
    countsAsRevenue?: boolean;
    isLoss?: boolean;
    missingCostPrice?: boolean;
    returnType?: string | null;
  },
  fresh: OrderLedgerRow,
  tolerance = 0.5
): { column: string; stored: number | string | boolean | null; fresh: number | string | boolean | null }[] {
  const out: { column: string; stored: number | string | boolean | null; fresh: number | string | boolean | null }[] = [];
  for (const col of ORDER_LEDGER_MONEY_COLUMNS) {
    const s = Number(stored[col] ?? 0);
    const f = fresh[col];
    if (Math.abs(s - f) > tolerance) out.push({ column: col, stored: s, fresh: f });
  }
  const flags = ["countsAsRevenue", "isLoss", "missingCostPrice", "returnType"] as const;
  for (const k of flags) {
    if (stored[k] !== undefined && (stored[k] ?? null) !== (fresh[k] ?? null)) {
      out.push({ column: k, stored: stored[k] ?? null, fresh: fresh[k] ?? null });
    }
  }
  return out;
}

// ============================================================
// NHÓM ĐƠN CỦA BÁO CÁO — MỘT định nghĩa, hai cách dùng (SQL và TS)
//
// Mọi báo cáo tài chính chia đơn vào các nhóm dưới đây (cùng trục với tab lọc
// Lãi/Lỗ và thẻ Báo cáo dòng tiền). `sql` là điều kiện WHERE trên cột đã ghi
// của order_ledger; `test` là cùng điều kiện trên dòng TS — dùng để đối soát
// "SQL trên sổ" với "tính lại trong RAM" khớp nhau từng nhóm.
// ============================================================

export type LedgerGroupKey =
  | "all"
  | "active"
  | "cancelled"
  | "returning"
  | "settled"
  | "pending"
  | "delivered";

type GroupFlags = Pick<
  OrderLedgerRow,
  "countsAsRevenue" | "isReturning" | "isSettled" | "shippingStatus"
>;

export const LEDGER_GROUPS: Record<LedgerGroupKey, { sql: string; test: (r: GroupFlags) => boolean; label: string }> = {
  all: { sql: "TRUE", test: () => true, label: "Tất cả đơn" },
  active: { sql: `"countsAsRevenue"`, test: (r) => r.countsAsRevenue, label: "Đơn tính doanh thu" },
  cancelled: {
    sql: `"shippingStatus" = 'CANCELLED'`,
    test: (r) => r.shippingStatus === "CANCELLED",
    label: "Đơn hủy",
  },
  returning: {
    sql: `"shippingStatus" <> 'CANCELLED' AND "isReturning"`,
    test: (r) => r.shippingStatus !== "CANCELLED" && r.isReturning,
    label: "Đang hoàn/trả",
  },
  settled: {
    sql: `"countsAsRevenue" AND "isSettled"`,
    test: (r) => r.countsAsRevenue && r.isSettled,
    label: "Đã quyết toán",
  },
  pending: {
    sql: `"countsAsRevenue" AND NOT "isSettled"`,
    test: (r) => r.countsAsRevenue && !r.isSettled,
    label: "Chờ quyết toán",
  },
  delivered: {
    sql: `"countsAsRevenue" AND "shippingStatus" = 'DELIVERED'`,
    test: (r) => r.countsAsRevenue && r.shippingStatus === "DELIVERED",
    label: "Đã giao (tính doanh thu)",
  },
};

export const LEDGER_GROUP_KEYS = Object.keys(LEDGER_GROUPS) as LedgerGroupKey[];

/** Tổng một nhóm: đếm + Σ từng cột tiền + vài chỉ số đếm phụ. */
export interface LedgerGroupTotals extends Record<OrderLedgerMoneyColumn, number> {
  count: number;
  /** Số đơn chưa có giá vốn và phần lợi nhuận của chúng (bị loại khỏi lợi nhuận). */
  missingCostCount: number;
  missingCostExcludedProfit: number;
  lossCount: number;
  returnCount: number;
  totalQuantity: number;
}

export type LedgerSummary = Record<LedgerGroupKey, LedgerGroupTotals>;

export function emptyGroupTotals(): LedgerGroupTotals {
  const t = {
    count: 0,
    missingCostCount: 0,
    missingCostExcludedProfit: 0,
    lossCount: 0,
    returnCount: 0,
    totalQuantity: 0,
  } as LedgerGroupTotals;
  for (const c of ORDER_LEDGER_MONEY_COLUMNS) t[c] = 0;
  return t;
}

/**
 * Cộng các dòng sổ TRONG RAM theo đúng nhóm/cột như SQL — chỉ dùng để ĐỐI SOÁT
 * (trang HQ, test), không phải đường đọc của báo cáo (báo cáo cộng trong DB).
 */
export function summarizeLedgerRowsInMemory(rows: OrderLedgerRow[]): LedgerSummary {
  const out = {} as LedgerSummary;
  for (const g of LEDGER_GROUP_KEYS) out[g] = emptyGroupTotals();
  for (const r of rows) {
    for (const g of LEDGER_GROUP_KEYS) {
      if (!LEDGER_GROUPS[g].test(r)) continue;
      const t = out[g];
      t.count += 1;
      t.totalQuantity += r.totalQuantity;
      if (r.missingCostPrice) {
        t.missingCostCount += 1;
        t.missingCostExcludedProfit = round2(t.missingCostExcludedProfit + r.profitAfterTax);
      }
      if (r.isLoss) t.lossCount += 1;
      if (r.returnType !== null) t.returnCount += 1;
      for (const c of ORDER_LEDGER_MONEY_COLUMNS) t[c] = round2(t[c] + r[c]);
    }
  }
  return out;
}
