// ============================================================
// TRỢ LÝ HỎI ĐÁP trên DB dev: các câu trả lời cộng từ đơn phải GIỐNG HỆT giữa
// đường sổ cái và đường cũ kéo đơn, trên DỮ LIỆU THẬT của DB dev:
//   · báo cáo kỳ (chat + báo cáo tuần qua chuông) — so nguyên câu trả lời;
//   · tiền đơn chưa quyết toán ("tiền đang ở đâu");
//   · đơn lỗ trên tập đơn tính doanh thu.
// (docs/SO-CAI-DON.md mục 9.6). Chưa áp migration sổ cái → cả file tự BỎ QUA.
// ============================================================

import "./load-env";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { parseDateRange } from "../../lib/date-range";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { loadLossOrders, loadOpenCashTotals } from "../../routes/finance";
import { buildPeriodReport } from "../../routes/assistant";

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
  it("báo cáo kỳ: câu trả lời, bảng số và biểu đồ giống hệt nhau (7 ngày, 30 ngày, 90 ngày)", { timeout: 300_000 }, async () => {
    let compared = 0;
    let nonEmpty = 0;
    for (const userId of await owners()) {
      for (const days of [7, 30, 90]) {
        const range = parseDateRange({ from: day(days - 1), to: day(0) })!;
        const [a, b] = await Promise.all([
          buildPeriodReport(userId, { userId }, range, `${days} ngày`, "ledger"),
          buildPeriodReport(userId, { userId }, range, `${days} ngày`, "orders"),
        ]);
        expect(a, `${userId} ${days} ngày`).toEqual(b);
        if (!a.text.includes("chưa có đơn")) nonEmpty += 1;
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(nonEmpty, "DB dev phải có ít nhất một kỳ có đơn để phép so có nghĩa").toBeGreaterThan(0);
  });

  it("tiền đơn chưa quyết toán của đơn tính doanh thu: tổng + số đơn đang giao / chờ đối soát", { timeout: 180_000 }, async () => {
    for (const userId of await owners()) {
      const [a, b] = await Promise.all([loadOpenCashTotals("ledger", { userId }), loadOpenCashTotals("orders", { userId })]);
      if (b.truncated) continue;
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
        const [a, b] = await Promise.all([
          loadLossOrders("ledger", { userId }, range, 3, "active"),
          loadLossOrders("orders", { userId }, range, 3, "active"),
        ]);
        if (b.truncated) continue;
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
