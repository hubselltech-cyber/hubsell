// ============================================================
// GHÉP CẢ "NỀN" (Pha B, docs mục 5b): sàn giả → cổng gọi sàn → máy đọc con trỏ
// → HAI tiến trình làn dùng chung kho con trỏ + thuê bao. Tính chất:
//   1. gian 20.000 đơn + gian nhỏ, gian lớn dính 429 10 % → mọi gian đủ dữ liệu;
//   2. gian nhỏ đuổi kịp TRƯỚC gian lớn (không bị bỏ đói);
//   3. 429 của gian lớn không làm gian nhỏ phải chờ (khóa lùi theo gian).
// ============================================================

import { describe, expect, it } from "vitest";
import { readByCursor, type StreamSpec } from "../cursor-reader";
import { callMarketplace, isGatewayDefer, MemoryRateStore, type GatewayDeps } from "../marketplace-gateway";
import { runLane, type LeaseItem } from "../sync-lanes";
import { FakeMarketplace, FakeRateLimitError, MemoryLeaseStore, MemoryStore, type FakeRow } from "./fake-marketplace";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 1);

describe("nền lớp đọc sàn — ghép", () => {
  it("2 tiến trình × 2 luồng: gian lớn 20.000 đơn + 429, 4 gian nhỏ — đủ dữ liệu, gian nhỏ không đói", async () => {
    const shops = new Map<string, FakeMarketplace>();
    const big = new FakeMarketplace(T0 + 2 * DAY + 10 * MIN, { order: "random", rateLimitRatio: 0.1, callMs: 300, seed: 5 });
    big.seed(20_000, T0, T0 + 2 * DAY);
    shops.set("big", big);
    for (let i = 0; i < 4; i++) {
      const m = new FakeMarketplace(T0 + 2 * DAY + 10 * MIN, { order: "create_asc", seed: 10 + i });
      m.seed(300, T0, T0 + 2 * DAY);
      shops.set(`small${i}`, m);
    }

    const cursors = new MemoryStore();
    const leases = new MemoryLeaseStore();
    for (const id of shops.keys()) leases.add(id);
    // rand = 0 → lùi 0 ms (test không ngủ thật); vẫn đi đủ đường 429 → cổng → làn xếp lại.
    const gw: GatewayDeps = { store: new MemoryRateStore(Date.now, () => 0), now: Date.now, sleep: async () => {} };
    const caughtUpAt = new Map<string, number>();
    let deferred = 0;

    const handle = async (item: LeaseItem, signal: AbortSignal) => {
      const m = shops.get(item.channelId)!;
      const spec: StreamSpec<FakeRow, null> = {
        channelId: item.channelId,
        stream: item.stream,
        maxWindowMs: 15 * DAY,
        initialCursorAt: () => T0,
        fetchPage: (win, token) =>
          callMarketplace(
            {
              platform: "SHOPEE",
              app: "test",
              shop: item.channelId,
              endpoint: "/api/v2/order/get_order_list",
              classify: (e) => (e instanceof FakeRateLimitError ? { kind: "rate_limit", scope: "shop" } : { kind: "other" }),
            },
            () => m.fetchPage(win, token),
            gw
          ).catch((e) => {
            deferred++;
            throw e;
          }),
        rowKey: (r) => r.id,
        persist: async (rows) => {
          for (const r of rows) cursors.sink.set(`${item.channelId}:${r.id}`, r);
        },
      };
      const r = await readByCursor(spec, cursors, {
        now: () => m.clock,
        maxPages: 10,
        signal,
        retryDelay: (e) => (isGatewayDefer(e) && e.waitMs <= 30_000 ? e.waitMs : null),
        sleep: async () => {},
      });
      if (r.status === "caught_up") {
        if (!caughtUpAt.has(item.channelId)) caughtUpAt.set(item.channelId, Date.now());
        return 60 * MIN;
      }
      return 0;
    };

    const stop = new AbortController();
    const lanes = ["w1", "w2"].map((owner) =>
      runLane({ lane: "orders", concurrency: 2, owner, store: leases, handle, stop: stop.signal, idlePollMs: 5, leaseMs: 5_000 })
    );
    const deadline = Date.now() + 15_000;
    while (caughtUpAt.size < shops.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    stop.abort();
    const stats = await Promise.all(lanes);

    expect(caughtUpAt.size).toBe(shops.size);
    for (const [id, m] of shops) {
      const cur = cursors.cursors.get(`${id}/orders`)!.cursorAt;
      for (const r of m.rows.values()) {
        if (r.t < cur) expect(cursors.sink.get(`${id}:${r.id}`)?.version, `${id} ${r.id}`).toBe(r.version);
      }
    }
    for (let i = 0; i < 4; i++) expect(caughtUpAt.get(`small${i}`)!).toBeLessThan(caughtUpAt.get("big")!);
    expect(big.rateLimited).toBeGreaterThan(0);
    expect(deferred).toBe(big.rateLimited);
    expect(stats.reduce((a, s) => a + s.lost, 0)).toBe(0);
  });
});
