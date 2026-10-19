// ============================================================
// KHO CON TRỎ POSTGRES (sync_cursors) — TEST TÍCH HỢP trên DB dev:
// con trỏ tiến CÙNG giao dịch với trang cuối; ghi trang lỗi → con trỏ đứng yên;
// xóa gian kéo theo con trỏ. Chưa áp migration 20261019100000_sync_cursors →
// tự BỎ QUA (npx tsx scripts/apply-migration-local.ts 20261019100000_sync_cursors).
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import { prismaCursorStore, readByCursor, type StreamSpec } from "../../services/cursor-reader";
import { FakeMarketplace, type FakeRow } from "../../services/__tests__/fake-marketplace";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 1);

const ready: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('sync_cursors')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ready) console.log("[cursor-reader-db.test] BỎ QUA: DB dev chưa có bảng sync_cursors");

describe.skipIf(!ready)("kho con trỏ Postgres", () => {
  let fx: StockFixture;
  beforeAll(async () => {
    fx = await createStockFixture("cursor");
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  const spec = (m: FakeMarketplace, stream: string, persist: (rows: FakeRow[], tx: Prisma.TransactionClient) => Promise<void>) =>
    ({
      channelId: fx.channelId,
      stream,
      maxWindowMs: 15 * DAY,
      initialCursorAt: () => T0,
      fetchPage: (w, t) => m.fetchPage(w, t),
      rowKey: (r) => r.id,
      persist,
    }) satisfies StreamSpec<FakeRow, Prisma.TransactionClient>;

  it("đọc tới đuổi kịp: con trỏ + cửa sổ đã học nằm trong DB, lượt sau đọc tiếp từ đó", async () => {
    const m = new FakeMarketplace(T0 + DAY + 10 * MIN, { pageSize: 50 });
    m.seed(400, T0, T0 + DAY);
    const seen = new Set<string>();
    const s = spec(m, "orders", async (rows, tx) => {
      // chạm DB trong cùng tx để chắc tx thật được dùng
      await tx.$queryRaw`SELECT 1`;
      for (const r of rows) seen.add(r.id);
    });
    const r = await readByCursor(s, prismaCursorStore, { now: () => m.clock });
    expect(r.status).toBe("caught_up");
    expect(seen.size).toBe(400);
    const row = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: fx.channelId, stream: "orders" } } });
    expect(row?.cursorAt.getTime()).toBe(r.cursorAt);
    expect(row?.windowMs).toBe(r.windowMs);
    expect(row?.lastStatus).toBe("caught_up");
  });

  it("ghi trang lỗi → giao dịch hoàn tác, con trỏ KHÔNG vượt dòng sớm nhất chưa ghi được", async () => {
    const m = new FakeMarketplace(T0 + DAY + 10 * MIN, { pageSize: 500 });
    m.seed(100, T0, T0 + DAY);
    const s = spec(m, "returns", async () => {
      throw new Error("ghi dòng lỗi (giả)");
    });
    await expect(readByCursor(s, prismaCursorStore, { now: () => m.clock })).rejects.toThrow("ghi dòng lỗi");
    // Cửa sổ trống đầu ngày được phép tiến; cửa sổ chứa dòng đầu tiên thì không.
    const earliest = Math.min(...[...m.rows.values()].map((r) => r.t));
    const row = await prisma.syncCursor.findUnique({ where: { channelId_stream: { channelId: fx.channelId, stream: "returns" } } });
    expect(row == null || row.cursorAt.getTime() <= earliest).toBe(true);
  });

  it("xóa gian → con trỏ đi theo (khóa ngoại CASCADE)", async () => {
    const other = await createStockFixture("cursor-del");
    await prisma.syncCursor.create({ data: { channelId: other.channelId, stream: "orders", cursorAt: new Date(T0), windowMs: MIN } });
    await other.cleanup();
    expect(await prisma.syncCursor.count({ where: { channelId: other.channelId } })).toBe(0);
  });
});
