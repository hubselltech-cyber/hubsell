// ============================================================
// BÁO CÁO DÒNG TIỀN — hai nguồn số phải cho CÙNG bộ tổng (lib/cash-flow-totals.ts).
//   Đường cũ:  cashFlowTotalsFromRows(computePnlRow(đơn)...)
//   Đường mới: cashFlowTotalsFromLedger(Σ dòng sổ theo nhóm, bảng bóc GROUP BY)
// Logic THUẦN, không DB: dòng sổ dựng bằng buildLedgerRows, cộng bằng
// summarizeLedgerRowsInMemory (cùng nhóm/cột với SQL — đã khóa ở order-ledger.test.ts).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  ChannelName,
  Prisma,
  ReturnSolution,
  ReturnStatus,
  ShippingStatus,
} from "@prisma/client";
import {
  buildLedgerRows,
  summarizeLedgerRowsInMemory,
  type LedgerOrder,
  type OrderLedgerRow,
} from "../order-ledger";
import { computePnlRow } from "../pnl-formula";
import { countsAsRevenue } from "../finance-definitions";
import {
  cashFlowTotalsFromLedger,
  cashFlowTotalsFromRows,
  computeGrossDeductions,
  computeGrossDeductionsFromTotals,
  resolveCashFlowSource,
  type CashFlowTotals,
  type LedgerCashFlowBreakdown,
} from "../cash-flow-totals";

const D = (n: number) => new Prisma.Decimal(n);

type ItemOverride = Partial<Record<keyof LedgerOrder["items"][number], unknown>>;
type OrderOverride = Partial<Record<Exclude<keyof LedgerOrder, "items">, unknown>> & { items?: ItemOverride[] };

/** Đơn Shopee đã quyết toán: 2 dòng (269k + 100k), vốn 131k + 40k, payout 300.000. */
function mkOrder(over: OrderOverride = {}): LedgerOrder {
  const base = {
    id: "o1",
    orderCode: "2609TEST",
    channelId: "c1",
    shippingStatus: ShippingStatus.DELIVERED,
    returnStatus: ReturnStatus.NONE,
    returnSolution: null,
    returnDeliveredAt: null,
    stockRestoredAt: null,
    platformRefundAmount: D(0),
    platformReturnStatus: null,
    isSettled: true,
    settledAt: new Date("2026-09-20T03:00:00Z"),
    deliveredAt: new Date("2026-09-15T10:30:00Z"),
    createdAt: new Date("2026-09-10T17:30:00Z"), // 00:30 ngày 11/09 giờ VN
    packedAt: null,
    customerName: "Khách",
    carrier: null,
    totalAmount: D(369000),
    sellerVoucher: D(0),
    fixedFee: D(30000),
    paymentFee: D(0),
    serviceFee: D(10000),
    sellerProtectionFee: D(0),
    affiliateFee: D(0),
    platformSubsidy: D(0),
    shippingFeeQuoted: D(0),
    shippingFeeActual: D(0),
    shipSubsidyPlatform: D(0),
    shipSubsidyShop: D(0),
    shippingFeeDiff: D(0),
    adWalletTopup: D(0),
    taxWithheld: D(5535),
    refundedAmount: D(0),
    actualPayout: D(300000),
    channel: { channelName: ChannelName.SHOPEE, shopName: "ANO", userId: "u1" },
    inventoryLogs: [],
    lazadaSettlement: null,
    tiktokSettlement: null,
  };
  const items = (
    over.items ?? [
      { id: "i1", channelSku: "TC025", price: D(269000), costPriceAtSale: D(131000) },
      { id: "i2", channelSku: "TC026", price: D(100000), costPriceAtSale: D(40000) },
    ]
  ).map((it, i) => ({
    id: `i${i}`,
    orderId: "o1",
    productId: null,
    channelSku: "SKU",
    productName: "Sản phẩm",
    quantity: 1,
    price: D(0),
    costPriceAtSale: D(0),
    returnedQuantity: 0,
    returnRestocked: false,
    product: null,
    ...it,
  }));
  return { ...base, ...over, items } as unknown as LedgerOrder;
}

