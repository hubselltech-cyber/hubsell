import { describe, expect, it } from "vitest";

import {
  createShipDiffProductFold,
  shipDiffAvgPerOrder,
  shipDiffOrderRate,
  shipDiffProductKey,
  sortShipDiffProducts,
  type ShipDiffLine,
  type ShipDiffOrder,
} from "../shipping-diff-products";

const line = (over: Partial<ShipDiffLine> = {}): ShipDiffLine => ({
  externalId: "1001-1",
  channelSku: "SUA-UHT",
  productName: "Thùng sữa UHT",
  quantity: 1,
  price: 400_000,
  ...over,
});

const order = (over: Partial<ShipDiffOrder> = {}): ShipDiffOrder => ({
  channelId: "ch1",
  createdAt: new Date("2026-10-15T03:00:00Z"),
  diff: 65_000,
  reason: "LOGISTICS_SURCHARGE",
  cancelled: false,
  lines: [line()],
  ...over,
});

const all = () => true;

describe("shipDiffProductKey", () => {
  it("gom theo id sản phẩm sàn (phần trước dấu gạch), phân loại khác nhau về cùng một nhóm", () => {
    const a = shipDiffProductKey("ch1", { externalId: "1001-1", channelSku: "A" });
    const b = shipDiffProductKey("ch1", { externalId: "1001-2", channelSku: "B" });
    expect(a.key).toBe(b.key);
    expect(a.itemId).toBe("1001");
  });

  it("dòng chưa có id sàn gom theo mã SKU; khác gian là khác nhóm", () => {
    const a = shipDiffProductKey("ch1", { externalId: null, channelSku: "A" });
    expect(a.itemId).toBeNull();
    expect(a.key).not.toBe(shipDiffProductKey("ch1", { externalId: null, channelSku: "B" }).key);
    expect(a.key).not.toBe(shipDiffProductKey("ch2", { externalId: null, channelSku: "A" }).key);
    expect(a.key).not.toBe(shipDiffProductKey("ch1", { externalId: "A", channelSku: "A" }).key);
  });
});

describe("createShipDiffProductFold", () => {
  it("chia tiền đơn nhiều sản phẩm theo giá trị dòng, quà tặng 0 đ không gánh, Σ dòng = Σ đơn", () => {
    const fold = createShipDiffProductFold(all);
    fold.add(
      order({
        diff: 100_000,
        lines: [
          line({ externalId: "1001-1", price: 300_000 }),
          line({ externalId: "2002-1", channelSku: "BOT", productName: "Sữa bột lon", price: 100_000 }),
          line({ externalId: "3003-1", channelSku: "QUA", productName: "Quà tặng", price: 0, quantity: 3 }),
        ],
      })
    );
    const r = fold.result();
    const by = new Map(r.groups.map((g) => [g.itemId, g]));
    expect(by.get("1001")?.amount).toBe(75_000);
    expect(by.get("2002")?.amount).toBe(25_000);
    expect(by.has("3003")).toBe(false); // quà 0 đ không gánh → không thành dòng
    expect(r.groups).toHaveLength(2);
    expect(r.groups.every((g) => g.orders === 1)).toBe(true);
    expect(r.groups.reduce((s, g) => s + g.amount, 0)).toBe(r.totalAmount);
    expect(r.orders).toBe(1);
  });

  it("hai dòng cùng sản phẩm trong một đơn chỉ tính một đơn cho sản phẩm đó", () => {
    const fold = createShipDiffProductFold(all);
    fold.add(order({ lines: [line({ externalId: "1001-1" }), line({ externalId: "1001-2" })] }));
    const [g] = fold.result().groups;
    expect(g.orders).toBe(1);
    expect(g.amount).toBe(65_000);
  });

  it("số lẻ không trôi: 3 sản phẩm bằng giá chia 100.000,01 đ vẫn cộng lại đúng từng xu", () => {
    const fold = createShipDiffProductFold(all);
    for (let i = 0; i < 7; i++) {
      fold.add(
        order({
          diff: 100_000.01,
          lines: ["1", "2", "3"].map((id) => line({ externalId: `${id}-1`, price: 10_000 })),
        })
      );
    }
    const r = fold.result();
    expect(r.totalAmount).toBe(700_000.07);
    expect(Math.round(r.groups.reduce((s, g) => s + g.amount, 0) * 100)).toBe(70_000_007);
  });

  it("mỗi phần chia là số đồng chẵn: 65.000 đ chia theo 720.000 / 585.000 → 35.862 + 29.138", () => {
    const fold = createShipDiffProductFold(all);
    fold.add(
      order({
        diff: 65_000,
        lines: [line({ externalId: "1001-1", price: 720_000 }), line({ externalId: "2002-1", price: 585_000 })],
      })
    );
    const by = new Map(fold.result().groups.map((g) => [g.itemId, g.amount]));
    expect(by.get("1001")).toBe(35_862);
    expect(by.get("2002")).toBe(29_138);
  });

  it("đơn không có dòng hàng vào dòng 'chưa rõ sản phẩm' của gian đó", () => {
    const fold = createShipDiffProductFold(all);
    fold.add(order({ lines: [], diff: 30_000 }));
    fold.add(order({ lines: [], diff: 20_000, channelId: "ch2" }));
    const r = fold.result();
    expect(r.groups).toHaveLength(2);
    expect(r.groups.every((g) => g.unattributed && g.sku === null && g.itemId === null)).toBe(true);
    expect(r.totalAmount).toBe(50_000);
  });

  it("nguyên nhân chính = nguyên nhân nhiều tiền nhất; tên + mã lấy ở đơn mới nhất", () => {
    const fold = createShipDiffProductFold(all);
    fold.add(order({ diff: 27_000, createdAt: new Date("2026-10-20T00:00:00Z"), lines: [line({ productName: "Tên mới", channelSku: "MOI" })] }));
    fold.add(order({ diff: 27_000, createdAt: new Date("2026-10-01T00:00:00Z"), lines: [line({ productName: "Tên cũ", channelSku: "CU" })] }));
    fold.add(order({ diff: 108_500, reason: "CUSTOMER_RETURN" }));
    fold.add(order({ diff: 40_000, reason: "CANCELLED_AFTER_SHIP", cancelled: true }));
    const [g] = fold.result().groups;
    expect(g.productName).toBe("Tên mới");
    expect(g.sku).toBe("MOI");
    expect(g.orders).toBe(4);
    expect(g.cancelledOrders).toBe(1);
    expect(g.reasons.map((x) => [x.reason, x.orders, x.amount])).toEqual([
      ["CUSTOMER_RETURN", 1, 108_500],
      ["LOGISTICS_SURCHARGE", 2, 54_000],
      ["CANCELLED_AFTER_SHIP", 1, 40_000],
    ]);
  });

  it("bộ lọc nguyên nhân: nhóm chỉ gồm đơn khớp, còn tổng theo nguyên nhân vẫn đủ mọi đơn", () => {
    const fold = createShipDiffProductFold((r) => r === "CUSTOMER_RETURN");
    fold.add(order({ diff: 27_000 }));
    fold.add(order({ diff: 108_500, reason: "CUSTOMER_RETURN", lines: [line({ externalId: "2002-1" })] }));
    const r = fold.result();
    expect(r.groups.map((g) => g.itemId)).toEqual(["2002"]);
    expect(r.totalAmount).toBe(108_500);
    expect(r.orders).toBe(1);
    expect(r.reasonTotals).toEqual([
      { reason: "CUSTOMER_RETURN", orders: 1, amount: 108_500 },
      { reason: "LOGISTICS_SURCHARGE", orders: 1, amount: 27_000 },
    ]);
  });
});

