// ============================================================
// ĐƠN LỖ / DÒNG TIỀN THEO GIAN / LÃI-LỖ THEO SKU — hai nguồn số phải bằng nhau
// (lib/finance-views.ts). Phía sổ cộng TRONG RAM theo đúng phép cộng của SQL
// trong services/order-ledger.ts. Logic THUẦN, không DB.
// ============================================================

import { describe, expect, it } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { buildLedgerRows, type OrderLedgerRow, type OrderLineLedgerRow } from "../order-ledger";
import { computePnlRow, type PnlOrder } from "../pnl-formula";
import {
  LOSS_ORDER_LIST_LIMIT,
  lossOrdersFromRows,
  openCashFromRows,
  toLossOrderItem,
  type LossOrderSource,
  type SkuAgg,
} from "../finance-views";
import { addOrderToSkuAgg } from "../../routes/finance";
import { FIXTURE_ORDERS, mkOrder, D } from "./ledger-order-fixture";

const ORDERS = [
  ...FIXTURE_ORDERS,
  mkOrder({ id: "loss-fee", orderCode: "LOSSFEE", actualPayout: D(100000) }), // về ví 100k < vốn 171k, giá bán 369k ≥ vốn → lỗ do PHÍ
  mkOrder({ // bán dưới giá vốn → lỗ do GIÁ VỐN
    id: "loss-cost", orderCode: "LOSSCOST", totalAmount: D(100000), actualPayout: D(90000),
    items: [{ id: "i1", channelSku: "TC025", price: D(100000), costPriceAtSale: D(131000) }],
  }),
  mkOrder({ // quà tặng: mọi dòng giá 0, sàn vẫn trừ phí → KHÔNG phân bổ phí vào SKU
    id: "gift", orderCode: "GIFT", totalAmount: D(0), actualPayout: D(-5000),
    items: [{ id: "g1", channelSku: "QUA1", price: D(0), costPriceAtSale: D(10000) }, { id: "g2", channelSku: "QUA2", price: D(0), costPriceAtSale: D(10000) }],
  }),
  mkOrder({ // đang giao chưa quyết toán ở gian khác → cột "đang giao"
    id: "ship2", channelId: "c2", channel: { channelName: ChannelName.TIKTOK, shopName: "TT", userId: "u1" },
    shippingStatus: ShippingStatus.SHIPPING, isSettled: false, actualPayout: D(0), deliveredAt: null,
  }),
];
const PNL_ROWS = ORDERS.map((o) => computePnlRow(o));
const BUILT = ORDERS.map((o) => buildLedgerRows(o));
const LEDGER_ROWS: OrderLedgerRow[] = BUILT.map((b) => b.order);
const LINES: OrderLineLedgerRow[] = BUILT.flatMap((b) => b.lines);

describe("Đơn lỗ — đếm cả kỳ + danh sách lỗ nặng nhất trước", () => {
  const delivered = PNL_ROWS.filter((r) => r.shippingStatus === ShippingStatus.DELIVERED);
  const data = lossOrdersFromRows(delivered);

  it("sổ (WHERE Đã giao; FILTER isLoss / missingCostPrice; ORDER BY lợi nhuận) cho cùng kết quả", () => {
    const ledgerDelivered = LEDGER_ROWS.filter((r) => r.shippingStatus === ShippingStatus.DELIVERED);
    const listed = ledgerDelivered
      .filter((r) => r.isLoss || r.missingCostPrice)
      // ORDER BY "profitAfterTax" ASC, "createdAt" DESC, "orderId" DESC
      .sort((a, b) => a.profitAfterTax - b.profitAfterTax || b.createdAt.getTime() - a.createdAt.getTime());
    expect(data.analyzedCount).toBe(ledgerDelivered.length);
    expect(data.lossCount).toBe(ledgerDelivered.filter((r) => r.isLoss).length);
    expect(data.warningCount).toBe(ledgerDelivered.filter((r) => r.missingCostPrice).length);
    expect(data.listTotal).toBe(listed.length);
    expect(data.totalLoss).toBeCloseTo(
      ledgerDelivered.filter((r) => r.isLoss).reduce((s, r) => s - r.profitAfterTax, 0), 6
    );
    expect(data.items.map((i) => i.profitAfterTax)).toEqual(listed.map((r) => r.profitAfterTax));
    for (let i = 0; i < listed.length; i++) {
      expect(data.items[i].platformDeduction).toBeCloseTo(listed[i].platformDeduction, 6);
      expect(data.items[i].costSnapshot).toBeCloseTo(listed[i].costSnapshot, 6);
    }
  });

  it("lý do lỗ: bán dưới giá vốn = COST, bị phí ăn hết lãi = FEE, thiếu giá vốn = chưa kết luận", () => {
    const by = new Map(data.items.map((i) => [i.orderCode, toLossOrderItem(i)]));
    expect(by.get("LOSSCOST")?.lossReason).toBe("COST");
    expect(by.get("LOSSFEE")?.lossReason).toBe("FEE");
    const missing = data.items.map(toLossOrderItem).filter((i) => i.warning);
    expect(missing.length).toBe(data.warningCount);
    for (const m of missing) expect(m.lossReason).toBeNull();
    // Lỗ nặng nhất trước
    const profits = data.items.map((i) => i.profitAfterTax);
    expect(profits).toEqual([...profits].sort((a, b) => a - b));
  });

  it("danh sách có trần, số đếm thì không: limit 0 = chỉ lấy số (thẻ cảnh báo)", () => {
    const only = lossOrdersFromRows(delivered, 0);
    expect(only.items).toEqual([]);
    expect(only.lossCount).toBe(data.lossCount);
    expect(only.listTotal).toBe(data.listTotal);
    const one = lossOrdersFromRows(delivered, 1);
    expect(one.items).toHaveLength(1);
    expect(one.items[0].profitAfterTax).toBe(Math.min(...data.items.map((i) => i.profitAfterTax)));
    expect(LOSS_ORDER_LIST_LIMIT).toBeGreaterThanOrEqual(100);
  });

  it("tập rỗng", () => {
    const e = lossOrdersFromRows([]);
    expect(e).toMatchObject({ analyzedCount: 0, lossCount: 0, warningCount: 0, listTotal: 0, totalLoss: 0 });
    const src: LossOrderSource = { ...data.items[0], profitAfterTax: 0 };
    expect(toLossOrderItem(src).isLoss).toBe(false); // bằng 0 không phải lỗ
  });
});