/** Bộ đơn phủ mọi nhóm: quyết toán / chờ / hủy / đang hoàn / hoàn xong / thiếu vốn / voucher+trợ giá / gian & ngày khác. */
const ORDERS: LedgerOrder[] = [
  mkOrder({ id: "a" }), // active + settled + delivered
  mkOrder({ id: "b", isSettled: false, actualPayout: D(0), createdAt: new Date("2026-09-12T02:00:00Z") }), // pending, delivered
  mkOrder({ id: "b2", isSettled: false, actualPayout: D(0), shippingStatus: ShippingStatus.SHIPPING, deliveredAt: null }), // pending, đang giao
  mkOrder({ id: "c", shippingStatus: ShippingStatus.CANCELLED, isSettled: false, actualPayout: D(0) }), // hủy
  mkOrder({ // đang hoàn — không tính doanh thu
    id: "d", returnStatus: ReturnStatus.AWAITING, returnSolution: ReturnSolution.RETURN_REFUND,
    isSettled: false, actualPayout: D(0), platformRefundAmount: D(369000),
  }),
  mkOrder({ // hoàn xong một dòng — quay lại doanh thu, có refundedAmount
    id: "e", returnStatus: ReturnStatus.RECEIVED_INTACT, returnSolution: ReturnSolution.RETURN_REFUND,
    returnDeliveredAt: new Date(), refundedAmount: D(100000), actualPayout: D(200000),
    items: [
      { id: "i1", channelSku: "TC025", price: D(269000), costPriceAtSale: D(131000) },
      { id: "i2", channelSku: "TC026", price: D(100000), costPriceAtSale: D(40000), returnedQuantity: 1, returnRestocked: true },
    ],
  }),
  mkOrder({ id: "f", items: [{ id: "i1", price: D(369000), costPriceAtSale: D(0) }] }), // thiếu giá vốn, settled
  mkOrder({ id: "f2", isSettled: false, actualPayout: D(0), items: [{ id: "i1", price: D(369000), costPriceAtSale: D(0) }] }), // thiếu giá vốn, pending
  mkOrder({ // gian TikTok khác, ngày khác, voucher + trợ giá + affiliate + nạp ví + lệch ship
    id: "g", channelId: "c2", channel: { channelName: ChannelName.TIKTOK, shopName: "TT", userId: "u1" },
    createdAt: new Date("2026-09-20T09:00:00Z"), sellerVoucher: D(20000), platformSubsidy: D(8750),
    affiliateFee: D(15000), adWalletTopup: D(5000), shippingFeeDiff: D(3000), actualPayout: D(250000),
  }),
];

/** Bảng bóc GROUP BY như services/order-ledger.ts làm trong database, nhưng cộng trong RAM từ dòng sổ. */
function breakdownInMemory(rows: OrderLedgerRow[]): LedgerCashFlowBreakdown {
  const cogsByChannelName = new Map<string, number>();
  const gmvMaxByChannelId = new Map<string, number>();
  const byDay = new Map<string, { platformRevenue: number; costSnapshot: number }>();
  for (const r of rows) {
    if (!r.countsAsRevenue) continue;
    cogsByChannelName.set(r.channelName, (cogsByChannelName.get(r.channelName) ?? 0) + r.costSnapshot);
    if (r.feeGmvMax !== 0) gmvMaxByChannelId.set(r.channelId, (gmvMaxByChannelId.get(r.channelId) ?? 0) + r.feeGmvMax);
    const d = byDay.get(r.createdDate) ?? { platformRevenue: 0, costSnapshot: 0 };
    d.platformRevenue += r.platformRevenue;
    d.costSnapshot += r.costSnapshot;
    byDay.set(r.createdDate, d);
  }
  return { cogsByChannelName, gmvMaxByChannelId, byDay };
}

function expectSameTotals(a: CashFlowTotals, b: CashFlowTotals) {
  const groups = ["cancelled", "returning", "active", "settled", "pending", "delivered"] as const;
  expect(a.orderCount).toBe(b.orderCount);
  for (const g of groups) {
    const ga = a[g] as Record<string, number>;
    const gb = b[g] as Record<string, number>;
    expect(Object.keys(ga).sort(), g).toEqual(Object.keys(gb).sort());
    for (const k of Object.keys(ga)) expect(ga[k], `${g}.${k}`).toBeCloseTo(gb[k], 6);
  }
  const maps = ["gmvMaxByChannelId", "cogsByChannelName", "revenueByDay", "cogsByDay"] as const;
  for (const m of maps) {
    expect([...a[m].keys()].sort(), m).toEqual([...b[m].keys()].sort());
    for (const [k, v] of a[m]) expect(v, `${m}.${k}`).toBeCloseTo(b[m].get(k)!, 6);
  }
}

