// Hàm thuần quy đổi phân loại cho 3 adapter thật (docs/SAO-CHEP-SAN-PHAM.md mục 10).
import { describe, expect, it } from "vitest";
import { optionImages, reorderOptionsForImages } from "../variant-map";

describe("optionImages / reorderOptionsForImages", () => {
  const options = [
    { name: "Size", values: ["M", "L"] },
    { name: "Màu", values: ["Đen", "Trắng"] },
  ];
  const variants = [
    { sku: "a", name: "M, Đen", price: 1, stock: 1, imageUrl: "https://img/den.jpg" },
    { sku: "b", name: "L, Đen", price: 1, stock: 1, imageUrl: "https://img/den.jpg" },
    { sku: "c", name: "M, Trắng", price: 1, stock: 1, imageUrl: "https://img/trang.jpg" },
    { sku: "d", name: "L, Trắng", price: 1, stock: 1, imageUrl: null },
  ];
  it("Màu có 2 ảnh khác nhau, Size 2 giá trị nhưng cùng 1 ảnh → nhóm Màu là nhóm ảnh, đưa lên đầu", () => {
    const r = optionImages(variants, options);
    expect([...r.byOption[1].entries()]).toEqual([
      ["Đen", "https://img/den.jpg"],
      ["Trắng", "https://img/trang.jpg"],
    ]);
    expect(r.imageOptionIndex).toBe(1);
    expect(reorderOptionsForImages(options, variants).map((o) => o.name)).toEqual(["Màu", "Size"]);
  });
  it("không phân loại nào có ảnh → giữ nguyên thứ tự", () => {
    const plain = variants.map((v) => ({ ...v, imageUrl: null }));
    expect(reorderOptionsForImages(options, plain)).toEqual(options);
  });
  it("chỉ nhóm thứ hai có ảnh khác nhau → đưa lên đầu", () => {
    const vs = [
      { sku: "a", name: "M, Đen", price: 1, stock: 1, imageUrl: "https://img/den.jpg" },
      { sku: "c", name: "M, Trắng", price: 1, stock: 1, imageUrl: "https://img/trang.jpg" },
    ];
    expect(reorderOptionsForImages(options, vs).map((o) => o.name)).toEqual(["Màu", "Size"]);
  });
});
import type { ListingOption, ListingVariant } from "../types";
import {
  appendHtmlImages,
  extractHtmlImages,
  gramsToKg,
  htmlToText,
  splitVariantValues,
  textToHtml,
  tierIndexes,
  variantPairs,
  vndInt,
} from "../variant-map";

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
  it("tách ảnh chèn trong mô tả HTML theo thứ tự, bỏ data URI + trùng, rồi ghép lại cuối", () => {
    const html = `<p>Mở đầu</p><img src="https://a/1.jpg"><p>Giữa <img alt='x' src='https://a/2.png' /></p><img src="data:image/png;base64,xx"><img src="https://a/1.jpg">`;
    const r = extractHtmlImages(html);
    expect(r.images).toEqual(["https://a/1.jpg", "https://a/2.png"]);
    expect(htmlToText(r.html)).toBe("Mở đầu\nGiữa");
    expect(appendHtmlImages("<p>a</p>", ["https://b/x.jpg"])).toBe('<p>a</p><p><img src="https://b/x.jpg" /></p>');
    expect(appendHtmlImages("<p>a</p>", [])).toBe("<p>a</p>");
  });
  it("text ↔ html giữ xuống dòng, escape thẻ", () => {
    expect(textToHtml("a <b>\n\nc\nd")).toBe("<p>a &lt;b&gt;</p><p>c<br>d</p>");
    expect(htmlToText("<p>a</p><p>c<br>d</p>&amp;")).toBe("a\nc\nd\n&");
  });
});
