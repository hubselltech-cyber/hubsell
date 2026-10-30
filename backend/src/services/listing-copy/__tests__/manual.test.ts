// Nguồn "Tạo mới" — parse form + thẻ Đạt chuẩn sàn (docs/SAO-CHEP-SAN-PHAM.md mục 24). Thuần, không chạm DB.
import { describe, expect, it } from "vitest";
import { checkManualDraft, parseManualListing, SKU_PATTERN } from "../manual";

const good = {
  title: "Túi đeo chéo nam ANO da PU cao cấp, khóa chống nước TC113",
  description: "Mô tả đủ dài để qua ngưỡng tối thiểu hai mươi ký tự của mọi sàn.",
  images: ["https://img/1.jpg", "https://img/1.jpg", "https://img/2.jpg"],
  descriptionImages: [],
  weightGrams: "600",
  dimensionsCm: { length: 20, width: 14, height: 5 },
  options: [{ name: "Màu", values: ["Đen", "Xám", "đen"] }],
  variants: [
    { sku: "TC113-DEN", name: "Đen", price: 199000, stock: 10 },
    { sku: "TC113-XAM", name: "Xám", price: "199000", stock: "3" },
  ],
  costPrice: 120000,
};

describe("parseManualListing", () => {
  it("đọc đủ trường, bỏ ảnh trùng, bỏ giá trị phân loại trùng không phân biệt hoa thường, ép số", () => {
    const { listing, manual } = parseManualListing(good);
    expect(listing.images).toEqual(["https://img/1.jpg", "https://img/2.jpg"]);
    expect(listing.options).toEqual([{ name: "Màu", values: ["Đen", "Xám"] }]);
    expect(listing.variants.map((v) => [v.sku, v.price, v.stock])).toEqual([
      ["TC113-DEN", 199000, 10],
      ["TC113-XAM", 199000, 3],
    ]);
    expect(listing.weightGrams).toBe(600);
    expect(listing.dimensionsCm).toEqual({ length: 20, width: 14, height: 5 });
    expect(listing.categoryId).toBeNull();
    expect(manual.costPrice).toBe(120000);
  });
  it("thiếu tên / không phân loại / số tổ hợp lệch → lỗi 400 rõ nghĩa", () => {
    expect(() => parseManualListing({ ...good, title: " " })).toThrow(/tên sản phẩm/i);
    expect(() => parseManualListing({ ...good, variants: [] })).toThrow(/ít nhất một phân loại/i);
    expect(() => parseManualListing({ ...good, variants: good.variants.slice(0, 1) })).toThrow(/không khớp số tổ hợp/i);
  });
  it("mã SKU: trống / sai mẫu / < 6 ký tự / trùng giữa phân loại → chặn hẳn; phân loại bị bỏ không kiểm", () => {
    const withSku = (a: string, b: string, excluded = false) => ({
      ...good,
      variants: [
        { ...good.variants[0], sku: a },
        { ...good.variants[1], sku: b, excluded },
      ],
    });
    expect(() => parseManualListing(withSku("", "TC113-XAM"))).toThrow(/chưa có mã SKU/i);
    expect(() => parseManualListing(withSku("TC 113", "TC113-XAM"))).toThrow(/không hợp lệ/i);
    expect(() => parseManualListing(withSku("JS051", "TC113-XAM"))).toThrow(/không hợp lệ/i);
    expect(() => parseManualListing(withSku("TC113-DEN", "tc113-den"))).toThrow(/trùng/i);
    expect(parseManualListing(withSku("TC113-DEN", "", true)).listing.variants[1].excluded).toBe(true);
    expect(SKU_PATTERN.test("TC113-DEN_M.2")).toBe(true);
  });
  it("URL ảnh phải http(s); cân nặng ≤ 0 → null; kích thước 0 cả 3 → null", () => {
    const { listing } = parseManualListing({ ...good, images: ["javascript:alert(1)", "https://ok/1.jpg"], weightGrams: "0", dimensionsCm: { length: 0, width: 0, height: 0 } });
    expect(listing.images).toEqual(["https://ok/1.jpg"]);
    expect(listing.weightGrams).toBeNull();
    expect(listing.dimensionsCm).toBeNull();
  });
});

describe("checkManualDraft", () => {
  it("bài đủ chuẩn → 3 sàn rỗng; mã bước 2 (danh mục, thương hiệu, vận chuyển) không báo", () => {
    const { listing } = parseManualListing(good);
    const r = checkManualDraft(listing);
    expect(r.SHOPEE).toEqual([]);
    expect(r.TIKTOK).toEqual([]);
    expect(r.LAZADA).toEqual([]);
  });
  it("tên 12 ký tự → TikTok báo ngắn, Shopee/Lazada không; thiếu kích thước → chỉ Lazada", () => {
    const { listing } = parseManualListing({ ...good, title: "Túi đeo chéo", dimensionsCm: null });
    const r = checkManualDraft(listing);
    expect(r.TIKTOK).toContain("title_short");
    expect(r.SHOPEE).not.toContain("title_short");
    expect(r.LAZADA).toContain("dimensions");
    expect(r.SHOPEE).not.toContain("dimensions");
  });
  it("3 nhóm phân loại → Shopee/Lazada báo quá nhóm, TikTok không", () => {
    const opts = [
      { name: "A", values: ["1", "2"] },
      { name: "B", values: ["x"] },
      { name: "C", values: ["y"] },
    ];
    const variants = ["1, x, y", "2, x, y"].map((name, i) => ({ sku: `SKU-${i}00`, name, price: 1000, stock: 1 }));
    const { listing } = parseManualListing({ ...good, options: opts, variants });
    const r = checkManualDraft(listing);
    expect(r.SHOPEE).toContain("too_many_options");
    expect(r.LAZADA).toContain("too_many_options");
    expect(r.TIKTOK).not.toContain("too_many_options");
  });
});
