// ============================================================
// TỔNG QUAN trên DB dev: đường sổ cái (SUM/GROUP BY trong database) phải cho
// cùng bộ tổng với đường cũ (kéo đơn, cộng JS) trên DỮ LIỆU THẬT của DB dev —
// mọi chủ shop có gian; cả kỳ, 60 ngày và 7 ngày gần nhất. Prod so bằng
// ?source=orders|ledger (docs/SO-CAI-DON.md mục 9.2).
// Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { parseDateRange } from "../../lib/date-range";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { loadOverviewTotals } from "../../routes/analytics";
import type { OverviewTotals } from "../../lib/overview-totals";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[overview-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

const near = (x: number, y: number) => Math.abs(x - y) <= 1; // tiền VND nguyên, sổ làm tròn 2 số lẻ từng dòng

function expectSameTotals(a: OverviewTotals, b: OverviewTotals, label: string, daySince?: string) {
  const ga = a.active as unknown as Record<string, number>;
  const gb = b.active as unknown as Record<string, number>;
  for (const k of Object.keys(ga)) expect(near(ga[k], gb[k]), `${label} active.${k}: sổ ${ga[k]} ≠ đơn ${gb[k]}`).toBe(true);
  expect([...a.byChannelId.keys()].sort(), `${label} gian`).toEqual([...b.byChannelId.keys()].sort());
  for (const [k, v] of a.byChannelId) {
    const w = b.byChannelId.get(k)!;
    expect(v.count, `${label} gian ${k} count`).toBe(w.count);
    expect(near(v.revenueGross, w.revenueGross), `${label} gian ${k} revenue`).toBe(true);
    expect(near(v.feeGmvMax, w.feeGmvMax), `${label} gian ${k} gmv`).toBe(true);
  }
  // Chuỗi ngày: đường sổ chỉ trả từ mốc daySince → so trên các ngày ≥ mốc của cả hai phía.
  const days = new Set([...a.byDay.keys(), ...[...b.byDay.keys()].filter((d) => !daySince || d >= daySince)]);
  for (const d of days) {
    const x = a.byDay.get(d);
    const y = b.byDay.get(d);
    expect(x?.count ?? 0, `${label} ngày ${d} count`).toBe(y?.count ?? 0);
    expect(near(x?.revenueGross ?? 0, y?.revenueGross ?? 0), `${label} ngày ${d} revenue`).toBe(true);
    expect(near(x?.costSnapshot ?? 0, y?.costSnapshot ?? 0), `${label} ngày ${d} cogs`).toBe(true);
    expect(near(x?.platformDeduction ?? 0, y?.platformDeduction ?? 0), `${label} ngày ${d} deduction`).toBe(true);
  }
}

describe.skipIf(!ledgerReady)("Tổng quan — sổ cái = kéo đơn trên DB dev", () => {
  it("mọi chủ shop: cả kỳ, 60 ngày, 7 ngày; kèm tổng-không-bóc của kỳ trước", { timeout: 180_000 }, async () => {
    const owners = (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId);
    expect(owners.length).toBeGreaterThan(0);
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const cases: { label: string; range: ReturnType<typeof parseDateRange>; daySince?: string }[] = [
      { label: "cả kỳ", range: undefined, daySince: day(13) },
      { label: "60 ngày", range: parseDateRange({ from: day(60), to: day(0) }), daySince: day(60) },
      { label: "7 ngày", range: parseDateRange({ from: day(7), to: day(0) }), daySince: day(7) },
    ];
    let compared = 0;
    for (const userId of owners) {
      const scope = { userId };
      // DB dev không có worker chạy nền → làm tươi toàn bộ trước khi so.
      const fresh = await ensureLedgerFresh(scope, undefined, { maxInline: 20_000 });
      expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);
      for (const c of cases) {
        const [ledger, orders] = await Promise.all([
          loadOverviewTotals("ledger", scope, c.range, { byDaySince: c.daySince, fresh: { range: c.range } }),
          loadOverviewTotals("orders", scope, c.range),
        ]);
        if (orders.truncated) continue; // đường cũ chạm phanh 20.000 → số của nó là cận dưới
        expect(ledger.ledgerPending).toBe(0);
        expectSameTotals(ledger.totals, orders.totals, `${userId} ${c.label}`, c.daySince);
        // summaryOnly (đường kỳ trước): tổng giữ nguyên, không có bảng bóc.
        const light = await loadOverviewTotals("ledger", scope, c.range, { summaryOnly: true });
        expect(light.totals.active.count).toBe(ledger.totals.active.count);
        expect(light.totals.byDay.size).toBe(0);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
