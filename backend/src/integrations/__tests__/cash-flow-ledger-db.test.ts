// ============================================================
// BÁO CÁO DÒNG TIỀN trên DB dev: đường sổ cái (SUM trong database) phải cho
// cùng bộ tổng với đường cũ (kéo đơn, cộng JS) trên DỮ LIỆU THẬT của DB dev —
// mọi chủ shop có gian, cả kỳ và 60 ngày gần nhất. Đây là phép so mà prod chạy
// bằng ?source=orders|ledger (docs/SO-CAI-DON.md mục 9).
// Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { parseDateRange } from "../../lib/date-range";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { loadCashFlowTotals } from "../../routes/finance";
import type { CashFlowTotals } from "../../lib/cash-flow-totals";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[cash-flow-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

function expectSameTotals(a: CashFlowTotals, b: CashFlowTotals, label: string) {
  const groups = ["cancelled", "returning", "active", "settled", "pending", "delivered"] as const;
  expect(a.orderCount, `${label} orderCount`).toBe(b.orderCount);
  for (const g of groups) {
    const ga = a[g] as Record<string, number>;
    const gb = b[g] as Record<string, number>;
    for (const k of Object.keys(ga)) {
      // Sổ làm tròn 2 số lẻ từng dòng; lệch cho phép 0,5 đồng × số đơn là quá rộng
      // nên siết còn 1 đồng cho cả nhóm (tiền VND nguyên).
      expect(Math.abs(ga[k] - gb[k]), `${label} ${g}.${k}: sổ ${ga[k]} ≠ đơn ${gb[k]}`).toBeLessThanOrEqual(1);
    }
  }
  for (const m of ["gmvMaxByChannelId", "cogsByChannelName"] as const) {
    expect([...a[m].keys()].sort(), `${label} ${m} keys`).toEqual([...b[m].keys()].sort());
    for (const [k, v] of a[m]) expect(Math.abs(v - b[m].get(k)!), `${label} ${m}.${k}`).toBeLessThanOrEqual(1);
  }
  // Chuỗi ngày: đường sổ chỉ trả 14 ngày gần nhất → so trên đúng các ngày đó.
  for (const m of ["revenueByDay", "cogsByDay"] as const) {
    for (const [k, v] of a[m]) expect(Math.abs(v - (b[m].get(k) ?? 0)), `${label} ${m}.${k}`).toBeLessThanOrEqual(1);
  }
}

describe.skipIf(!ledgerReady)("Báo cáo dòng tiền — sổ cái = kéo đơn trên DB dev", () => {
  it("mọi chủ shop, cả kỳ và 60 ngày gần nhất", { timeout: 120_000 }, async () => {
    const owners = (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId);
    expect(owners.length).toBeGreaterThan(0);
    const now = new Date();
    const from = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const ranges: { label: string; range: ReturnType<typeof parseDateRange> }[] = [
      { label: "cả kỳ", range: undefined },
      { label: "60 ngày", range: parseDateRange({ from, to }) },
    ];
    let compared = 0;
    for (const userId of owners) {
      const scope = { userId };
      for (const { label, range } of ranges) {
        // Sổ phải tươi trước khi so (DB dev không có worker chạy nền).
        const fresh = await ensureLedgerFresh(scope, range, { maxInline: 20_000 });
        expect(fresh.dirty, `${userId} ${label} còn dòng bẩn`).toBe(0);
        const [ledger, orders] = await Promise.all([
          loadCashFlowTotals("ledger", scope, range),
          loadCashFlowTotals("orders", scope, range),
        ]);
        if (orders.truncated) continue; // đường cũ chạm phanh 20.000 thì số của nó là cận dưới, không so
        expect(ledger.ledgerPending).toBe(0);
        expectSameTotals(ledger.totals, orders.totals, `${userId} ${label}`);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
