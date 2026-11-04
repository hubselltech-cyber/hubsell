import { describe, expect, it } from "vitest";

import { summarizePickLines, type PickLineGroup } from "../pick-summary";

const line = (over: Partial<PickLineGroup>): PickLineGroup => ({
  channelSku: "SKU-A",
  productName: "Sản phẩm A",
  qty: 1,
  expressQty: 0,
  imageUrl: null,
  ...over,
});

describe("summarizePickLines", () => {
  it("không có dòng nào thì mọi tổng bằng 0 và danh sách rỗng", () => {
    expect(summarizePickLines([])).toEqual({
      totals: { qty: 0, expressQty: 0, skuCount: 0, productCount: 0 },
      bySku: [],
      byProduct: [],
    });
  });

  it("cùng SKU ở hai gian đặt tên khác nhau cộng thành một dòng SKU, hai dòng sản phẩm", () => {
    const r = summarizePickLines([
      line({ channelSku: "TUI-DEN", productName: "Túi đen (Shopee)", qty: 2 }),
      line({ channelSku: "TUI-DEN", productName: "Túi đen (TikTok)", qty: 3 }),
    ]);
    expect(r.bySku).toHaveLength(1);
    expect(r.bySku[0]).toMatchObject({ sku: "TUI-DEN", qty: 5 });
    expect(r.byProduct.map((p) => p.qty)).toEqual([3, 2]);
    expect(r.totals).toMatchObject({ qty: 5, skuCount: 1, productCount: 2 });
  });

  it("một sản phẩm nhiều SKU: dòng sản phẩm đếm số SKU và không gắn mã đại diện", () => {
    const r = summarizePickLines([
      line({ channelSku: "AO-M", productName: "Áo", qty: 2 }),
      line({ channelSku: "AO-L", productName: "Áo", qty: 4 }),
    ]);
    expect(r.byProduct).toEqual([
      expect.objectContaining({ name: "Áo", qty: 6, skuCount: 2, sku: null }),
    ]);
    expect(r.bySku.map((s) => s.sku)).toEqual(["AO-L", "AO-M"]);
  });

  it("sản phẩm một SKU: dòng sản phẩm hiện đúng mã đó", () => {
    const r = summarizePickLines([line({ channelSku: "MU-01", productName: "Mũ", qty: 1 })]);
    expect(r.byProduct[0]).toMatchObject({ sku: "MU-01", skuCount: 1 });
  });

  it("dòng không có SKU tách theo tên, không dồn hàng khác nhau làm một", () => {
    const r = summarizePickLines([
      line({ channelSku: "", productName: "Khăn", qty: 1 }),
      line({ channelSku: "  ", productName: "Găng tay", qty: 2 }),
    ]);
    expect(r.bySku.map((s) => [s.name, s.sku, s.qty])).toEqual([
      ["Găng tay", null, 2],
      ["Khăn", null, 1],
    ]);
    expect(r.totals.skuCount).toBe(2);
  });

  it("SKU thật trùng chữ với tên của dòng không SKU vẫn là hai dòng", () => {
    const r = summarizePickLines([
      line({ channelSku: "Khăn", productName: "Khăn đỏ", qty: 1 }),
      line({ channelSku: "", productName: "Khăn", qty: 1 }),
    ]);
    expect(r.bySku).toHaveLength(2);
  });

  it("hỏa tốc lên đầu dù số lượng ít hơn, cùng hỏa tốc thì số lượng lớn trước", () => {
    const r = summarizePickLines([
      line({ channelSku: "NHIEU", productName: "Nhiều", qty: 50 }),
      line({ channelSku: "HT-1", productName: "Hỏa tốc 1", qty: 2, expressQty: 1 }),
      line({ channelSku: "HT-2", productName: "Hỏa tốc 2", qty: 3, expressQty: 1 }),
    ]);
    expect(r.bySku.map((s) => s.sku)).toEqual(["HT-2", "HT-1", "NHIEU"]);
    expect(r.totals.expressQty).toBe(2);
  });

  it("không cắt danh sách dù có rất nhiều SKU", () => {
    const groups = Array.from({ length: 300 }, (_, i) =>
      line({ channelSku: `SKU-${i}`, productName: `SP ${i}` })
    );
    const r = summarizePickLines(groups);
    expect(r.bySku).toHaveLength(300);
    expect(r.byProduct).toHaveLength(300);
  });

  it("lấy ảnh đầu tiên có được trong nhóm", () => {
    const r = summarizePickLines([
      line({ productName: "Áo", channelSku: "AO-1", imageUrl: null }),
      line({ productName: "Áo", channelSku: "AO-2", imageUrl: "https://anh/ao.jpg" }),
    ]);
    expect(r.byProduct[0].imageUrl).toBe("https://anh/ao.jpg");
  });
});
