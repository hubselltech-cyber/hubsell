// ============================================================
// MÁY ĐỌC CON TRỎ trên SÀN GIẢ — kiểm TÍNH CHẤT, không kiểm từng bước:
// "mọi thứ tự trả về / trùng dòng / token hết hạn / 429 / gian 20.000 đơn đều ra
// CÙNG một tập dữ liệu, không mất dòng nào trước con trỏ" (Pha B, docs mục 5b).
// ============================================================

import { describe, expect, it } from "vitest";
import { readByCursor, type StreamSpec } from "../cursor-reader";
import { FakeMarketplace, FakeRateLimitError, MemoryStore, type FakeOptions, type FakeOrder, type FakeRow } from "./fake-marketplace";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 1);

function makeSpec(m: FakeMarketplace, store: MemoryStore, stream = "orders"): StreamSpec<FakeRow, null> {
  return {
    channelId: "ch1",
    stream,
    maxWindowMs: 15 * DAY,
    initialCursorAt: () => T0,
    fetchPage: (win, token) => m.fetchPage(win, token),
    rowKey: (r) => r.id,
    persist: async (rows) => {
      for (const r of rows) store.sink.set(r.id, r);
    },
  };
}

/** Chạy lượt nối nhau tới khi đuổi kịp; 429 = lượt sau đọc tiếp từ con trỏ (lát B2 sẽ lùi đúng cách). */
async function drain(m: FakeMarketplace, store: MemoryStore, opts: { stream?: string; maxPages?: number } = {}) {
  const spec = makeSpec(m, store, opts.stream);
  let runs = 0;
  let last;
  for (;;) {
    runs++;
    if (runs > 5_000) throw new Error("không đuổi kịp sau 5.000 lượt");
    try {
      last = await readByCursor(spec, store, { now: () => m.clock, maxPages: opts.maxPages ?? 40 });
      if (last.status === "caught_up") return { ...last, runs };
    } catch (err) {
      if (!(err instanceof FakeRateLimitError)) throw err;
      m.clock += 1000;
    }
  }
}

/** Mọi dòng thật có mốc < con trỏ phải có trong kho, ĐÚNG phiên bản mới nhất. */
function missing(m: FakeMarketplace, store: MemoryStore, cursorAt: number): string[] {
  const out: string[] = [];
  for (const r of m.rows.values()) {
    if (r.t >= cursorAt) continue;
    if (store.sink.get(r.id)?.version !== r.version) out.push(r.id);
  }
  return out;
}

