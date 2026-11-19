// Chạy: (từ thư mục frontend)
//   node --import ../backend/node_modules/tsx/dist/loader.mjs --test "src/lib/pack-video-recorder/__tests__/*.test.ts"
// Frontend chưa có bộ chạy test riêng → dùng node:test có sẵn của Node, mượn bộ nạp TypeScript (tsx) của backend.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RETRY_BASE_MS, RETRY_CAP_MS, RETRY_FLOOR_MS, retryCeilingMs, retryDelayMs } from "../upload-backoff";
import { UploadQueue, type UploadJobEvent, type UploadQueueDeps, type UploadQueueState } from "../upload-queue";

// ---------- dãy thời gian chờ ----------

test("trần chờ nhân đôi mỗi lần hỏng liên tiếp rồi dừng ở trần 5 phút", () => {
  assert.equal(retryCeilingMs(1), RETRY_BASE_MS);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(retryCeilingMs),
    [4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000]
  );
  assert.equal(retryCeilingMs(10_000), RETRY_CAP_MS); // không tràn số khi hỏng rất nhiều lần
  assert.equal(retryCeilingMs(0), RETRY_BASE_MS);
});

test("lệch ngẫu nhiên toàn phần: luôn nằm trong [sàn 2 giây, trần]", () => {
  for (const failures of [1, 2, 5, 9, 50]) {
    assert.equal(retryDelayMs(failures, 0), RETRY_FLOOR_MS);
    assert.equal(retryDelayMs(failures, 0.999_999_9), retryCeilingMs(failures));
    for (let i = 0; i < 200; i++) {
      const d = retryDelayMs(failures, Math.random());
      assert.ok(d >= RETRY_FLOOR_MS && d <= retryCeilingMs(failures), `failures=${failures} d=${d}`);
    }
  }
  // Hai trình duyệt khác số ngẫu nhiên thì chờ khác nhau (không dồn sóng).
  assert.notEqual(retryDelayMs(6, 0.1), retryDelayMs(6, 0.9));
});

test("máy chủ bảo chờ (Retry-After) thì chờ ít nhất chừng đó, nhưng không nghe số rác", () => {
  assert.equal(retryDelayMs(1, 0, 30_000), 30_000);
  assert.equal(retryDelayMs(9, 0.999_999_9, 1_000), RETRY_CAP_MS); // nhỏ hơn mức mình định chờ → giữ mức mình
  assert.equal(retryDelayMs(1, 0, 24 * 3_600_000), RETRY_CAP_MS * 2); // quá lớn → chặn ở 2 lần trần
  assert.equal(retryDelayMs(1, 0, Number.NaN), RETRY_FLOOR_MS);
  assert.equal(retryDelayMs(1, 0, -5), RETRY_FLOOR_MS);
});

// ---------- máy trạng thái hàng chờ, đồng hồ giả ----------

class Harness {
  nowMs = 0;
  online = true;
  timers: { at: number; run: () => void; id: number }[] = [];
  seq = 0;
  events: [string, UploadJobEvent][] = [];
  states: UploadQueueState[] = [];
  /** Mỗi clip: danh sách kết quả cho từng lần thử ("ok" | lỗi). Hết danh sách thì "ok". */
  script = new Map<string, (string | "ok")[]>();
  calls: string[] = [];
  random = 0;
  queue: UploadQueue;

  constructor() {
    const deps: UploadQueueDeps = {
      upload: async (id) => {
        this.calls.push(id);
        const next = this.script.get(id)?.shift() ?? "ok";
        if (next !== "ok") throw new Error(next);
      },
      classify: (err) => {
        const text = (err as Error).message;
        return text.startsWith("fatal") ? { kind: "fatal", text } : { kind: "retry", text };
      },
      isOnline: () => this.online,
      now: () => this.nowMs,
      random: () => this.random,
      setTimer: (run, ms) => {
        const id = ++this.seq;
        this.timers.push({ at: this.nowMs + ms, run, id });
        return id;
      },
      clearTimer: (handle) => {
        this.timers = this.timers.filter((t) => t.id !== handle);
      },
      onJob: (id, event) => this.events.push([id, event]),
      onQueue: (state) => this.states.push(state),
    };
    this.queue = new UploadQueue(deps);
  }

  /** Cho các lời hứa đang chờ chạy hết. */
  async settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  /** Tua đồng hồ tới mốc hẹn giờ kế tiếp và chạy nó. */
  async fireNextTimer(): Promise<number> {
    const next = [...this.timers].sort((a, b) => a.at - b.at)[0];
    assert.ok(next, "không có lượt hẹn giờ nào");
    this.timers = this.timers.filter((t) => t !== next);
    const waited = next.at - this.nowMs;
    this.nowMs = next.at;
    next.run();
    await this.settle();
    return waited;
  }

  types(id: string): string[] {
    return this.events.filter(([i]) => i === id).map(([, e]) => e.type);
  }
}

