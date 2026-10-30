// Ô tìm thương hiệu: lật hết trang Shopee + xếp "bắt đầu bằng" trước (docs/SAO-CHEP-SAN-PHAM.md mục 22).
import { describe, expect, it } from "vitest";
import { collectBrandPages, rankBrands } from "../brand-search";

describe("collectBrandPages", () => {
  it("lật hết 3 trang theo next_offset rồi dừng khi has_next_page=false", async () => {
    const calls: number[] = [];
    const r = await collectBrandPages(
      async (offset) => {
        calls.push(offset);
        const page = offset / 100;
        return { items: [`p${page}a`, `p${page}b`], hasNext: page < 2, nextOffset: offset + 100 };
      },
      100
    );
    expect(calls).toEqual([0, 100, 200]);
    expect(r.items).toEqual(["p0a", "p0b", "p1a", "p1b", "p2a", "p2b"]);
    expect(r).toMatchObject({ truncated: false, pages: 3 });
  });
  it("sàn không trả next_offset → tự cộng pageSize", async () => {
    const calls: number[] = [];
    await collectBrandPages(
      async (offset) => {
        calls.push(offset);
        return { items: ["x"], hasNext: offset < 200 };
      },
      100
    );
    expect(calls).toEqual([0, 100, 200]);
  });
  it("chạm trần số trang → trả phần đã có + truncated", async () => {
    const r = await collectBrandPages(async (offset) => ({ items: [offset], hasNext: true, nextOffset: offset + 1 }), 1, 5);
    expect(r.items).toEqual([0, 1, 2, 3, 4]);
    expect(r).toMatchObject({ truncated: true, pages: 5 });
  });
  it("offset không tiến hoặc trang rỗng → dừng, không lặp vô hạn", async () => {
    const stuck = await collectBrandPages(async () => ({ items: ["a"], hasNext: true, nextOffset: 0 }), 100);
    expect(stuck.pages).toBe(1);
    const empty = await collectBrandPages(async (offset) => ({ items: offset === 0 ? ["a"] : [], hasNext: true }), 100);
    expect(empty.pages).toBe(2);
    expect(empty.items).toEqual(["a"]);
  });
});

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
