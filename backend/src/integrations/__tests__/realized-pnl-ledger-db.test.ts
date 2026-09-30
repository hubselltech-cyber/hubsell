// ============================================================
// LÃI/LỖ THỰC HIỆN trên DB dev: đường sổ cái (lọc + cắt trang + cộng TRONG
// database) phải cho cùng kết quả với đường cũ (kéo cả kỳ, lọc/cắt bằng JS)
// trên DỮ LIỆU THẬT của DB dev: cùng danh sách đơn theo đúng thứ tự, cùng tổng
// kết, với mọi bộ lọc của bảng; đọc theo con trỏ ra đủ và đúng thứ tự.
// Prod so bằng ?source=orders|ledger (docs/SO-CAI-DON.md mục 9.3).
// Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { parseDateRange } from "../../lib/date-range";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { loadRealizedPnl } from "../../routes/finance";
import {
  parsePnlCursor,
  type LedgerPnlFilter,
  type PnlSummaryTotals,
} from "../../lib/realized-pnl-totals";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[realized-pnl-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

const near = (x: number, y: number) => Math.abs(x - y) <= 1; // tiền VND nguyên, sổ làm tròn 2 số lẻ từng dòng

function expectSameTotals(a: PnlSummaryTotals, b: PnlSummaryTotals, label: string, daySince: string) {
  for (const k of ["count", "settledCount", "returnCount", "missingCostCount"] as const) {
    expect(a[k], `${label} ${k}`).toBe(b[k]);
  }
  for (const k of ["netRevenue", "refundedAmount", "revenueGross", "platformTax", "profitWithCost", "missingCostExcludedProfit"] as const) {
    expect(near(a[k], b[k]), `${label} ${k}: sổ ${a[k]} ≠ đơn ${b[k]}`).toBe(true);
  }
  for (const k of ["costLoss", "platformKept", "refundLoss"] as const) {
    expect(near(a.returnLoss[k], b.returnLoss[k]), `${label} returnLoss.${k}`).toBe(true);
  }
  expect([...a.byPlatform.keys()].sort(), `${label} sàn`).toEqual([...b.byPlatform.keys()].sort());
  for (const [k, v] of a.byPlatform) {
    const w = b.byPlatform.get(k)!;
    expect(v.count, `${label} sàn ${k} count`).toBe(w.count);
    expect(v.returnCount, `${label} sàn ${k} returnCount`).toBe(w.returnCount);
    expect(near(v.profit, w.profit), `${label} sàn ${k} profit`).toBe(true);
    expect(near(v.returnLoss, w.returnLoss), `${label} sàn ${k} returnLoss`).toBe(true);
  }
  // Chuỗi ngày: đường sổ chỉ trả từ mốc daySince.
  const days = new Set([...a.byDay.keys(), ...[...b.byDay.keys()].filter((d) => d >= daySince)]);
  for (const d of days) {
    const x = a.byDay.get(d);
    const y = b.byDay.get(d);
    expect(x?.orderCount ?? 0, `${label} ngày ${d} orderCount`).toBe(y?.orderCount ?? 0);
    expect(x?.returnCount ?? 0, `${label} ngày ${d} returnCount`).toBe(y?.returnCount ?? 0);
    expect(near(x?.profit ?? 0, y?.profit ?? 0), `${label} ngày ${d} profit`).toBe(true);
    expect(near(x?.returnLoss ?? 0, y?.returnLoss ?? 0), `${label} ngày ${d} returnLoss`).toBe(true);
  }
}

describe.skipIf(!ledgerReady)("Lãi/Lỗ thực hiện — sổ cái = kéo đơn trên DB dev", () => {
  it("mọi chủ shop × bộ lọc: cùng danh sách (đúng thứ tự), cùng tổng kết; con trỏ đọc đủ", { timeout: 300_000 }, async () => {
    const owners = (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId);
    expect(owners.length).toBeGreaterThan(0);
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const range = parseDateRange({ from: day(90), to: day(0) });
    const daySince = day(60);
    let compared = 0;
    let searched = 0;
    for (const userId of owners) {
      const scope = { userId };
      const fresh = await ensureLedgerFresh(scope, undefined, { maxInline: 20_000 });
      expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);

      // Chuỗi tìm lấy từ một mã đơn THẬT của shop (đoạn giữa, chữ thường).
      const sample = await prisma.order.findFirst({
        where: { channel: scope, createdAt: range },
        orderBy: { createdAt: "desc" },
        select: { orderCode: true },
      });
      const fragment = sample && sample.orderCode.length >= 8 ? sample.orderCode.slice(2, 8).toLowerCase() : "";

      const filters: { name: string; f: LedgerPnlFilter }[] = [
        { name: "không lọc", f: {} },
        { name: "Đã giao", f: { shippingStatus: ShippingStatus.DELIVERED } },
        { name: "Đã hủy", f: { shippingStatus: ShippingStatus.CANCELLED } },
        { name: "Hoàn/Trả", f: { returnsOnly: true } },
        { name: "Lợi nhuận âm", f: { lossOnly: true } },
        { name: "Đã giao + lỗ", f: { shippingStatus: ShippingStatus.DELIVERED, lossOnly: true } },
        ...(fragment ? [{ name: `tìm "${fragment}"`, f: { search: fragment } }] : []),
        { name: "tìm ký tự đại diện", f: { search: "%_" } },
      ];
      for (const { name, f } of filters) {
        const label = `${userId} [${name}]`;
        for (const page of [1, 2]) {
          const opts = { page, pageSize: 20, byDaySince: daySince };
          const [ledger, orders] = await Promise.all([
            loadRealizedPnl("ledger", scope, range, f, opts),
            loadRealizedPnl("orders", scope, range, f, opts),
          ]);
          if (orders.truncated) continue;
          expect(ledger.rows.map((r) => r.id), `${label} trang ${page}: danh sách`).toEqual(orders.rows.map((r) => r.id));
          expect(ledger.rows.map((r) => r.profitAfterTax), `${label} trang ${page}: lợi nhuận từng dòng`).toEqual(orders.rows.map((r) => r.profitAfterTax));
          expect(ledger.nextCursor === null, `${label} trang ${page}: còn trang sau`).toBe(orders.nextCursor === null);
          expectSameTotals(ledger.totals!, orders.totals!, `${label} trang ${page}`, daySince);
          compared += 1;
        }
        if (f.search && f.search === fragment) {
          const hit = await loadRealizedPnl("ledger", scope, range, f, { page: 1, pageSize: 20 });
          expect(hit.totals!.count, `${label}: phải tìm thấy ít nhất đơn mẫu`).toBeGreaterThan(0);
          for (const r of hit.rows) expect(r.orderCode.toLowerCase()).toContain(fragment);
          searched += 1;
        }
      }

      // ĐỌC THEO CON TRỎ (xuất Excel): gom đủ, đúng thứ tự, không trùng — so với đường cũ một lượt.
      const all = await loadRealizedPnl("orders", scope, range, {}, { page: 1, pageSize: 100_000, rowsOnly: true });
      if (!all.truncated) {
        const ids: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 2_000; guard++) {
          const pageData = await loadRealizedPnl("ledger", scope, range, {}, {
            page: 1,
            pageSize: 100,
            rowsOnly: true,
            cursor: parsePnlCursor(cursor),
          });
          expect(pageData.totals).toBeNull();
          ids.push(...pageData.rows.map((r) => r.id));
          cursor = pageData.nextCursor;
          if (!cursor) break;
        }
        expect(ids.length, `${userId} con trỏ: số đơn`).toBe(all.rows.length);
        expect(new Set(ids).size, `${userId} con trỏ: không trùng`).toBe(ids.length);
        expect(ids, `${userId} con trỏ: thứ tự`).toEqual(all.rows.map((r) => r.id));
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(searched).toBeGreaterThan(0);
  });

  it("chỉ mục tìm mã đơn và chỉ mục danh sách đã có trên sổ", async () => {
    const idx = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'order_ledger'
    `;
    const trgm = idx.find((i) => i.indexname === "order_ledger_orderCode_trgm_idx");
    expect(trgm, "thiếu chỉ mục GIN trigram — áp migration 20260930240000_order_ledger_list_indexes").toBeTruthy();
    expect(trgm!.indexdef).toMatch(/USING gin/i);
    expect(trgm!.indexdef).toMatch(/gin_trgm_ops/);
    expect(idx.some((i) => i.indexname === "order_ledger_ownerId_createdAt_idx")).toBe(true);
  });
});