test("gửi tuần tự, lên xong thì báo stored", async () => {
  const h = new Harness();
  h.queue.enqueue("a");
  h.queue.enqueue("b");
  h.queue.enqueue("a"); // trùng → bỏ qua
  await h.settle();
  assert.deepEqual(h.calls, ["a", "b"]);
  assert.deepEqual(h.types("a"), ["uploading", "stored"]);
  assert.deepEqual(h.types("b"), ["uploading", "stored"]);
  assert.equal(h.queue.state.pending, 0);
});

test("KHÔNG bỏ cuộc: hỏng 12 lần liên tiếp vẫn thử tiếp, khoảng chờ tăng dần tới trần", async () => {
  const h = new Harness();
  h.random = 0.999_999_9; // luôn chờ đúng trần → nhìn được dãy tăng
  h.script.set("a", Array<string>(12).fill("mạng"));
  h.queue.enqueue("a");
  await h.settle();
  const waits: number[] = [];
  for (let i = 0; i < 12; i++) waits.push(await h.fireNextTimer());
  assert.deepEqual(waits.slice(0, 8), [4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000]);
  assert.ok(waits.slice(8).every((w) => w === RETRY_CAP_MS));
  assert.equal(h.calls.length, 13);
  assert.deepEqual(h.types("a").slice(-2), ["uploading", "stored"]);
  assert.equal(h.queue.state.failures, 0); // lên được là bộ đếm hỏng về 0
});

test("clip hỏng xuống cuối hàng — không chặn các clip sau", async () => {
  const h = new Harness();
  h.script.set("a", ["mạng"]);
  h.queue.enqueue("a");
  h.queue.enqueue("b");
  await h.settle();
  assert.deepEqual(h.calls, ["a"]); // đang nghỉ sau lần hỏng của a
  assert.equal(h.queue.state.failures, 1);
  assert.equal(h.queue.state.lastError, "mạng");
  assert.ok(h.queue.state.nextRetryAtMs !== null);
  await h.fireNextTimer();
  assert.deepEqual(h.calls, ["a", "b", "a"]);
  assert.deepEqual(h.types("b"), ["uploading", "stored"]);
  assert.deepEqual(h.types("a"), ["uploading", "retry", "uploading", "stored"]);
});

test("lỗi không thể thử lại: dừng riêng clip đó, clip khác đi tiếp, không tính là hỏng mạng", async () => {
  const h = new Harness();
  h.script.set("a", ["fatal: hết quyền"]);
  h.queue.enqueue("a");
  h.queue.enqueue("b");
  await h.settle();
  assert.deepEqual(h.types("a"), ["uploading", "failed"]);
  assert.deepEqual(h.types("b"), ["uploading", "stored"]);
  assert.equal(h.queue.state.failures, 0);
  assert.equal(h.timers.length, 0);
  // Người dùng bấm "Thử lại" → vào lại hàng được.
  h.queue.enqueue("a");
  await h.settle();
  assert.deepEqual(h.types("a"), ["uploading", "failed", "uploading", "stored"]);
});

test("mất mạng: đứng chờ, không đốt lượt thử; có mạng lại là chạy NGAY", async () => {
  const h = new Harness();
  h.online = false;
  h.queue.enqueue("a");
  await h.settle();
  assert.deepEqual(h.calls, []); // không thử khi đang mất mạng
  assert.equal(h.queue.state.waitingOnline, true);
  assert.equal(h.timers.length, 0); // không hẹn giờ nào — chỉ chờ sự kiện có mạng
  h.nowMs += 3_600_000; // mất mạng một giờ
  await h.settle();
  assert.deepEqual(h.calls, []);
  h.online = true;
  h.queue.kick();
  await h.settle();
  assert.deepEqual(h.calls, ["a"]);
  assert.deepEqual(h.types("a"), ["uploading", "stored"]);
});

test("đang nghỉ giữa hai lần thử mà có mạng lại / bấm Thử ngay → bỏ khoảng nghỉ", async () => {
  const h = new Harness();
  h.random = 0.999_999_9;
  h.script.set("a", ["mạng", "mạng", "mạng", "mạng", "mạng", "mạng", "mạng", "mạng"]);
  h.queue.enqueue("a");
  await h.settle();
  for (let i = 0; i < 7; i++) await h.fireNextTimer();
  assert.equal(h.queue.state.failures, 8);
  assert.equal(h.timers.length, 1); // đang nghỉ 5 phút
  h.queue.kick();
  await h.settle();
  assert.equal(h.timers.length, 0); // lượt hẹn giờ đã hủy
  assert.deepEqual(h.types("a").slice(-2), ["uploading", "stored"]);
});

test("rớt mạng ngay sau một lần hỏng: không nghỉ theo đồng hồ mà chờ mạng", async () => {
  const h = new Harness();
  h.script.set("a", ["mạng"]);
  // Lần thử đầu chạy lúc còn mạng, hỏng đúng lúc mạng rớt.
  const original = h.queue;
  h.queue.enqueue("a");
  h.online = false;
  await h.settle();
  assert.equal(original.state.waitingOnline, true);
  assert.equal(h.timers.length, 0);
  h.online = true;
  h.queue.kick();
  await h.settle();
  assert.deepEqual(h.types("a"), ["uploading", "retry", "uploading", "stored"]);
});
