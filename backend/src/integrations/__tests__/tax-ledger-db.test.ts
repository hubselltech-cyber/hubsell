// ============================================================
// THUẾ trên DB dev: đường sổ cái (SUM/GROUP BY trong database) phải cho cùng
// kết quả với đường cũ (kéo đơn, gom bằng JS) trên DỮ LIỆU THẬT của DB dev:
//   · đối soát kỳ (/api/tax/report) — theo ngày tạo đơn;
//   · bảng kê khai theo sàn + lũy kế năm (/api/tax/declaration) — CẢ HAI cơ sở
//     cắt kỳ: theo ngày sàn báo giao (TAX_DECLARATION_BY_DELIVERED=1, prod) và
//     theo ngày tạo đơn.
// (docs/SO-CAI-DON.md mục 9.4). Đường cũ nay chỉ còn ở pnl-rows-oracle.ts (gỡ khỏi route 14/10/2026).
// Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { ensureParityDataset } from "./parity-seed";
import { parseDateRange } from "../../lib/date-range";
import { ensureLedgerFresh, ledgerFreshness } from "../../services/order-ledger";
import { taxReportTotalsFromRows } from "../../lib/tax-totals";
import { loadTaxReportTotals } from "../../routes/tax";
import {
  buildTaxDeclaration,
  loadDeclarationRows,
  periodRange,
  sumRows,
  type DeclarationPeriod,
} from "../../services/tax-declaration";
import { declarationRowsFromOrders, fetchPnlRows } from "./pnl-rows-oracle";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    if (r[0]?.r == null) return false;
  } catch {
    return false;
  }
  // DB mới dựng từ migration (không có đơn) → dựng bộ đơn mẫu để phép so có nghĩa
  // (parity-seed.ts). Dựng lỗi thì ném ra cho file đỏ, không im lặng bỏ qua.
  await ensureParityDataset();
  return true;
})();
if (!ledgerReady) {
  console.log("[tax-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

const near = (x: number, y: number) => Math.abs(x - y) <= 1; // tiền VND nguyên, sổ làm tròn 2 số lẻ từng dòng
const ORIGINAL_BASIS = process.env.TAX_DECLARATION_BY_DELIVERED;

describe.skipIf(!ledgerReady)("Thuế — sổ cái = kéo đơn trên DB dev", () => {
  afterAll(() => {
    if (ORIGINAL_BASIS === undefined) delete process.env.TAX_DECLARATION_BY_DELIVERED;
    else process.env.TAX_DECLARATION_BY_DELIVERED = ORIGINAL_BASIS;
  });

  async function owners(): Promise<string[]> {
    const ids = (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId);
    for (const userId of ids) {
      // DB dev không có worker chạy nền → làm tươi toàn bộ trước khi so.
      const fresh = await ensureLedgerFresh({ userId }, undefined, { maxInline: 20_000 });
      expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);
    }
    return ids;
  }

  it("đối soát kỳ: mọi chủ shop × cả kỳ / 90 ngày / 7 ngày", { timeout: 180_000 }, async () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const ranges = [
      { label: "cả kỳ", range: undefined },
      { label: "90 ngày", range: parseDateRange({ from: day(90), to: day(0) }) },
      { label: "7 ngày", range: parseDateRange({ from: day(7), to: day(0) }) },
    ];
    let compared = 0;
    for (const userId of await owners()) {
      for (const { label, range } of ranges) {
        const [ledger, raw] = await Promise.all([
          loadTaxReportTotals({ userId }, range),
          fetchPnlRows({ userId }, range, { lean: true }),
        ]);
        if (raw.truncated) continue;
        expect(ledger.ledgerPending).toBe(0);
        const a = ledger.totals as unknown as Record<string, number>;
        const b = taxReportTotalsFromRows(raw.rows) as unknown as Record<string, number>;
        for (const k of ["orderCount", "settledCount", "missingCostCount"]) {
          expect(a[k], `${userId} ${label} ${k}`).toBe(b[k]);
        }
        for (const k of ["grossRevenue", "profitWithCost", "platformTaxActual", "unsettledPlatformRevenue", "missingCostExcludedProfit"]) {
          expect(near(a[k], b[k]), `${userId} ${label} ${k}: sổ ${a[k]} ≠ đơn ${b[k]}`).toBe(true);
        }
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  for (const basis of ["delivered", "created"] as const) {
    it(`bảng kê khai cắt theo ${basis === "delivered" ? "NGÀY GIAO" : "ngày tạo"}: mọi chủ shop × 4 quý + cả năm, kèm lũy kế năm`, { timeout: 300_000 }, async () => {
      if (basis === "delivered") process.env.TAX_DECLARATION_BY_DELIVERED = "1";
      else delete process.env.TAX_DECLARATION_BY_DELIVERED;

      const year = new Date().getUTCFullYear();
      const periods: DeclarationPeriod[] = [
        { year, quarter: 1 }, { year, quarter: 2 }, { year, quarter: 3 }, { year, quarter: 4 }, { year, quarter: null },
        { year: year - 1, quarter: null },
      ];
      let compared = 0;
      let nonEmpty = 0;
      for (const userId of await owners()) {
        const scope = { userId };
        for (const period of periods) {
          const label = `${userId} ${basis} ${period.year}-${period.quarter ?? "năm"}`;
          const range = periodRange(period);
          const [ledger, orders] = await Promise.all([
            loadDeclarationRows(scope, range),
            declarationRowsFromOrders(scope, range),
          ]);
          if (orders.truncated) continue;
          expect(ledger.missingDeliveredAt, `${label} missingDeliveredAt`).toBe(orders.missingDeliveredAt);
          expect(ledger.rows.map((r) => r.channelName), `${label} sàn`).toEqual(orders.rows.map((r) => r.channelName));
          for (let i = 0; i < orders.rows.length; i++) {
            const a = ledger.rows[i] as unknown as Record<string, number | string>;
            const b = orders.rows[i] as unknown as Record<string, number | string>;
            for (const k of ["orderCount", "settledCount", "unsettledCount"]) {
              expect(a[k], `${label} ${b.channelName} ${k}`).toBe(b[k]);
            }
            for (const k of ["grossRevenue", "sellerVoucher", "refundedAmount", "taxableRevenue", "unsettledTaxableRevenue", "taxWithheldActual", "taxWithheldEstimated"]) {
              expect(near(a[k] as number, b[k] as number), `${label} ${b.channelName} ${k}: sổ ${a[k]} ≠ đơn ${b[k]}`).toBe(true);
            }
          }
          if (orders.rows.length > 0) nonEmpty += 1;

          // Kết quả trang (tổng + lũy kế năm) so với tổng gom từ đơn gốc; tách
          // GTGT/TNCN và bậc ngưỡng là hàm thuần trên các tổng này (test lib/tax-totals).
          const full = await buildTaxDeclaration(userId, scope, period, new Date());
          const oldTotal = sumRows(orders.rows);
          const oldAnnual = await declarationRowsFromOrders({ userId }, periodRange({ year: period.year, quarter: null }));
          if (oldAnnual.truncated) continue;
          expect(full.ledgerPending).toBe(0);
          expect(full.basis).toBe(basis);
          expect(near(full.total.taxableRevenue, oldTotal.taxableRevenue), `${label} tổng doanh thu tính thuế`).toBe(true);
          expect(near(full.total.taxWithheldActual, oldTotal.taxWithheldActual), `${label} tổng đã khấu trừ`).toBe(true);
          expect(near(full.annual.taxableRevenueToDate, sumRows(oldAnnual.rows).taxableRevenue), `${label} lũy kế năm`).toBe(true);
          expect(full.total.orderCount, `${label} tổng số đơn`).toBe(oldTotal.orderCount);
          compared += 1;
        }
      }
      expect(compared).toBeGreaterThan(0);
      expect(nonEmpty, "DB dev phải có ít nhất một kỳ có đơn để phép so có nghĩa").toBeGreaterThan(0);
    });
  }

  it("kiểm sổ tươi: đếm dòng bẩn và dòng công thức cũ bằng hai câu riêng vẫn ra đúng 0 khi sổ sạch", async () => {
    const [first] = await owners();
    const f = await ledgerFreshness({ userId: first });
    expect(f).toEqual({ dirty: 0, staleVersion: 0 });
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'order_ledger'
    `;
    const names = idx.map((i) => i.indexname);
    expect(names, "thiếu chỉ mục — áp migration 20260930250000_order_ledger_tax_indexes").toContain("order_ledger_ownerId_deliveredDate_idx");
    expect(names).toContain("order_ledger_formulaVersion_idx");
  });
});
