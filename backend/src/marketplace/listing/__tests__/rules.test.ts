// Luật đăng sản phẩm theo sàn — phần thuần (docs/SAO-CHEP-SAN-PHAM.md).
import { describe, expect, it } from "vitest";
import { inferOptions } from "../../../services/listing-copy/source";
import { adjustPrice, computeMissing, dimsComplete, normalizeDims, PLATFORM_LISTING_RULES } from "../rules";
import type { CategoryRequirements, NormalizedListing } from "../types";

const base: NormalizedListing = {
  title: "Chân váy chữ A dáng dài vải tuyết mưa",
  description: "Mô tả đủ dài để qua ngưỡng tối thiểu hai mươi ký tự.",
  images: ["https://img/1.jpg"],
  descriptionImages: [],
  categoryId: null,
  categoryPath: null,
  brandName: null,
  weightGrams: null,
  dimensionsCm: null,
  options: [{ name: "Size", values: ["M", "L"] }],
  variants: [
    { sku: "CV-M", name: "M", price: 150000, stock: 5, imageUrl: null },
    { sku: "CV-L", name: "L", price: 150000, stock: 3, imageUrl: null },
  ],
  attributes: [],
};

const state = { categoryId: "SP-1000", attributes: {}, brandId: null, logisticIds: ["spx"], weightGrams: 300, dimensionsCm: null };

describe("computeMissing", () => {
  it("Shopee đủ điều kiện khi có danh mục, cân nặng, vận chuyển", () => {
    expect(computeMissing("SHOPEE", base, state, null)).toEqual([]);
  });

  it("Lazada đòi thương hiệu + kích thước; TikTok đòi tên ≥ 25 ký tự", () => {
    expect(computeMissing("LAZADA", base, state, null)).toEqual(["brand", "dimensions"]);
    expect(computeMissing("TIKTOK", { ...base, title: "Chân váy ngắn" }, state, null)).toEqual(["title_short"]);
  });

  it("thuộc tính bắt buộc của danh mục + SKU đã có trên gian đích", () => {
    const req: CategoryRequirements = {
      ...PLATFORM_LISTING_RULES.SHOPEE,
      attributes: [
        { id: "material", name: "Chất liệu", required: true, type: "select", options: ["Cotton"] },
        { id: "style", name: "Kiểu", required: false, type: "text" },
      ],
    };
    expect(computeMissing("SHOPEE", base, { ...state, existingSkus: ["CV-M"] }, req)).toEqual(["sku_exists", "attr:material"]);
    expect(computeMissing("SHOPEE", base, { ...state, attributes: { material: "Cotton" } }, req)).toEqual([]);
  });

  it("chưa có danh mục, không ảnh, giá 0 → báo đủ các mã", () => {
    const listing = { ...base, images: [], variants: [{ ...base.variants[0], price: 0 }] };
    const m = computeMissing("SHOPEE", listing, { ...state, categoryId: null, logisticIds: [] }, null);
    expect(m).toEqual(["category", "images", "price", "logistics"]);
  });

  it("Shopee không bắt kích thước, nhưng điền dở 1–2 số thì báo thiếu (sàn từ chối số 0)", () => {
    expect(computeMissing("SHOPEE", base, { ...state, dimensionsCm: { length: 20, width: 0, height: 0 } }, null)).toEqual(["dimensions"]);
    expect(computeMissing("SHOPEE", base, { ...state, dimensionsCm: { length: 0, width: 0, height: 0 } }, null)).toEqual([]);
    expect(computeMissing("SHOPEE", base, { ...state, dimensionsCm: { length: 20, width: 10, height: 5 } }, null)).toEqual([]);
  });
});

describe("normalizeDims / dimsComplete", () => {
  it("TikTok trả chuỗi \"0\" hoặc bảng {0,0,0} → null; chuỗi số → số; điền dở giữ lại", () => {
    expect(normalizeDims({ length: "0", width: "0", height: "0" })).toBeNull();
    expect(normalizeDims({ length: 0, width: 0, height: 0 })).toBeNull();
    expect(normalizeDims(null)).toBeNull();
    expect(normalizeDims("abc")).toBeNull();
    expect(normalizeDims({ length: "20", width: "10.5", height: 5 })).toEqual({ length: 20, width: 10.5, height: 5 });
    expect(normalizeDims({ length: 20 })).toEqual({ length: 20, width: 0, height: 0 });
    expect(normalizeDims({ length: -3, width: "x", height: 2 })).toEqual({ length: 0, width: 0, height: 2 });
  });
  it("dimsComplete chỉ đúng khi đủ 3 số > 0", () => {
    expect(dimsComplete({ length: 20, width: 10, height: 5 })).toBe(true);
    expect(dimsComplete({ length: 20, width: 0, height: 5 })).toBe(false);
    expect(dimsComplete(null)).toBe(false);
  });
});

describe("adjustPrice", () => {
  it("làm tròn tới 100 đồng, không âm", () => {
    expect(adjustPrice(150000, 10)).toBe(165000);
    expect(adjustPrice(99990, -5)).toBe(95000);
    expect(adjustPrice(1000, -100)).toBe(0);
  });
});

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
