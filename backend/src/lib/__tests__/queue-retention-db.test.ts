// ============================================================
// Migration 20261028220000_pgboss_evt_order_retention_1d trên DB dev: evt.order
// giữ việc đã xong 1 ngày (deletion_seconds 86400), hàng đợi khác giữ 7 ngày như
// cũ; bảng riêng của evt.order có chỉ mục `WHERE state='active'` để hai câu
// failJobsBy* của pg-boss khỏi quét cả bảng. Chưa có schema pgboss → BỎ QUA.
// ============================================================

import "../../integrations/__tests__/load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";

const EVT_ORDER_TABLE_SQL = `'j' || encode(sha224('evt.order'::bytea), 'hex')`;

const ready: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('pgboss.queue')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ready) console.log("[queue-retention-db.test] BỎ QUA: DB dev chưa có schema pgboss");

describe.skipIf(!ready)("evt.order giữ việc đã xong 1 ngày", () => {
  it("pgboss.queue: evt.order 86400, hàng đợi khác giữ mặc định 604800", async () => {
    const rows = await prisma.$queryRaw<{ name: string; deletion_seconds: number }[]>`
      SELECT name, deletion_seconds FROM pgboss.queue ORDER BY name`;
    const byName = new Map(rows.map((r) => [r.name, Number(r.deletion_seconds)]));
    expect(byName.get("evt.order")).toBe(86400);
    for (const [name, s] of byName) if (name !== "evt.order") expect(s, name).toBe(604800);
  });

  it("bảng riêng evt.order có chỉ mục (name) WHERE state='active'", async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'pgboss'
         AND tablename = ${EVT_ORDER_TABLE_SQL} AND indexname = ${EVT_ORDER_TABLE_SQL} || '_hs'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/USING btree \(name\) WHERE \(state = 'active'::pgboss\.job_state\)/);
  });

  it("việc đã xong trong 1 ngày gần nhất không còn dòng nào mang hạn 7 ngày", async () => {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM pgboss.job
        WHERE name = 'evt.order' AND state > 'active' AND deletion_seconds > 86400
          AND completed_on >= now() - interval '1 day'`
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
