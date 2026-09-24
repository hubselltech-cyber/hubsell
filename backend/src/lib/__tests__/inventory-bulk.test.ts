import { describe, expect, it } from "vitest";
import { BULK_MAX_ITEMS, findInsufficient, normalizeBulkItems } from "../inventory-bulk";

describe("normalizeBulkItems", () => {
  it("từ chối phiếu rỗng", () => {
    expect(normalizeBulkItems([])).toEqual({ ok: false, error: "Phiếu chưa có dòng nào" });
    expect(normalizeBulkItems(undefined).ok).toBe(false);
  });

  it("gộp mã quét hai lần thành một dòng cộng dồn", () => {
    const r = normalizeBulkItems([
      { productId: "a", quantity: 2 },
      { productId: "b", quantity: "3" },
      { productId: "a", quantity: 5 },
    ]);
    expect(r).toEqual({
      ok: true,
      items: [
        { productId: "a", quantity: 7 },
        { productId: "b", quantity: 3 },
      ],
    });
  });

  it("báo đúng dòng lỗi", () => {
    expect(normalizeBulkItems([{ productId: "a", quantity: 1 }, { productId: "", quantity: 1 }])).toEqual({
      ok: false,
      error: "Dòng 2: thiếu mã sản phẩm",
    });
    expect(normalizeBulkItems([{ productId: "a", quantity: 0 }])).toEqual({
      ok: false,
      error: "Dòng 1: số lượng phải là số nguyên dương",
    });
    expect(normalizeBulkItems([{ productId: "a", quantity: 1.5 }]).ok).toBe(false);
  });

  it("chặn quá trần mã", () => {
    const many = Array.from({ length: BULK_MAX_ITEMS + 1 }, (_, i) => ({
      productId: `p${i}`,
      quantity: 1,
    }));
    const r = normalizeBulkItems(many);
    expect(r.ok).toBe(false);
  });
});

describe("findInsufficient", () => {
  it("liệt kê đích danh mã thiếu hàng", () => {
    const stock = new Map([
      ["a", { skuCode: "A1", quantityInStock: 2 }],
      ["b", { skuCode: "B1", quantityInStock: 10 }],
    ]);
    expect(
      findInsufficient(
        [
          { productId: "a", quantity: 3 },
          { productId: "b", quantity: 10 },
        ],
        stock
      )
    ).toEqual([{ skuCode: "A1", quantityInStock: 2, wanted: 3 }]);
  });
});
