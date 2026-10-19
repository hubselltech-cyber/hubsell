// ============================================================
// THUÊ BAO trên Postgres (sync_cursors): hai tiến trình nhặt cùng lúc không
// trùng việc (SKIP LOCKED), thuê bao hết hạn được nhặt lại, nhịp tim của bên
// mất thuê bao báo mất, trả việc của bên mất là no-op. Chưa áp migration
// 20261019100000_sync_cursors → tự BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import { enrollStream, leaseKey, pgLeaseStore } from "../../services/sync-lanes";

const ready: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('sync_cursors')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ready) console.log("[sync-lanes-db.test] BỎ QUA: DB dev chưa có bảng sync_cursors");

describe.skipIf(!ready)("thuê bao Postgres", () => {
  let fx: StockFixture;
  const LANE = `test-lane-${Date.now()}`;
  beforeAll(async () => {
    fx = await createStockFixture("lanes");
    for (let i = 0; i < 10; i++) {
      await enrollStream(fx.channelId, `s${i}`, "orders", new Date(Date.UTC(2026, 9, 1)), 60_000);
    }
    await prisma.syncCursor.updateMany({ where: { channelId: fx.channelId }, data: { lane: LANE, dueAt: new Date(Date.now() - 1000) } });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("hai tiến trình nhặt song song: không trùng, đủ 10 việc", async () => {
    const [a, b] = await Promise.all([
      pgLeaseStore.claim(LANE, 6, "wA", 60_000),
      pgLeaseStore.claim(LANE, 6, "wB", 60_000),
    ]);
    const keys = [...a, ...b].map(leaseKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(10);
    expect(await pgLeaseStore.claim(LANE, 5, "wC", 60_000)).toEqual([]);
  });

  it("thuê bao hết hạn → bên khác nhặt lại; nhịp tim + trả việc của bên cũ là no-op", async () => {
    const item = { channelId: fx.channelId, stream: "s0", lane: LANE };
    await prisma.syncCursor.update({
      where: { channelId_stream: { channelId: fx.channelId, stream: "s0" } },
      data: { leaseOwner: "wOld", leaseUntil: new Date(Date.now() - 1000) },
    });
    const got = await pgLeaseStore.claim(LANE, 10, "wNew", 60_000);
    expect(got.map(leaseKey)).toEqual([leaseKey(item)]);
    expect((await pgLeaseStore.heartbeat([item], "wOld", 60_000)).size).toBe(0);
    expect((await pgLeaseStore.heartbeat([item], "wNew", 60_000)).has(leaseKey(item))).toBe(true);
    await pgLeaseStore.release(item, "wOld", new Date(0));
    const row = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: fx.channelId, stream: "s0" } } });
    expect(row!.leaseOwner).toBe("wNew");
    const due = new Date(Date.now() + 3_600_000);
    await pgLeaseStore.release(item, "wNew", due);
    const after = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: fx.channelId, stream: "s0" } } });
    expect(after!.leaseOwner).toBeNull();
    expect(after!.dueAt.getTime()).toBe(due.getTime());
  });

  it("chưa tới hạn thì không nhặt; dueAt sớm nhất ra trước", async () => {
    await prisma.syncCursor.updateMany({ where: { channelId: fx.channelId }, data: { leaseOwner: null, leaseUntil: null, dueAt: new Date(Date.now() + 3_600_000) } });
    await prisma.syncCursor.update({ where: { channelId_stream: { channelId: fx.channelId, stream: "s7" } }, data: { dueAt: new Date(Date.now() - 5_000) } });
    await prisma.syncCursor.update({ where: { channelId_stream: { channelId: fx.channelId, stream: "s3" } }, data: { dueAt: new Date(Date.now() - 9_000) } });
    // Một suất → chọn việc tới hạn SỚM NHẤT (thứ tự RETURNING không bảo đảm nên kiểm theo suất).
    expect((await pgLeaseStore.claim(LANE, 1, "w", 60_000)).map((g) => g.stream)).toEqual(["s3"]);
    expect((await pgLeaseStore.claim(LANE, 10, "w", 60_000)).map((g) => g.stream)).toEqual(["s7"]);
  });
});