describe("sắp xếp + tỷ lệ", () => {
  const groups = () => {
    const fold = createShipDiffProductFold(all);
    fold.add(order({ diff: 90_000, lines: [line({ externalId: "A-1" })] }));
    fold.add(order({ diff: 30_000, lines: [line({ externalId: "B-1" })] }));
    fold.add(order({ diff: 30_000, lines: [line({ externalId: "B-1" })] }));
    fold.add(order({ diff: 30_000, lines: [line({ externalId: "B-1" })] }));
    fold.add(order({ diff: 10_000, lines: [line({ externalId: "C-1" })] }));
    return fold.result().groups;
  };

  it("theo tiền / số đơn / trung bình mỗi đơn, hai chiều; hòa thì tiền nhiều trước", () => {
    const ids = (sort: "amount" | "orders" | "avg", dir: "asc" | "desc") =>
      sortShipDiffProducts(groups(), sort, dir).map((g) => g.itemId);
    expect(ids("amount", "desc")).toEqual(["A", "B", "C"]); // A = B = 90.000 → theo khóa
    expect(ids("orders", "desc")).toEqual(["B", "A", "C"]);
    expect(ids("orders", "asc")).toEqual(["A", "C", "B"]); // A, C cùng 1 đơn → tiền nhiều trước
    expect(ids("avg", "desc")).toEqual(["A", "B", "C"]);
    expect(ids("avg", "asc")).toEqual(["C", "B", "A"]);
  });

  it("trung bình mỗi đơn làm tròn đồng", () => {
    expect(shipDiffAvgPerOrder({ amount: 100_000, orders: 3 })).toBe(33_333);
    expect(shipDiffAvgPerOrder({ amount: 0, orders: 0 })).toBe(0);
  });

  it("tỷ lệ = đơn lệch ÷ (đơn không hủy + đơn hủy có phát sinh cước); số thật khách 10/11: 231/1.146 ≈ 20,2 %", () => {
    expect(shipDiffOrderRate({ orders: 231, cancelledOrders: 0 }, 1146)).toEqual({ totalOrders: 1146, rate: 20.2 });
    expect(shipDiffOrderRate({ orders: 5, cancelledOrders: 2 }, 8)).toEqual({ totalOrders: 10, rate: 50 });
  });

  it("chưa đếm được hoặc sổ thiếu dòng (mẫu số < tử số) → không in tỷ lệ", () => {
    expect(shipDiffOrderRate({ orders: 5, cancelledOrders: 0 }, undefined)).toBeNull();
    expect(shipDiffOrderRate({ orders: 5, cancelledOrders: 0 }, 3)).toBeNull();
    expect(shipDiffOrderRate({ orders: 0, cancelledOrders: 0 }, 0)).toBeNull();
  });
});
