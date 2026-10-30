// Hàm thuần của Shopee listing-api (docs/SAO-CHEP-SAN-PHAM.md mục 15: gian nhiều kho).
import { describe, expect, it } from "vitest";
import { categoryPath, pickStockLocationId } from "../shopee/listing-api";

describe("pickStockLocationId", () => {
  it("gian một kho (không location_id) → null; kho lấy hàng có location_id → lấy; bỏ kho nhận hoàn (type 2)", () => {
    expect(pickStockLocationId([], "shop")).toBeNull();
    expect(pickStockLocationId([{ warehouse_id: 1, warehouse_name: "A" }], "shop")).toBeNull();
    expect(pickStockLocationId([{ warehouse_type: 2, location_id: "VNZ" }, { warehouse_type: 1, location_id: "VNA" }], "shop")).toBe("VNA");
  });
  it("nhiều kho lấy hàng → kho đầu danh sách", () => {
    expect(pickStockLocationId([{ warehouse_type: 1, location_id: "VNA" }, { warehouse_type: 1, location_id: "VNB" }], "shop")).toBe("VNA");
  });
});

describe("categoryPath", () => {
  it("đi ngược cha tới gốc, ưu tiên display_category_name", () => {
    const all = [
      { category_id: 1, display_category_name: "Thời trang" },
      { category_id: 2, parent_category_id: 1, original_category_name: "Áo" },
      { category_id: 3, parent_category_id: 2, display_category_name: "Áo thun" },
    ];
    expect(categoryPath(all, 3)).toEqual(["Thời trang", "Áo", "Áo thun"]);
    expect(categoryPath(all, 99)).toEqual([]);
  });
});
