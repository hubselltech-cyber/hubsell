// ============================================================
// LÀN + THUÊ BAO trên kho RAM (thời gian thật, mốc ngắn): lấp suất ngay, việc
// chậm không chặn suất khác, gian lớn quay lại nhưng không bỏ đói gian nhỏ,
// mất thuê bao thì hủy lượt và không ghi đè (Pha B lát B3, docs mục 5b).
// ============================================================

import { describe, expect, it } from "vitest";
import { runLane } from "../sync-lanes";
import { MemoryLeaseStore } from "./fake-marketplace";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("làn + thuê bao", () => {
  it("việc chậm không chặn suất khác; lấp suất ngay khi trống", async () => {
    const store = new MemoryLeaseStore();
    store.add("slow");
    for (let i = 0; i < 6; i++) store.add(`fast${i}`);
    const done: string[] = [];
    const stop = new AbortController();
    const lane = runLane({
      lane: "orders",
      concurrency: 2,
      owner: "w1",
      store,
      stop: stop.signal,
      idlePollMs: 1_000,
      handle: async (it) => {
        await wait(it.channelId === "slow" ? 400 : 20);
        done.push(it.channelId);
        return 60_000;
      },
    });
    await wait(250);
    // Trong lúc "slow" chạy 400 ms, suất còn lại đã làm hết 6 việc nhanh (không chờ nhịp 1 s).
    expect(done.filter((d) => d.startsWith("fast"))).toHaveLength(6);
    expect(done).not.toContain("slow");
    stop.abort();
    await lane;
    expect(done).toContain("slow");
  });

  it("chia đều: gian lớn (luôn còn việc) quay lại nhưng gian nhỏ vẫn đến lượt", async () => {
    const store = new MemoryLeaseStore();
    store.add("big");
    for (let i = 0; i < 5; i++) store.add(`small${i}`);
    const runs = new Map<string, number>();
    const stop = new AbortController();
    const lane = runLane({
      lane: "orders",
      concurrency: 1,
      owner: "w1",
      store,
      stop: stop.signal,
      idlePollMs: 50,
      handle: async (it) => {
        runs.set(it.channelId, (runs.get(it.channelId) ?? 0) + 1);
        await wait(5);
        return it.channelId === "big" ? 0 : 60_000; // big: hết ngân sách lượt → tới hạn lại ngay
      },
    });
    await wait(300);
    stop.abort();
    await lane;
    for (let i = 0; i < 5; i++) expect(runs.get(`small${i}`)).toBe(1);
    expect(runs.get("big")!).toBeGreaterThan(3);
  });

  it("mất thuê bao (tiến trình khác nhặt lại) → lượt bị hủy, trả việc không ghi đè", async () => {
    const store = new MemoryLeaseStore();
    store.add("g");
    let aborted = false;
    const stop = new AbortController();
    const lane = runLane({
      lane: "orders",
      concurrency: 1,
      owner: "w1",
      store,
      stop: stop.signal,
      leaseMs: 90,
      idlePollMs: 1_000,
      handle: (_it, signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve(0);
          });
        }),
    });
    await wait(20);
    // Tiến trình w2 cướp thuê bao (giả lập w1 treo quá hạn).
    const r = store.rows.get("g/orders")!;
    r.owner = "w2";
    r.dueAt = 123;
    await wait(80);
    expect(aborted).toBe(true);
    expect(r.owner).toBe("w2");
    expect(r.dueAt).toBe(123);
    stop.abort();
    await lane;
  });

  it("việc ném GatewayDeferError → hẹn lại đúng waitMs; lỗi khác → errorRetryMs", async () => {
    const store = new MemoryLeaseStore();
    store.add("defer");
    store.add("boom");
    const stop = new AbortController();
    const t0 = Date.now();
    const lane = runLane({
      lane: "orders",
      concurrency: 2,
      owner: "w1",
      store,
      stop: stop.signal,
      idlePollMs: 1_000,
      errorRetryMs: 300_000,
      handle: async (it) => {
        if (it.channelId === "defer") throw Object.assign(new Error("429"), { waitMs: 30_000 });
        throw new Error("mạng");
      },
    });
    await wait(30);
    stop.abort();
    const s = await lane;
    expect(s.errors).toBe(2);
    expect(store.rows.get("defer/orders")!.dueAt - t0).toBeGreaterThanOrEqual(30_000);
    expect(store.rows.get("defer/orders")!.dueAt - t0).toBeLessThan(31_000);
    expect(store.rows.get("boom/orders")!.dueAt - t0).toBeGreaterThanOrEqual(300_000);
  });
});