describe("Dòng tiền theo gian — đơn chưa quyết toán: đang giao / đã giao chờ đối soát", () => {
  it("sổ (NOT isSettled AND shippingStatus IN (SHIPPING, DELIVERED) GROUP BY gian, trạng thái) = đường cũ", () => {
    const fromRows = openCashFromRows(PNL_ROWS);
    const inTransit = new Map<string, number>();
    const pendingSettle = new Map<string, number>();
    for (const r of LEDGER_ROWS) {
      if (r.isSettled) continue;
      if (r.shippingStatus !== ShippingStatus.SHIPPING && r.shippingStatus !== ShippingStatus.DELIVERED) continue;
      const m = r.shippingStatus === ShippingStatus.SHIPPING ? inTransit : pendingSettle;
      m.set(r.channelId, (m.get(r.channelId) ?? 0) + r.platformRevenue);
    }
    expect([...fromRows.inTransit.keys()].sort()).toEqual([...inTransit.keys()].sort());
    expect([...fromRows.pendingSettle.keys()].sort()).toEqual([...pendingSettle.keys()].sort());
    for (const [k, v] of inTransit) expect(fromRows.inTransit.get(k)).toBeCloseTo(v, 6);
    for (const [k, v] of pendingSettle) expect(fromRows.pendingSettle.get(k)).toBeCloseTo(v, 6);
    expect(fromRows.inTransit.has("c2")).toBe(true); // đơn TikTok đang giao
    expect(fromRows.inTransit.has("c1")).toBe(true); // đơn b2 đang giao
  });

  it("đơn đã quyết toán, đơn hủy không vào cột nào", () => {
    const settledOnly = openCashFromRows(PNL_ROWS.filter((r) => r.isSettled || r.shippingStatus === ShippingStatus.CANCELLED));
    expect(settledOnly.inTransit.size + settledOnly.pendingSettle.size).toBe(0);
  });
});

describe("Lãi/Lỗ theo SKU — sổ dòng hàng = đường cũ", () => {
  // Đường cũ
  const old = new Map<string, SkuAgg>();
  for (const o of ORDERS) {
    if (o.shippingStatus === ShippingStatus.DELIVERED) addOrderToSkuAgg(old, o as unknown as PnlOrder);
  }
  // Phép cộng của SQL trên sổ dòng hàng
  const fromLines = new Map<string, SkuAgg>();
  for (const l of LINES) {
    if (l.shippingStatus !== ShippingStatus.DELIVERED) continue;
    const a = fromLines.get(l.channelSku) ?? {
      sku: l.channelSku, productName: l.productName, imageUrl: null, quantitySold: 0, revenue: 0, cogs: 0, allocatedFee: 0,
    };
    a.quantitySold += l.quantity;
    a.revenue += l.lineGross;
    a.cogs += l.lineCost;
    a.allocatedFee += l.lineGross > 0 ? l.platformDeduction : 0; // CASE WHEN "lineGross" > 0
    fromLines.set(l.channelSku, a);
  }

  it("cùng tập mã, cùng số lượng / doanh thu / giá vốn; phí phân bổ lệch không quá 1 đồng mỗi mã", () => {
    expect([...fromLines.keys()].sort()).toEqual([...old.keys()].sort());
    for (const [sku, a] of old) {
      const b = fromLines.get(sku)!;
      expect(b.quantitySold, `${sku} qty`).toBe(a.quantitySold);
      expect(b.revenue, `${sku} revenue`).toBeCloseTo(a.revenue, 6);
      expect(b.cogs, `${sku} cogs`).toBeCloseTo(a.cogs, 6);
      expect(Math.abs(b.allocatedFee - a.allocatedFee), `${sku} fee`).toBeLessThanOrEqual(1);
    }
  });

  it("đơn mà mọi dòng giá 0 (quà tặng): có số lượng + giá vốn, KHÔNG gánh phí phân bổ", () => {
    for (const sku of ["QUA1", "QUA2"]) {
      expect(old.get(sku)?.allocatedFee).toBe(0);
      expect(fromLines.get(sku)?.allocatedFee).toBe(0);
      expect(fromLines.get(sku)?.cogs).toBe(10000);
      expect(fromLines.get(sku)?.quantitySold).toBe(1);
    }
  });

  it("Σ phí phân bổ các mã = Σ sàn khấu trừ của các đơn có dòng hàng mang giá", () => {
    const sumFee = [...fromLines.values()].reduce((s, a) => s + a.allocatedFee, 0);
    const expected = LEDGER_ROWS
      .filter((r) => r.shippingStatus === ShippingStatus.DELIVERED && r.orderId !== "gift")
      .reduce((s, r) => s + r.platformDeduction, 0);
    expect(sumFee).toBeCloseTo(expected, 2);
  });
});
