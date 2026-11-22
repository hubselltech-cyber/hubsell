// Nhóm phân loại nguồn Shopee dựng từ get_model_list (docs/SAO-CHEP-SAN-PHAM.md mục 35, 22/11/2026).
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma", () => ({ prisma: {} }));

import { shopeeTierListing } from "../shopee-listing-adapter";

describe("shopeeTierListing", () => {
  const tiers = [
    {
      name: "Màu sắc",
      option_list: [{ option: "Đen/Trắng", image: { image_url: "https://img/den.jpg" } }, { option: "Kem", image: { image_url: "https://img/kem.jpg" } }],
    },
    { name: "Size", option_list: [{ option: "36/37" }, { option: "38/39" }] },
  ];

  it("2 nhóm: tên nhóm + giá trị chính xác theo tier_index, ảnh lấy ở tier đầu", () => {
    const r = shopeeTierListing(tiers, [{ tier_index: [0, 1] }, { tier_index: [1, 0] }]);
    expect(r.options).toEqual([
      { name: "Màu sắc", values: ["Đen/Trắng", "Kem"] },
      { name: "Size", values: ["36/37", "38/39"] },
    ]);
    expect(r.perModel).toEqual([
      { values: { "Màu sắc": "Đen/Trắng", Size: "38/39" }, imageUrl: "https://img/den.jpg" },
      { values: { "Màu sắc": "Kem", Size: "36/37" }, imageUrl: "https://img/kem.jpg" },
    ]);
  });
  it("tên nhóm trống → đặt Phân loại N (TikTok từ chối sales attribute không tên); tên trùng → thêm số", () => {
    const r = shopeeTierListing([{ name: " ", option_list: [{ option: "A" }] }, { name: "Phân loại 1", option_list: [{ option: "B" }] }], [{ tier_index: [0, 0] }]);
    expect(r.options.map((o) => o.name)).toEqual(["Phân loại 1", "Phân loại 1 2"]);
    expect(r.perModel[0].values).toEqual({ "Phân loại 1": "A", "Phân loại 1 2": "B" });
  });
  it("tier_index lệch số nhóm / trỏ ra ngoài → values null (adapter đích tách theo model_name)", () => {
    const r = shopeeTierListing(tiers, [{ tier_index: [0] }, { tier_index: [0, 9] }, {}]);
    expect(r.perModel.map((m) => m.values)).toEqual([null, null, null]);
    expect(r.perModel[2].imageUrl).toBeNull();
  });
  it("không có tier (sản phẩm đơn) → không nhóm", () => {
    expect(shopeeTierListing([], [])).toEqual({ options: [], perModel: [] });
  });
});
