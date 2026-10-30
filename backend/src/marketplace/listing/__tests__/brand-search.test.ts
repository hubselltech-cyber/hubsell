// Ô tìm thương hiệu: xếp "bắt đầu bằng" trước + gộp hãng gian đang dùng (docs/SAO-CHEP-SAN-PHAM.md mục 22, 25).
import { describe, expect, it } from "vitest";
import { mergeUsedBrands, rankBrands } from "../brand-search";

describe("rankBrands", () => {
  const list = [
    { id: "1", name: "AMBY LONDON" },
    { id: "2", name: "ANASTASIA BEVERLY HILL" },
    { id: "3", name: "BUNCHAR" },
    { id: "4", name: "Bioderma" },
    { id: "5", name: "L'Oréal" },
    { id: "6", name: "Đông Á" },
  ];
  it("gõ 'b' → hãng bắt đầu bằng B lên trước, hãng chỉ chứa b xếp sau (ca khách Bunchar)", () => {
    expect(rankBrands(list, "b").map((b) => b.name)).toEqual(["BUNCHAR", "Bioderma", "AMBY LONDON", "ANASTASIA BEVERLY HILL"]);
  });
  it("không dấu, không phân biệt hoa thường: 'dong a' khớp 'Đông Á'; 'bun' khớp BUNCHAR", () => {
    expect(rankBrands(list, "dong a").map((b) => b.id)).toEqual(["6"]);
    expect(rankBrands(list, "BUN").map((b) => b.id)).toEqual(["3"]);
  });
  it("không từ khóa → giữ nguyên thứ tự sàn, cắt limit", () => {
    expect(rankBrands(list, "  ", 2).map((b) => b.id)).toEqual(["1", "2"]);
  });
  it("không khớp → rỗng", () => {
    expect(rankBrands(list, "zzz")).toEqual([]);
  });
});

describe("mergeUsedBrands", () => {
  it("hãng đang dùng trên gian mà danh mục không có → thêm cuối kèm ghi chú; trùng id giữ bản danh mục; bỏ id 0", () => {
    const cat = [{ id: "1", name: "AMBY" }, { id: "2", name: "BIODERMA" }];
    const used = [{ id: "2", name: "Bioderma" }, { id: "9", name: "BUNCHAR" }, { id: "0", name: "No Brand" }];
    const merged = mergeUsedBrands(cat, used);
    expect(merged).toEqual([...cat, { id: "9", name: "BUNCHAR", note: expect.any(String) }]);
    expect(rankBrands(merged, "bun").map((b) => b.id)).toEqual(["9"]);
  });
});
