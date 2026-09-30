// ============================================================
// SỔ CÁI ĐƠN — dựng dòng sổ từ đơn (lib/order-ledger.ts). Logic THUẦN, không DB.
// Khóa các bất biến: Σ dòng hàng = đơn từng xu; cờ nhóm đúng định nghĩa tài
// chính; nhóm SQL và nhóm TS cùng kết quả; đối soát bắt được cột lệch.
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
  allocateByWeight,
  buildLedgerRows,
  diffLedgerRows,
  LEDGER_FORMULA_VERSION,
  LEDGER_GROUP_KEYS,
  LEDGER_GROUPS,
  ORDER_LEDGER_MONEY_COLUMNS,
  round2,
  summarizeLedgerRowsInMemory,
  type LedgerOrder,
} from "../order-ledger";
import { computePnlRow } from "../pnl-formula";

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

describe("allocateByWeight — phân bổ theo tỷ trọng, Σ = tổng từng xu", () => {
  it("phần dư làm tròn dồn về phần tử lớn nhất", () => {
    const parts = allocateByWeight(100, [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(100);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });
  it("trọng số toàn 0 → chia đều; tổng âm vẫn khớp", () => {
    expect(allocateByWeight(-10, [0, 0])).toEqual([-5, -5]);
    const parts = allocateByWeight(-100, [3, 0, 1]);
    expect(round2(parts.reduce((s, p) => s + p, 0))).toBe(-100);
    expect(parts[1]).toBe(0);
  });
  it("mảng rỗng → rỗng; một phần tử nhận trọn", () => {
    expect(allocateByWeight(5, [])).toEqual([]);
    expect(allocateByWeight(5.555, [7])).toEqual([5.56]);
  });
});

describe("buildLedgerRows — dòng sổ đơn khớp computePnlRow, dòng hàng cộng về đơn", () => {
  it("số cấp đơn = computePnlRow (làm tròn 2 số lẻ), cờ nhóm đúng định nghĩa", () => {
    const o = mkOrder();
    const { order, lines, pnl } = buildLedgerRows(o);
    const r = computePnlRow(o);
    expect(pnl).toEqual(r);
    const rr = r as unknown as Record<string, number>;
    for (const c of ORDER_LEDGER_MONEY_COLUMNS) {
      if (c === "platformDeduction" || c.startsWith("returnLoss")) continue;
      expect(order[c], c).toBe(round2(rr[c]));
    }
    expect(order.platformDeduction).toBe(round2(r.revenueGross - r.platformRevenue));
    expect(order.revenueGross).toBe(369000);
    expect(order.platformRevenue).toBe(300000);
    expect(order.costSnapshot).toBe(171000);
    expect(order.profitAfterTax).toBe(129000);
    expect(order.countsAsRevenue).toBe(true);
    expect(order.isReturning).toBe(false);
    expect(order.isLoss).toBe(false);
    expect(order.missingCostPrice).toBe(false);
    expect(order.returnType).toBeNull();
    expect(order.ownerId).toBe("u1");
    expect(order.formulaVersion).toBe(LEDGER_FORMULA_VERSION);
    // Khóa ngày theo GIỜ VN: 17:30Z ngày 10 = 00:30 ngày 11.
    expect(order.createdDate).toBe("2026-09-11");
    expect(order.deliveredDate).toBe("2026-09-15");
    expect(order.settledDate).toBe("2026-09-20");
    expect(order.itemCount).toBe(2);
    expect(order.totalQuantity).toBe(2);
    expect(lines).toHaveLength(2);
  });

  it("Σ dòng hàng = đơn từng xu cho mọi cột phân bổ; tỷ trọng theo giá trị dòng", () => {
    const { order, lines } = buildLedgerRows(mkOrder());
    const sum = (k: keyof (typeof lines)[number]) => round2(lines.reduce((s, l) => s + Number(l[k]), 0));
    expect(sum("revenueGross")).toBe(order.revenueGross);
    expect(sum("actualRevenue")).toBe(order.actualRevenue);
    expect(sum("platformRevenue")).toBe(order.platformRevenue);
    expect(sum("platformDeduction")).toBe(order.platformDeduction);
    expect(sum("refundedAmount")).toBe(order.refundedAmount);
    expect(sum("profit")).toBe(order.profit);
    expect(sum("profitAfterTax")).toBe(order.profitAfterTax);
    expect(sum("costSnapshot")).toBe(order.costSnapshot);
    expect(sum("recoveredCost")).toBe(order.recoveredCost);
    expect(sum("share")).toBe(1);
    // Dòng 269k chiếm 269/369 của mọi khoản; cùng cách /sku-pnl phân bổ phí.
    expect(lines[0].share).toBeCloseTo(269000 / 369000, 9);
    expect(lines[0].platformDeduction).toBe(round2((69000 * 269000) / 369000));
    expect(lines[0].lineGross).toBe(269000);
    expect(lines[0].lineCost).toBe(131000);
    expect(lines[0].channelSku).toBe("TC025");
  });

  it("dòng giá 0 toàn bộ (quà tặng) → chia đều, không rơi tiền", () => {
    const { order, lines } = buildLedgerRows(
      mkOrder({
        totalAmount: D(0),
        actualPayout: D(-5000), // sàn vẫn trừ phí
        items: [{ id: "a", price: D(0) }, { id: "b", price: D(0) }],
      })
    );
    expect(order.platformRevenue).toBe(-5000);
    expect(lines.map((l) => l.platformRevenue)).toEqual([-2500, -2500]);
    expect(lines.map((l) => l.share)).toEqual([0.5, 0.5]);
  });

  it("trả MỘT dòng đã nhập kho: vốn dòng đó thu hồi, dòng kia giữ nguyên; Σ vẫn khớp đơn", () => {
    const o = mkOrder({
      returnStatus: ReturnStatus.RECEIVED_INTACT,
      returnSolution: ReturnSolution.RETURN_REFUND,
      returnDeliveredAt: new Date(),
      refundedAmount: D(100000),
      actualPayout: D(200000),
      items: [
        { id: "i1", channelSku: "TC025", price: D(269000), costPriceAtSale: D(131000) },
        { id: "i2", channelSku: "TC026", price: D(100000), costPriceAtSale: D(40000), returnedQuantity: 1, returnRestocked: true },
      ],
    });
    const { order, lines } = buildLedgerRows(o);
    expect(order.returnType).toBe("PARTIAL_RETURN");
    expect(order.costSnapshot).toBe(131000);
    expect(order.recoveredCost).toBe(40000);
    expect(lines[0].costSnapshot).toBe(131000);
    expect(lines[0].recoveredQuantity).toBe(0);
    expect(lines[1].costSnapshot).toBe(0);
    expect(lines[1].recoveredCost).toBe(40000);
    expect(lines[1].recoveredQuantity).toBe(1);
    // Đơn hoàn ĐÃ XONG (nhập kho) quay lại doanh thu, không còn "đang hoàn".
    expect(order.isReturning).toBe(false);
    expect(order.countsAsRevenue).toBe(true);
    expect(order.returnLossRefund).toBe(0);
  });

  it("đơn hủy → doanh thu sàn kẹp 0, không tính doanh thu, không phải đang hoàn", () => {
    const { order } = buildLedgerRows(
      mkOrder({ shippingStatus: ShippingStatus.CANCELLED, isSettled: false, actualPayout: D(0) })
    );
    expect(order.countsAsRevenue).toBe(false);
    expect(order.isReturning).toBe(false);
    expect(order.platformRevenue).toBe(0);
    expect(order.returnType).toBeNull();
    // Vốn thu hồi (hàng chưa đi) → lãi 0, không phải lỗ.
    expect(order.costSnapshot).toBe(0);
    expect(order.isLoss).toBe(false);
  });

  it("đơn ĐANG hoàn (AWAITING) → isReturning, không tính doanh thu; lỗ khi lãi < 0", () => {
    const { order } = buildLedgerRows(
      mkOrder({
        returnStatus: ReturnStatus.AWAITING,
        returnSolution: ReturnSolution.RETURN_REFUND,
        isSettled: false,
        actualPayout: D(0),
        platformRefundAmount: D(369000),
      })
    );
    expect(order.isReturning).toBe(true);
    expect(order.countsAsRevenue).toBe(false);
    expect(order.returnType).toBe("FULL_RETURN");
    expect(order.platformRevenue).toBe(0);
    expect(order.profitAfterTax).toBe(-171000); // vốn chưa thu hồi (hàng chưa về)
    expect(order.isLoss).toBe(true);
    expect(order.returnLossCost).toBe(171000);
  });

  it("thiếu giá vốn → cờ missingCostPrice (báo cáo loại khỏi lợi nhuận, giữ doanh thu)", () => {
    const { order } = buildLedgerRows(
      mkOrder({ items: [{ id: "i1", price: D(369000), costPriceAtSale: D(0) }] })
    );
    expect(order.missingCostPrice).toBe(true);
    expect(order.revenueGross).toBe(369000);
  });
});

describe("LEDGER_GROUPS — cùng một định nghĩa cho SQL và TS", () => {
  const rows = [
    buildLedgerRows(mkOrder({ id: "a" })).order, // active + settled + delivered
    buildLedgerRows(mkOrder({ id: "b", isSettled: false, actualPayout: D(0) })).order, // active + pending + delivered
    buildLedgerRows(mkOrder({ id: "c", shippingStatus: ShippingStatus.CANCELLED, actualPayout: D(0) })).order,
    buildLedgerRows(
      mkOrder({ id: "d", returnStatus: ReturnStatus.AWAITING, returnSolution: ReturnSolution.RETURN_REFUND, isSettled: false, actualPayout: D(0), platformRefundAmount: D(369000) })
    ).order,
  ];

  it("Tất cả = tính doanh thu + hủy + đang hoàn (ba nhóm loại trừ nhau)", () => {
    const s = summarizeLedgerRowsInMemory(rows);
    expect(s.all.count).toBe(4);
    expect(s.active.count + s.cancelled.count + s.returning.count).toBe(s.all.count);
    expect(s.active.count).toBe(2);
    expect(s.settled.count + s.pending.count).toBe(s.active.count);
    expect(s.delivered.count).toBe(2);
    expect(s.returning.count).toBe(1);
    expect(s.cancelled.count).toBe(1);
    expect(s.all.lossCount).toBe(1);
    expect(s.all.returnCount).toBe(1);
    expect(s.active.revenueGross).toBe(738000);
    expect(s.settled.profitAfterTax).toBe(129000);
    expect(s.all.totalQuantity).toBe(8);
  });

  it("điều kiện SQL của từng nhóm chỉ dùng cột đã ghi trong sổ", () => {
    const allowed = ["countsAsRevenue", "isReturning", "isSettled", "shippingStatus"];
    for (const g of LEDGER_GROUP_KEYS) {
      const cols = [...LEDGER_GROUPS[g].sql.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
      for (const c of cols) expect(allowed, `${g}: ${c}`).toContain(c);
    }
  });
});

describe("diffLedgerRows — đối soát bắt đúng cột lệch", () => {
  it("giống nhau → rỗng; lệch 1 đồng ở một cột → báo cột đó", () => {
    const fresh = buildLedgerRows(mkOrder()).order;
    expect(diffLedgerRows({ ...fresh }, fresh)).toEqual([]);
    const stored = { ...fresh, profitAfterTax: new Prisma.Decimal(fresh.profitAfterTax + 1) };
    const d = diffLedgerRows(stored, fresh);
    expect(d).toHaveLength(1);
    expect(d[0].column).toBe("profitAfterTax");
  });
  it("cờ đổi (countsAsRevenue) cũng là lệch", () => {
    const fresh = buildLedgerRows(mkOrder()).order;
    const d = diffLedgerRows({ ...fresh, countsAsRevenue: false }, fresh);
    expect(d.map((x) => x.column)).toEqual(["countsAsRevenue"]);
  });
});
