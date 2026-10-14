// ============================================================
// TRỢ LÝ HỎI ĐÁP trên DB dev: các bộ nạp cộng từ đơn mà Trợ lý dùng phải cho
// cùng số với đường cũ kéo đơn (pnl-rows-oracle.ts), trên DỮ LIỆU THẬT của DB dev:
//   · tiền đơn chưa quyết toán ("tiền đang ở đâu");
//   · đơn lỗ trên tập đơn tính doanh thu.
// Báo cáo kỳ (buildPeriodReport) đọc loadOverviewTotals — đã so ở
// overview-ledger-db.test.ts; phép so nguyên câu trả lời hai nguồn bỏ 14/10/2026
// cùng đường cũ. (docs/SO-CAI-DON.md mục 9.6). Chưa áp migration sổ cái → BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { parseDateRange } from "../../lib/date-range";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { countsAsRevenue } from "../../lib/finance-definitions";
import { lossOrdersFromRows, openCashTotalsFromRows } from "../../lib/finance-views";
import { loadLossOrders, loadOpenCashTotals } from "../../routes/finance";
import { OPEN_CASH_WHERE, fetchPnlRows } from "./pnl-rows-oracle";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[assistant-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

const near = (x: number, y: number) => Math.abs(x - y) <= 1;
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function owners(): Promise<string[]> {
  const ids = (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId);
  for (const userId of ids) {
    const fresh = await ensureLedgerFresh({ userId }, undefined, { maxInline: 20_000 });
    expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);
  }
  return ids;
}

describe.skipIf(!ledgerReady)("Trợ lý hỏi đáp — sổ cái = kéo đơn trên DB dev", () => {
  it("tiền đơn chưa quyết toán của đơn tính doanh thu: tổng + số đơn đang giao / chờ đối soát", { timeout: 180_000 }, async () => {
    for (const userId of await owners()) {
      const [a, raw] = await Promise.all([
        loadOpenCashTotals({ userId }),
        fetchPnlRows({ userId }, undefined, { lean: true, where: OPEN_CASH_WHERE }),
      ]);
      if (raw.truncated) continue;
      const b = openCashTotalsFromRows(raw.rows);
      expect(a.inTransitCount, `${userId} số đơn đang giao`).toBe(b.inTransitCount);
      expect(a.pendingCount, `${userId} số đơn chờ đối soát`).toBe(b.pendingCount);
      expect(near(a.inTransit, b.inTransit), `${userId} tiền đang giao`).toBe(true);
      expect(near(a.pendingSettle, b.pendingSettle), `${userId} tiền chờ đối soát`).toBe(true);
    }
  });

  it("đơn lỗ trên tập đơn TÍNH DOANH THU: số đơn, tổng lỗ, 3 đơn nặng nhất", { timeout: 180_000 }, async () => {
    for (const userId of await owners()) {
      for (const days of [30, 365]) {
        const range = parseDateRange({ from: day(days), to: day(0) });
        const [a, raw] = await Promise.all([
          loadLossOrders({ userId }, range, 3, "active"),
          fetchPnlRows({ userId }, range, { lean: true }),
        ]);
        if (raw.truncated) continue;
        const b = lossOrdersFromRows(raw.rows.filter(countsAsRevenue), 3);
        const tag = `${userId} ${days} ngày`;
        expect(a.analyzedCount, `${tag} số đơn soát`).toBe(b.analyzedCount);
        expect(a.lossCount, `${tag} số đơn lỗ`).toBe(b.lossCount);
        expect(near(a.totalLoss, b.totalLoss), `${tag} tổng lỗ`).toBe(true);
        expect(a.items.map((i) => Math.round(i.profitAfterTax)), `${tag} 3 đơn nặng nhất`).toEqual(
          b.items.map((i) => Math.round(i.profitAfterTax))
        );
      }
    }
  });
});
