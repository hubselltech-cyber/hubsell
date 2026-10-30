// Lật hết trang theo offset (Shopee get_brand_list — docs/SAO-CHEP-SAN-PHAM.md mục 22).
import { describe, expect, it } from "vitest";
import { collectPages } from "../paginate";

describe("collectPages", () => {
  it("lật hết 3 trang theo next_offset rồi dừng khi has_next_page=false", async () => {
    const calls: number[] = [];
    const r = await collectPages(
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
    await collectPages(
      async (offset) => {
        calls.push(offset);
        return { items: ["x"], hasNext: offset < 200 };
      },
      100
    );
    expect(calls).toEqual([0, 100, 200]);
  });
  it("chạm trần số trang → trả phần đã có + truncated", async () => {
    const r = await collectPages(async (offset) => ({ items: [offset], hasNext: true, nextOffset: offset + 1 }), 1, 5);
    expect(r.items).toEqual([0, 1, 2, 3, 4]);
    expect(r).toMatchObject({ truncated: true, pages: 5 });
  });
  it("offset không tiến hoặc trang rỗng → dừng, không lặp vô hạn", async () => {
    const stuck = await collectPages(async () => ({ items: ["a"], hasNext: true, nextOffset: 0 }), 100);
    expect(stuck.pages).toBe(1);
    const empty = await collectPages(async (offset) => ({ items: offset === 0 ? ["a"] : [], hasNext: true }), 100);
    expect(empty.pages).toBe(2);
    expect(empty.items).toEqual(["a"]);
  });
});
