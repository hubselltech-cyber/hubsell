// Hàm thuần quy đổi phân loại cho 3 adapter thật (docs/SAO-CHEP-SAN-PHAM.md mục 10).
import { describe, expect, it } from "vitest";
import type { ListingOption, ListingVariant } from "../types";
import { gramsToKg, htmlToText, splitVariantValues, textToHtml, tierIndexes, variantPairs, vndInt } from "../variant-map";

const options: ListingOption[] = [
  { name: "Màu", values: ["Đen", "Trắng"] },
  { name: "Size", values: ["M", "L"] },
];
const v = (name: string | null): ListingVariant => ({ sku: "x", name, price: 1, stock: 0, imageUrl: null });

describe("splitVariantValues", () => {
  it("bỏ tên nhóm, giữ thứ tự", () => {
    expect(splitVariantValues("Màu: Đen, Size: M")).toEqual(["Đen", "M"]);
    expect(splitVariantValues("Trắng,L")).toEqual(["Trắng", "L"]);
    expect(splitVariantValues(null)).toEqual([]);
  });
});

describe("tierIndexes / variantPairs", () => {
  it("Shopee tier_index theo nhóm, không phân biệt hoa thường", () => {
    expect(tierIndexes(v("trắng, l"), options)).toEqual([1, 1]);
    expect(tierIndexes(v("Đen"), options)).toEqual([0, -1]);
    expect(tierIndexes(v("Xanh, M"), options)).toEqual([-1, 0]);
  });
  it("TikTok/Lazada cặp tên–giá trị", () => {
    expect(variantPairs(v("Đen, M"), options)).toEqual([
      { name: "Màu", value: "Đen" },
      { name: "Size", value: "M" },
    ]);
    expect(variantPairs(v(null), options)).toEqual([]);
  });
});

describe("đổi đơn vị + mô tả", () => {
  it("gram → kg 3 số lẻ, giá nguyên đồng", () => {
    expect(gramsToKg(350)).toBe(0.35);
    expect(gramsToKg(null)).toBe(0);
    expect(vndInt(99999.6)).toBe(100000);
  });
  it("text ↔ html giữ xuống dòng, escape thẻ", () => {
    expect(textToHtml("a <b>\n\nc\nd")).toBe("<p>a &lt;b&gt;</p><p>c<br>d</p>");
    expect(htmlToText("<p>a</p><p>c<br>d</p>&amp;")).toBe("a\nc\nd\n&");
  });
});
