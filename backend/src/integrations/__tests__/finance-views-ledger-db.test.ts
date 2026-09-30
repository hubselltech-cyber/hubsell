// ============================================================
// ĐƠN LỖ / DÒNG TIỀN THEO GIAN / LÃI-LỖ THEO SKU trên DB dev: đường sổ cái
// (SQL trên order_ledger + order_line_ledger) phải cho cùng kết quả với đường
// cũ (kéo đơn, cộng JS) trên DỮ LIỆU THẬT của DB dev — mọi chủ shop.
// Prod so bằng ?source=orders|ledger (docs/SO-CAI-DON.md mục 9.5).
// Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { parseDateRange } from "../../lib/date-range";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { loadLossOrders, loadOpenCash, loadSkuAgg } from "../../routes/finance";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[finance-views-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger");
}

const near = (x: number, y: number, tol = 1) => Math.abs(x - y) <= tol;

async function owners(): Promise<string[]> {
  const ids = (await prisma.channel.findMany({ distinct: ["userId"], select: { userId: true } })).map((c) => c.userId);
  for (const userId of ids) {
    const fresh = await ensureLedgerFresh({ userId }, undefined, { maxInline: 20_000 });
    expect(fresh.dirty, `${userId} còn dòng bẩn`).toBe(0);
  }
  return ids;
}

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const RANGES = [
  { label: "cả kỳ", range: undefined },
  { label: "90 ngày", range: parseDateRange({ from: day(90), to: day(0) }) },
  { label: "7 ngày", range: parseDateRange({ from: day(7), to: day(0) }) },
];

describe.skipIf(!ledgerReady)("Đơn lỗ / dòng tiền theo gian / SKU — sổ cái = kéo đơn trên DB dev", () => {
  it("Đơn lỗ: số đếm cả kỳ, tổng lỗ, danh sách lỗ nặng nhất trước", { timeout: 300_000 }, async () => {
    let compared = 0;
    for (const userId of await owners()) {
      for (const { label, range } of RANGES) {
        const tag = `${userId} ${label}`;
        const [ledger, orders] = await Promise.all([
          loadLossOrders("ledger", { userId }, range, 200),
          loadLossOrders("orders", { userId }, range, 200),
        ]);
        if (orders.truncated) continue;
        expect(ledger.ledgerPending).toBe(0);
        for (const k of ["analyzedCount", "lossCount", "warningCount", "listTotal"] as const) {
          expect(ledger[k], `${tag} ${k}`).toBe(orders[k]);
        }
        expect(near(ledger.totalLoss, orders.totalLoss), `${tag} totalLoss`).toBe(true);
        expect(ledger.items.length, `${tag} số dòng`).toBe(orders.items.length);
        // Cùng thứ tự lỗ nặng nhất trước; đơn cùng mức lỗ có thể đổi chỗ nhau nên so theo tập ở từng mức.
        expect(ledger.items.map((i) => Math.round(i.profitAfterTax)), `${tag} thứ tự lợi nhuận`).toEqual(
          orders.items.map((i) => Math.round(i.profitAfterTax))
        );
        const byId = new Map(orders.items.map((i) => [i.id, i]));
        // Dòng cuối có thể rơi vào nhóm cùng mức lỗ bị trần cắt ngang → chỉ so các dòng có ở cả hai bên.
        let matched = 0;
        for (const a of ledger.items) {
          const b = byId.get(a.id);
          if (!b) continue;
          matched += 1;
          expect(a.orderCode).toBe(b.orderCode);
          expect(a.customerName ?? null, `${tag} ${a.orderCode} tên khách`).toBe(b.customerName ?? null);
          expect(a.shopName ?? null).toBe(b.shopName ?? null);
          expect(a.channelName).toBe(b.channelName);
          expect(a.isSettled).toBe(b.isSettled);
          expect(a.missingCostPrice).toBe(b.missingCostPrice);
          expect(a.createdAt.getTime()).toBe(b.createdAt.getTime());
          for (const k of ["revenueGross", "platformDeduction", "costSnapshot", "profitAfterTax"] as const) {
            expect(near(a[k], b[k]), `${tag} ${a.orderCode} ${k}`).toBe(true);
          }
        }
        if (orders.listTotal <= 200) expect(matched, `${tag} đủ dòng`).toBe(orders.items.length);
        // Chỉ số đếm (thẻ cảnh báo): không kéo danh sách.
        const statsOnly = await loadLossOrders("ledger", { userId }, range, 0);
        expect(statsOnly.items).toEqual([]);
        expect(statsOnly.lossCount).toBe(orders.lossCount);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("Dòng tiền theo gian: tiền đơn đang giao / chờ đối soát của từng gian", { timeout: 300_000 }, async () => {
    let compared = 0;
    for (const userId of await owners()) {
      const [ledger, orders] = await Promise.all([loadOpenCash("ledger", { userId }), loadOpenCash("orders", { userId })]);
      if (orders.truncated) continue;
      for (const col of ["inTransit", "pendingSettle"] as const) {
        const a = new Map([...ledger[col]].filter(([, v]) => v !== 0));
        const b = new Map([...orders[col]].filter(([, v]) => v !== 0));
        expect([...a.keys()].sort(), `${userId} ${col} gian`).toEqual([...b.keys()].sort());
        for (const [k, v] of a) expect(near(v, b.get(k)!), `${userId} ${col} ${k}: sổ ${v} ≠ đơn ${b.get(k)}`).toBe(true);
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'order_ledger'
    `;
    expect(idx.map((i) => i.indexname), "thiếu chỉ mục — áp migration 20260930260000_order_ledger_open_cash_index").toContain(
      "order_ledger_open_cash_idx"
    );
  });

  it("Lãi/Lỗ theo SKU: cùng tập mã, số lượng, doanh thu, giá vốn, phí phân bổ", { timeout: 300_000 }, async () => {
    let compared = 0;
    let skus = 0;
    for (const userId of await owners()) {
      for (const { label, range } of RANGES) {
        const tag = `${userId} ${label}`;
        const [ledger, orders] = await Promise.all([
          loadSkuAgg("ledger", { userId }, range),
          loadSkuAgg("orders", { userId }, range),
        ]);
        if (orders.truncated) continue;
        expect([...ledger.bySku.keys()].sort(), `${tag} tập mã`).toEqual([...orders.bySku.keys()].sort());
        for (const [sku, b] of orders.bySku) {
          const a = ledger.bySku.get(sku)!;
          expect(a.quantitySold, `${tag} ${sku} số lượng`).toBe(b.quantitySold);
          expect(near(a.revenue, b.revenue), `${tag} ${sku} doanh thu: sổ ${a.revenue} ≠ đơn ${b.revenue}`).toBe(true);
          expect(near(a.cogs, b.cogs), `${tag} ${sku} giá vốn`).toBe(true);
          // Phí phân bổ: sổ làm tròn 2 số lẻ TỪNG DÒNG rồi cộng; đường cũ cộng số thực → cho lệch 2 đồng/mã.
          expect(near(a.allocatedFee, b.allocatedFee, 2), `${tag} ${sku} phí phân bổ: sổ ${a.allocatedFee} ≠ đơn ${b.allocatedFee}`).toBe(true);
          expect(a.imageUrl ?? null, `${tag} ${sku} ảnh`).toBe(b.imageUrl ?? null);
          skus += 1;
        }
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(skus, "DB dev phải có SKU để phép so có nghĩa").toBeGreaterThan(0);
  });
});
