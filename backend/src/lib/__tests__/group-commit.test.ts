// ============================================================
// GHI GỘP (lib/group-commit.ts, M2.4): ghi khi đủ món, ghi khi hết giờ chờ, mẻ hỏng không lây, kết quả về đúng người gọi.
// Hàm thuần — đồng hồ giả, không database.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupCommit } from "../group-commit";

/** Lời hứa tự mở khóa bằng tay — để giữ một mẻ "đang ghi". */
function gate<T>(): { promise: Promise<T>; open: (v: T) => void } {
  let open!: (v: T) => void;
  const promise = new Promise<T>((r) => (open = r));
  return { promise, open };
}

describe("Ghi gộp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("đủ maxItems → ghi NGAY, không chờ đồng hồ; mỗi người gọi nhận đúng kết quả của món mình", async () => {
    const flushes: number[][] = [];
    const gc = createGroupCommit<number, string>({
      maxItems: 3,
      maxWaitMs: 200,
      flush: async (items) => {
        flushes.push(items);
        return items.map((n) => `kq-${n}`);
      },
    });
    const all = Promise.all([gc.submit(1), gc.submit(2), gc.submit(3)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(flushes).toEqual([[1, 2, 3]]);
    expect(await all).toEqual(["kq-1", "kq-2", "kq-3"]);
    // Đồng hồ của mẻ đã ghi phải được hủy: tua hết giờ chờ cũng không ghi thêm lượt nào.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushes).toHaveLength(1);
  });

  it("chưa đủ món → chờ đúng maxWaitMs kể từ MÓN ĐẦU rồi ghi; người gọi chỉ được trả lời sau khi mẻ ghi xong", async () => {
    const flushes: number[][] = [];
    const gc = createGroupCommit<number, number>({
      maxItems: 100,
      maxWaitMs: 200,
      flush: async (items) => {
        flushes.push(items);
        return items.map((n) => n * 10);
      },
    });
    let done = false;
    const first = gc.submit(1).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(150);
    const second = gc.submit(2); // tới sau 150 ms — KHÔNG kéo dài giờ chờ của mẻ
    await vi.advanceTimersByTimeAsync(49);
    expect(flushes).toHaveLength(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(flushes).toEqual([[1, 2]]);
    expect(await Promise.all([first, second])).toEqual([10, 20]);
  });

  it("vượt maxItems → tách thành nhiều mẻ; món dư đi mẻ sau theo đồng hồ", async () => {
    const flushes: number[][] = [];
    const gc = createGroupCommit<number, number>({
      maxItems: 2,
      maxWaitMs: 200,
      flush: async (items) => {
        flushes.push(items);
        return items;
      },
    });
    const all = Promise.all([1, 2, 3, 4, 5].map((n) => gc.submit(n)));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushes).toEqual([
      [1, 2],
      [3, 4],
    ]);
    await vi.advanceTimersByTimeAsync(200);
    expect(flushes).toHaveLength(3);
    expect(await all).toEqual([1, 2, 3, 4, 5]);
  });

  it("một mẻ hỏng chỉ làm hỏng người gọi của mẻ đó — mẻ sau vẫn ghi được", async () => {
    let n = 0;
    const gc = createGroupCommit<string, string>({
      maxItems: 2,
      maxWaitMs: 200,
      flush: async (items) => {
        if (++n === 1) throw new Error("database rớt");
        return items.map((s) => s.toUpperCase());
      },
    });
    const bad = Promise.allSettled([gc.submit("a"), gc.submit("b")]);
    const good = Promise.all([gc.submit("c"), gc.submit("d")]);
    await vi.advanceTimersByTimeAsync(0);
    const settled = await bad;
    expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected"]);
    expect((settled[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(await good).toEqual(["C", "D"]);
  });

  it("flush ném lỗi đồng bộ / trả thiếu kết quả → cả mẻ bị từ chối, không treo người gọi", async () => {
    const thrower = createGroupCommit<number, number>({
      maxItems: 1,
      maxWaitMs: 200,
      flush: () => {
        throw new Error("ném đồng bộ");
      },
    });
    const short = createGroupCommit<number, number>({ maxItems: 2, maxWaitMs: 200, flush: async () => [1] });
    const results = Promise.allSettled([thrower.submit(1), short.submit(1), short.submit(2)]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await results).map((s) => s.status)).toEqual(["rejected", "rejected", "rejected"]);
  });

  it("mẻ đang ghi KHÔNG chặn mẻ kế: món tới trong lúc đang ghi vào mẻ mới và được ghi theo đồng hồ riêng", async () => {
    const slow = gate<number[]>();
    const flushes: number[][] = [];
    const gc = createGroupCommit<number, number>({
      maxItems: 2,
      maxWaitMs: 200,
      flush: (items) => {
        flushes.push(items);
        return flushes.length === 1 ? slow.promise : Promise.resolve(items);
      },
    });
    const firstBatch = Promise.all([gc.submit(1), gc.submit(2)]); // mẻ 1 bắt đầu ghi và KẸT
    await vi.advanceTimersByTimeAsync(0);
    const later = gc.submit(3);
    await vi.advanceTimersByTimeAsync(200);
    expect(flushes).toEqual([[1, 2], [3]]);
    expect(await later).toBe(3); // mẻ 2 xong trước khi mẻ 1 nhả
    slow.open([1, 2]);
    expect(await firstBatch).toEqual([1, 2]);
  });
});
