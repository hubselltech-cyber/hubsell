// Chữa bản chụp nguồn thiếu nhóm phân loại (docs/SAO-CHEP-SAN-PHAM.md mục 35, 22/11/2026).
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma", () => ({ prisma: {} }));

import type { NormalizedListing } from "../../../marketplace/listing/types";
import { mergeFreshOptions, needsOptionRepair } from "../repair-options";

const base: NormalizedListing = {
  title: "Balo nam",
  description: "",
  images: ["https://img/bia.jpg"],
  descriptionImages: [],
  categoryId: null,
  categoryPath: null,
  brandName: null,
  weightGrams: 1000,
  dimensionsCm: null,
  options: [],
  variants: [],
  attributes: [],
};

// Đúng bản chụp thật trên prod (job BL007, 19/11/2026): 2 phân loại có tên, options rỗng.
const broken: NormalizedListing = {
  ...base,
  variants: [
    { sku: "BL007-XAM", name: "Xám", price: 600000, stock: 0, imageUrl: null },
    { sku: "BL007-DEN", name: "Đen", price: 600000, stock: 0, imageUrl: null },
  ],
};

const fresh: NormalizedListing = {
  ...base,
  options: [{ name: "Màu sắc", values: ["Xám", "Đen"] }],
  variants: [
    { sku: "BL007-XAM", name: "Xám", price: 650000, stock: 9, imageUrl: "https://img/xam.jpg", optionValues: { "Màu sắc": "Xám" } },
    { sku: "BL007-DEN", name: "Đen", price: 650000, stock: 9, imageUrl: "https://img/den.jpg", optionValues: { "Màu sắc": "Đen" } },
  ],
};

describe("needsOptionRepair", () => {
  it("nhiều phân loại có tên mà không có nhóm → cần chữa", () => {
    expect(needsOptionRepair(broken)).toBe(true);
  });
  it("sản phẩm đơn / đã có nhóm / phân loại không tên → không đụng", () => {
    expect(needsOptionRepair({ options: [], variants: [broken.variants[0]] })).toBe(false);
    expect(needsOptionRepair(fresh)).toBe(false);
    expect(needsOptionRepair({ options: [], variants: broken.variants.map((v) => ({ ...v, name: null })) })).toBe(false);
  });
});

describe("mergeFreshOptions", () => {
  it("thêm nhóm + giá trị chính xác + ảnh phân loại, GIỮ giá / tồn / mã / bỏ phân loại khách đã sửa", () => {
    const edited: NormalizedListing = {
      ...broken,
      variants: [
        { ...broken.variants[0], sku: "MA-KHACH-SUA", price: 590000 },
        { ...broken.variants[1], excluded: true },
      ],
    };
    const out = mergeFreshOptions(edited, fresh)!;
    expect(out.options).toEqual([{ name: "Màu sắc", values: ["Xám", "Đen"] }]);
    expect(out.variants[0]).toMatchObject({ sku: "MA-KHACH-SUA", price: 590000, stock: 0, imageUrl: "https://img/xam.jpg", optionValues: { "Màu sắc": "Xám" } });
    expect(out.variants[1]).toMatchObject({ excluded: true, optionValues: { "Màu sắc": "Đen" } });
  });
  it("nguồn đổi thứ tự phân loại → khớp theo tên", () => {
    const out = mergeFreshOptions(broken, { ...fresh, variants: [fresh.variants[1], fresh.variants[0]] })!;
    expect(out.variants.map((v) => v.optionValues)).toEqual([{ "Màu sắc": "Xám" }, { "Màu sắc": "Đen" }]);
  });
  it("nguồn không còn nhóm, hoặc có phân loại không khớp được → null (nơi gọi suy từ tên)", () => {
    expect(mergeFreshOptions(broken, { ...fresh, options: [] })).toBeNull();
    expect(mergeFreshOptions(broken, { ...fresh, variants: [fresh.variants[0]] })).toBeNull();
  });
  it("giữ trường ngoài hợp đồng của bản chụp (meta nguồn Tạo mới)", () => {
    const out = mergeFreshOptions({ ...broken, manual: { costPrice: 1 } }, fresh)!;
    expect(out.manual).toEqual({ costPrice: 1 });
  });
});
