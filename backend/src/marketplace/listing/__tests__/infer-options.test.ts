// Suy nhóm phân loại từ tên phân loại của bảng (nguồn kho / gian giả lập).
import { describe, expect, it } from "vitest";
import { inferOptions } from "../infer-options";

describe("inferOptions", () => {
  it("tên phân loại 'Màu: Đen, Size: M' → 2 nhóm có tên", () => {
    const opts = inferOptions([
      { sku: "a", name: "Màu: Đen, Size: M", price: 1, stock: 0, imageUrl: null },
      { sku: "b", name: "Màu: Trắng, Size: L", price: 1, stock: 0, imageUrl: null },
    ]);
    expect(opts).toEqual([
      { name: "Màu", values: ["Đen", "Trắng"] },
      { name: "Size", values: ["M", "L"] },
    ]);
  });
  it("'Đen,M' không có tên nhóm → Phân loại 1/2; sản phẩm đơn → rỗng", () => {
    const opts = inferOptions([
      { sku: "a", name: "Đen,M", price: 1, stock: 0, imageUrl: null },
      { sku: "b", name: "Đen,L", price: 1, stock: 0, imageUrl: null },
    ]);
    expect(opts).toEqual([
      { name: "Phân loại 1", values: ["Đen"] },
      { name: "Phân loại 2", values: ["M", "L"] },
    ]);
    expect(inferOptions([{ sku: "a", name: null, price: 1, stock: 0, imageUrl: null }])).toEqual([]);
  });
});
