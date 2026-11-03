import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleCache } from "../stale-cache";

const FRESH = 1_000;
const MAX_STALE = 10_000;

function setup() {
  let n = 0;
  const load = vi.fn(async () => ++n);
  return { load, cache: new StaleCache("thử", load, FRESH, MAX_STALE) };
}

describe("StaleCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("còn tươi thì không nạp lại", async () => {
    const { cache, load } = setup();
    expect(await cache.get()).toBe(1);
    vi.advanceTimersByTime(FRESH - 1);
    expect(await cache.get()).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("đã cũ thì trả bản cũ ngay, lượt sau có bản mới", async () => {
    const { cache, load } = setup();
    await cache.get();
    vi.advanceTimersByTime(FRESH);
    expect(await cache.get()).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.get()).toBe(2);
  });

  it("quá hạn tối đa thì chờ nạp, không đưa số quá cũ", async () => {
    const { cache } = setup();
    await cache.get();
    vi.advanceTimersByTime(MAX_STALE);
    expect(await cache.get()).toBe(2);
  });

  it("gọi trùng lúc đang nạp chỉ chạy một lượt", async () => {
    const { cache, load } = setup();
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect([a, b]).toEqual([1, 1]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("làm mới ở nền lỗi thì giữ bản cũ, lượt sau thử lại", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn<() => Promise<number>>().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("hỏng")).mockResolvedValueOnce(3);
    const cache = new StaleCache("thử", load, FRESH, MAX_STALE);
    await cache.get();
    vi.advanceTimersByTime(FRESH);
    expect(await cache.get()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(await cache.get()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.get()).toBe(3);
  });

  it("chưa có bản nào mà nạp lỗi thì báo lỗi, lượt sau nạp lại", async () => {
    const load = vi.fn<() => Promise<number>>().mockRejectedValueOnce(new Error("hỏng")).mockResolvedValueOnce(2);
    const cache = new StaleCache("thử", load, FRESH, MAX_STALE);
    await expect(cache.get()).rejects.toThrow("hỏng");
    expect(await cache.get()).toBe(2);
  });
});