describe("cashFlowTotals — đường sổ cái = đường kéo đơn từng đồng", () => {
  const fromRows = cashFlowTotalsFromRows(ORDERS.map((o) => computePnlRow(o)));
  const ledgerRows = ORDERS.map((o) => buildLedgerRows(o).order);
  const fromLedger = cashFlowTotalsFromLedger(summarizeLedgerRowsInMemory(ledgerRows), breakdownInMemory(ledgerRows));

  it("mọi nhóm, mọi cột, mọi bảng bóc đều bằng nhau", () => {
    expectSameTotals(fromLedger, fromRows);
  });

  it("phân nhóm đúng định nghĩa tài chính (hủy / đang hoàn không tính doanh thu; hoàn xong quay lại)", () => {
    expect(fromRows.orderCount).toBe(9);
    expect(fromRows.cancelled.count).toBe(1);
    expect(fromRows.returning.count).toBe(1);
    expect(fromRows.active.count).toBe(7);
    expect(fromRows.settled.count + fromRows.pending.count).toBe(fromRows.active.count);
    expect(fromRows.settled.count).toBe(4); // a, e, f, g
    expect(fromRows.pending.count).toBe(3); // b, b2, f2
    expect(fromRows.delivered.count).toBe(6); // active trừ b2 đang giao
    // Đơn thiếu giá vốn: đếm ở cả hai trục, lợi nhuận bị loại khỏi *WithCost.
    expect(fromRows.active.missingCostCount).toBe(2);
    expect(fromRows.settled.profitAfterTaxWithCost).toBe(
      computePnlRow(ORDERS[0]).profitAfterTax + computePnlRow(ORDERS[5]).profitAfterTax + computePnlRow(ORDERS[8]).profitAfterTax
    );
    // Chuỗi ngày theo GIỜ VN: đơn a/… 17:30Z ngày 10 → 11/09; đơn g 09:00Z → 20/09; b 02:00Z ngày 12 → 12/09.
    expect([...fromRows.revenueByDay.keys()].sort()).toEqual(["2026-09-11", "2026-09-12", "2026-09-20"]);
    expect(fromRows.cogsByChannelName.get("TIKTOK")).toBe(171000);
    expect(fromRows.gmvMaxByChannelId.size).toBe(0);
  });

  it("thác nước từ bộ tổng = thác nước từ dòng (computeGrossDeductions cũ) và luôn đóng", () => {
    const activeRows = ORDERS.filter((o) => countsAsRevenue(o)).map((o) => computePnlRow(o));
    expect(activeRows).toHaveLength(fromRows.active.count);
    const g1 = computeGrossDeductions(activeRows);
    const g2 = computeGrossDeductionsFromTotals(fromLedger.active);
    expect(g2.grossValue).toBeCloseTo(g1.grossValue, 6);
    expect(g2.totalDeduction).toBeCloseTo(g1.totalDeduction, 6);
    expect(g2.items.map((i) => i.key)).toEqual(g1.items.map((i) => i.key));
    for (let i = 0; i < g1.items.length; i++) expect(g2.items[i].amount, g1.items[i].key).toBeCloseTo(g1.items[i].amount, 6);
    expect(g2.grossValue - g2.totalDeduction).toBeCloseTo(g2.actualRevenueTotal, 6);
    expect(g2.items.reduce((s, i) => s + i.amount, 0)).toBeCloseTo(g2.totalDeduction, 6);
    expect(g2.items.find((i) => i.key === "subsidy")?.amount).toBe(-8750);
    expect(g2.items.find((i) => i.key === "refund")?.amount).toBe(100000);
  });

  it("tập rỗng → mọi số 0, không NaN", () => {
    const e = cashFlowTotalsFromRows([]);
    expect(e.orderCount).toBe(0);
    expect(e.active.count).toBe(0);
    const g = computeGrossDeductionsFromTotals(e.active);
    expect(g.totalDeduction).toBe(0);
    for (const i of g.items) expect(i.amount).toBe(0);
    for (const i of g.items) expect(Number.isNaN(i.percent)).toBe(false);
  });
});

describe("resolveCashFlowSource — ?source= thắng env, mặc định sổ cái", () => {
  it("mặc định ledger; env CASH_FLOW_SOURCE=orders lui về đường cũ", () => {
    expect(resolveCashFlowSource(undefined, undefined)).toBe("ledger");
    expect(resolveCashFlowSource(undefined, "orders")).toBe("orders");
    expect(resolveCashFlowSource(undefined, "gì đó")).toBe("ledger");
  });
  it("query hợp lệ thắng env; query lạ bỏ qua", () => {
    expect(resolveCashFlowSource("orders", undefined)).toBe("orders");
    expect(resolveCashFlowSource(" LEDGER ", "orders")).toBe("ledger");
    expect(resolveCashFlowSource("abc", "orders")).toBe("orders");
    expect(resolveCashFlowSource(["orders"], undefined)).toBe("ledger");
  });
});
