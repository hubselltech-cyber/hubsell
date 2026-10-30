import { describe, expect, it } from "vitest";
import { TtlCache } from "../ttl-cache";

describe("TtlCache", () => {
  it("trong TTL trả cùng promise (không nạp lại); gọi trùng khi đang nạp dùng chung một lượt", async () => {
    const c = new TtlCache<number>(1000);
    let calls = 0;
    const load = async () => ++calls;
    const [a, b] = await Promise.all([c.get("k", load), c.get("k", load)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(await c.get("k", load)).toBe(1);
    expect(calls).toBe(1);
  });

  it("nạp lỗi → bỏ khóa, lượt sau nạp lại", async () => {
    const c = new TtlCache<number>(1000);
    let n = 0;
    await expect(c.get("k", async () => { throw new Error(`lỗi ${++n}`); })).rejects.toThrow("lỗi 1");
    expect(await c.get("k", async () => ++n)).toBe(2);
  });

  it("quá trần số khóa → bỏ khóa cũ nhất, RAM không phình theo số gian", async () => {
    const c = new TtlCache<string>(60_000, 3);
    for (const k of ["a", "b", "c", "d"]) await c.get(k, async () => k);
    expect(c.size).toBe(3);
    let reloaded = false;
    await c.get("a", async () => {
      reloaded = true;
      return "a2";
    });
    expect(reloaded).toBe(true);
  });
});