describe("máy đọc con trỏ — tính chất trên sàn giả", () => {
  it.each<FakeOrder>(["asc", "desc", "random", "create_asc"])(
    "thứ tự %s: 3.000 đơn / 2 ngày, có trùng dòng → đủ tập, không mất",
    async (order) => {
      const m = new FakeMarketplace(T0 + 2 * DAY + 10 * MIN, { order, overlap: 7, pageSize: 50 });
      m.seed(3_000, T0, T0 + 2 * DAY);
      const store = new MemoryStore();
      const r = await drain(m, store);
      expect(r.cursorAt).toBeGreaterThanOrEqual(T0 + 2 * DAY);
      expect(missing(m, store, r.cursorAt)).toEqual([]);
      expect(store.sink.size).toBe(3_000);
    }
  );

  it("gian 20.000 đơn / 2 ngày (10.000 đơn/ngày) + 429 5 % + token hết hạn + trùng: đủ tập, chi phí lệnh có giới hạn", async () => {
    const opts: FakeOptions = { order: "random", overlap: 3, tokenTtlCalls: 4, rateLimitRatio: 0.05, seed: 7 };
    const m = new FakeMarketplace(T0 + 2 * DAY + 10 * MIN, opts);
    m.seed(20_000, T0, T0 + 2 * DAY);
    const store = new MemoryStore();
    const r = await drain(m, store);
    expect(missing(m, store, r.cursorAt)).toEqual([]);
    expect(store.sink.size).toBe(20_000);
    // Tối thiểu 200 trang; co cửa sổ (đọc phí trang tràn) + 429 + đọc lại do token → vẫn dưới 2,5×.
    expect(m.calls).toBeLessThan(500);
  });

  it("không bao giờ cắt: sàn âm thầm ngừng trả trang sau 30 trang — K=20 co trước khi chạm trần", async () => {
    const m = new FakeMarketplace(T0 + 1 * DAY + 10 * MIN, { order: "create_asc", silentPageCap: 30, pageSize: 50 });
    m.seed(5_000, T0, T0 + DAY);
    const store = new MemoryStore();
    const r = await drain(m, store);
    expect(missing(m, store, r.cursorAt)).toEqual([]);
  });

  it("có tổng sàn báo (TikTok/Lazada): co theo tỷ lệ ngay trang đầu, ít trang phí hơn chia đôi", async () => {
    const make = (reportTotal: boolean) => {
      const m = new FakeMarketplace(T0 + 2 * DAY + 10 * MIN, { reportTotal, seed: 3 });
      m.seed(20_000, T0, T0 + 2 * DAY);
      return m;
    };
    const withTotal = make(true);
    const noTotal = make(false);
    const a = new MemoryStore();
    const b = new MemoryStore();
    await drain(withTotal, a);
    await drain(noTotal, b);
    expect(a.sink.size).toBe(20_000);
    expect(b.sink.size).toBe(20_000);
    expect(withTotal.calls).toBeLessThan(noTotal.calls);
  });

  it("H8: đơn rời cửa sổ giữa lúc đọc (phân trang offset) — có tổng → phát hiện lệch, đọc lại, không mất", async () => {
    const m = new FakeMarketplace(T0 + 1 * DAY + 10 * MIN, { order: "asc", reportTotal: true, pageSize: 50, seed: 11 });
    m.seed(4_000, T0, T0 + DAY);
    let n = 0;
    m.beforeCall = (mm) => {
      // cứ 3 lệnh có 1 đơn NGAY TRONG cửa sổ đang đọc đổi trạng thái (rời cửa sổ, sang hiện tại)
      if (++n % 3 === 0) mm.touchInLastWindow();
    };
    const store = new MemoryStore();
    const r = await drain(m, store);
    expect(r.cursorAt).toBeGreaterThan(T0 + DAY - 10 * MIN);
    expect(missing(m, store, r.cursorAt)).toEqual([]);
    // Cái giá: đọc lại cửa sổ — ở mức đổi cực gắt này ~12× lệnh (đo 19/10: 1.895 vs 151). Có trần MAX_UNSTABLE_REREADS.
    expect(m.calls).toBeLessThan(2_500);
  });

  it("H8 giới hạn đã biết: sàn KHÔNG báo tổng (Shopee) + đơn rời cửa sổ giữa lúc đọc → lượt đối soát trễ bù đủ", async () => {
    const m = new FakeMarketplace(T0 + 1 * DAY + 10 * MIN, { order: "asc", reportTotal: false, pageSize: 50, seed: 11 });
    m.seed(4_000, T0, T0 + DAY);
    let n = 0;
    m.beforeCall = (mm) => {
      if (++n % 3 === 0) mm.touchInLastWindow();
    };
    const store = new MemoryStore();
    const fresh = await drain(m, store);
    const lostInFresh = missing(m, store, fresh.cursorAt).length;
    // Giới hạn là THẬT trong mô hình offset: lượt tươi lỡ đơn (đo 19/10: 8 đơn với hạt giống này).
    expect(lostInFresh).toBeGreaterThan(0);
    // Lượt đối soát: con trỏ riêng, đọc lại sau khi dữ liệu lắng (không ai đổi giữa lúc đọc).
    m.beforeCall = undefined;
    const recheck = await drain(m, store, { stream: "orders:recheck" });
    expect(missing(m, store, Math.min(fresh.cursorAt, recheck.cursorAt))).toEqual([]);
  });

  it("chết giữa giao dịch: con trỏ không tiến quá phần đã ghi, lượt sau đọc tiếp đủ", async () => {
    const m = new FakeMarketplace(T0 + 1 * DAY + 10 * MIN, { pageSize: 50 });
    m.seed(2_000, T0, T0 + DAY);
    const store = new MemoryStore();
    store.failAt = 5;
    await expect(readByCursor(makeSpec(m, store), store, { now: () => m.clock })).rejects.toThrow("chết giữa");
    store.failAt = undefined;
    const r = await drain(m, store);
    expect(missing(m, store, r.cursorAt)).toEqual([]);
  });

  it("ngân sách lượt: dừng ở ranh cửa sổ sau N trang với status budget, con trỏ chỉ ở ranh cửa sổ đã đọc trọn", async () => {
    const m = new FakeMarketplace(T0 + 2 * DAY + 10 * MIN, { pageSize: 50 });
    m.seed(10_000, T0, T0 + 2 * DAY);
    const store = new MemoryStore();
    const r = await readByCursor(makeSpec(m, store), store, { now: () => m.clock, maxPages: 15 });
    expect(r.status).toBe("budget");
    // Xét ngân sách ở ranh cửa sổ: vượt tối đa K trang (20), không cắt giữa cửa sổ.
    expect(r.pages).toBeGreaterThanOrEqual(15);
    expect(r.pages).toBeLessThanOrEqual(15 + 20);
    expect(missing(m, store, r.cursorAt)).toEqual([]);
    expect(r.lagMs).toBeGreaterThan(0);
  });

  it("gian vắng: cửa sổ học lên tới trần sàn 15 ngày, 90 ngày chỉ tốn ít lệnh", async () => {
    const start = T0;
    const m = new FakeMarketplace(start + 90 * DAY + 10 * MIN, { pageSize: 100 });
    m.seed(300, start, start + 90 * DAY);
    const store = new MemoryStore();
    const r = await drain(m, store);
    expect(missing(m, store, r.cursorAt)).toEqual([]);
    expect(r.windowMs).toBe(15 * DAY);
    expect(m.calls).toBeLessThan(25);
  });

  it("đuổi kịp: không đọc sát hiện tại (mốc cuối ≤ now − settle)", async () => {
    const now = T0 + DAY;
    const m = new FakeMarketplace(now, { callMs: 0 });
    m.seed(100, T0, now);
    const store = new MemoryStore();
    const r = await readByCursor(makeSpec(m, store), store, { now: () => m.clock, config: { settleMs: 2 * MIN } });
    expect(r.status).toBe("caught_up");
    expect(r.cursorAt).toBe(now - 2 * MIN);
  });

  it("429 giữa cửa sổ + ngân sách lượt < K: vẫn tiến (đọc lại đúng trang), không kẹt", async () => {
    const m = new FakeMarketplace(T0 + 2 * DAY + 10 * MIN, { pageSize: 50, rateLimitRatio: 0.2, seed: 9 });
    m.seed(10_000, T0, T0 + 2 * DAY);
    const store = new MemoryStore();
    const spec = makeSpec(m, store);
    let runs = 0;
    let r;
    do {
      r = await readByCursor(spec, store, {
        now: () => m.clock,
        maxPages: 5,
        retryDelay: (e) => (e instanceof FakeRateLimitError ? 0 : null),
        sleep: async () => {},
      });
    } while (r.status !== "caught_up" && ++runs < 500);
    expect(r.status).toBe("caught_up");
    expect(missing(m, store, r.cursorAt)).toEqual([]);
    expect(m.rateLimited).toBeGreaterThan(0);
  });
});
