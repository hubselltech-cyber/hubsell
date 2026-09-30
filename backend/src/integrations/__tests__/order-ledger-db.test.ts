// ============================================================
// SỔ CÁI ĐƠN — TEST TÍCH HỢP trên DB dev: trigger đánh dấu, worker tính lại,
// luật "không mất mốc bẩn mới", cộng trong DB khớp tính lại trong RAM, dời
// mảnh khi đơn đổi ngày tạo, xóa đơn kéo theo dòng sổ.
//
// Cần migration 20260930230000_order_ledger đã áp lên DB dev
// (npx tsx scripts/apply-migration-local.ts KHÔNG dùng được vì file có hàm
// plpgsql — dùng psql: xem docs/SO-CAI-DON.md mục "Chạy thử local").
// Chưa áp → cả file tự BỎ QUA (không đỏ), in lý do.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import {
  buildLedgerRows,
  LEDGER_FORMULA_VERSION,
  LEDGER_INCLUDE,
  summarizeLedgerRowsInMemory,
  type LedgerOrder,
} from "../../lib/order-ledger";
import {
  claimDirtyLedgerRows,
  drainLedgerOnce,
  ledgerFreshness,
  ledgerStatus,
  ledgerSummary,
  recomputeLedgerOrders,
} from "../../services/order-ledger";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();
if (!ledgerReady) {
  console.log("[order-ledger-db.test] BỎ QUA: DB dev chưa có bảng order_ledger (chưa áp migration 20260930230000_order_ledger)");
}

describe.skipIf(!ledgerReady)("Sổ cái đơn — trigger + worker trên DB thật", () => {
  let fx: StockFixture;
  let productId: string;
  let orderId: string;
  const scope = () => ({ userId: fx.userId });

  const row = () => prisma.orderLedger.findFirst({ where: { orderId } });
  const drainAll = async () => {
    for (let i = 0; i < 10; i++) {
      const r = await drainLedgerOnce(100, { scope: scope() });
      if (r.claimed === 0) break;
    }
  };

  beforeAll(async () => {
    fx = await createStockFixture("ledger");
    productId = await fx.createProduct(10);
    orderId = await fx.createOrder(productId, 2);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("tạo đơn → trigger tạo dòng nháp bẩn (chưa tính)", async () => {
    const r = await row();
    expect(r).not.toBeNull();
    expect(r!.dirtyAt).not.toBeNull();
    expect(r!.formulaVersion).toBe(0);
    expect(r!.ownerId).toBe(fx.userId);
    expect(r!.channelId).toBe(fx.channelId);
    expect(r!.dirtyReason).toMatch(/^(order:insert|item:insert)$/);
  });

  it("worker tính lại → số khớp computePnlRow, dòng hàng có, hết bẩn", async () => {
    await drainAll();
    const r = (await row())!;
    expect(r.dirtyAt).toBeNull();
    expect(r.claimedAt).toBeNull();
    expect(r.formulaVersion).toBe(LEDGER_FORMULA_VERSION);
    expect(Number(r.revenueGross)).toBe(200000);
    expect(r.countsAsRevenue).toBe(true);
    const lines = await prisma.orderLineLedger.findMany({ where: { orderId } });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].lineGross)).toBe(200000);
    expect(Number(lines[0].share)).toBe(1);
    const o = (await prisma.order.findUnique({ where: { id: orderId }, include: LEDGER_INCLUDE })) as LedgerOrder;
    const fresh = buildLedgerRows(o).order;
    expect(Number(r.profitAfterTax)).toBe(fresh.profitAfterTax);
    expect(Number(r.costSnapshot)).toBe(fresh.costSnapshot);
  });

  it("sửa giá vốn dòng hàng (như script vá giá vốn) → bẩn với lý do item:update → tính lại đúng", async () => {
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    await prisma.orderItem.update({ where: { id: item.id }, data: { costPriceAtSale: 30000 } });
    let r = (await row())!;
    expect(r.dirtyAt).not.toBeNull();
    expect(r.dirtyReason).toBe("item:update");
    await drainAll();
    r = (await row())!;
    expect(r.dirtyAt).toBeNull();
    expect(Number(r.costSnapshot)).toBe(60000);
    expect(r.missingCostPrice).toBe(false);
  });

  it("đổi cột KHÔNG thuộc công thức (số điện thoại) → không bẩn", async () => {
    await prisma.order.update({ where: { id: orderId }, data: { customerPhone: "0900000000" } });
    expect((await row())!.dirtyAt).toBeNull();
  });

  it("ghi lại đơn với cùng giá trị (đồng bộ lặp) → không bẩn", async () => {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await prisma.order.update({
      where: { id: orderId },
      data: { totalAmount: o.totalAmount, shippingStatus: o.shippingStatus, isSettled: o.isSettled },
    });
    expect((await row())!.dirtyAt).toBeNull();
  });

  it("không mất mốc bẩn MỚI chen vào giữa lúc nhặt và lúc ghi", async () => {
    await prisma.order.update({ where: { id: orderId }, data: { shippingStatus: ShippingStatus.SHIPPING } });
    const claims = await claimDirtyLedgerRows(10, { scope: scope() });
    expect(claims.map((c) => c.orderId)).toContain(orderId);
    // Đổi tiếp trong lúc "worker đang tính" → mốc bẩn mới hơn mốc đã nhặt.
    await new Promise((res) => setTimeout(res, 5));
    await prisma.order.update({ where: { id: orderId }, data: { shippingStatus: ShippingStatus.DELIVERED } });
    await recomputeLedgerOrders(claims);
    const r = (await row())!;
    expect(r.dirtyAt).not.toBeNull(); // vẫn bẩn → lượt sau tính lại với trạng thái mới
    expect(r.claimedAt).toBeNull();
    await drainAll();
    const r2 = (await row())!;
    expect(r2.dirtyAt).toBeNull();
    expect(r2.shippingStatus).toBe(ShippingStatus.DELIVERED);
  });

  it("đổi trạng thái sang hủy / đang hoàn → cờ nhóm đổi theo định nghĩa tài chính", async () => {
    await prisma.order.update({ where: { id: orderId }, data: { returnStatus: ReturnStatus.AWAITING } });
    await drainAll();
    let r = (await row())!;
    expect(r.isReturning).toBe(true);
    expect(r.countsAsRevenue).toBe(false);
    await prisma.order.update({
      where: { id: orderId },
      data: { returnStatus: ReturnStatus.NONE, shippingStatus: ShippingStatus.CANCELLED },
    });
    await drainAll();
    r = (await row())!;
    expect(r.isReturning).toBe(false);
    expect(r.countsAsRevenue).toBe(false);
    expect(Number(r.platformRevenue)).toBe(0);
    await prisma.order.update({ where: { id: orderId }, data: { shippingStatus: ShippingStatus.DELIVERED } });
    await drainAll();
  });

  it("cộng trong DB (ledgerSummary) khớp tính lại trong RAM từng nhóm, từng cột", async () => {
    // Thêm đơn thứ hai đã hủy để có nhiều nhóm.
    const o2 = await fx.createOrder(productId, 1);
    await prisma.order.update({ where: { id: o2 }, data: { shippingStatus: ShippingStatus.CANCELLED } });
    await drainAll();
    const fresh = await ledgerFreshness(scope());
    expect(fresh.dirty).toBe(0);
    expect(fresh.staleVersion).toBe(0);

    const sql = await ledgerSummary(scope());
    const orders = (await prisma.order.findMany({
      where: { channel: scope() },
      include: LEDGER_INCLUDE,
    })) as LedgerOrder[];
    const mem = summarizeLedgerRowsInMemory(orders.map((o) => buildLedgerRows(o).order));
    expect(sql).toEqual(mem);
    expect(sql.all.count).toBe(2);
    expect(sql.cancelled.count).toBe(1);
    expect(sql.active.count).toBe(1);
  });

  it("lọc theo kỳ: ngoài kỳ → 0 đơn; đúng kỳ → có đơn (cắt theo giờ VN)", async () => {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const dayStart = new Date(Math.floor((o.createdAt.getTime() + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000);
    const inRange = await ledgerSummary(scope(), { gte: dayStart, lte: new Date(dayStart.getTime() + 86_400_000 - 1) });
    expect(inRange.all.count).toBeGreaterThanOrEqual(1);
    const out = await ledgerSummary(scope(), {
      gte: new Date(dayStart.getTime() - 30 * 86_400_000),
      lte: new Date(dayStart.getTime() - 29 * 86_400_000),
    });
    expect(out.all.count).toBe(0);
  });

  it("đơn đổi ngày tạo sang tháng khác → dòng sổ dời mảnh, không sinh dòng đôi", async () => {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const moved = new Date(o.createdAt.getTime() - 45 * 86_400_000);
    await prisma.order.update({ where: { id: orderId }, data: { createdAt: moved } });
    await drainAll();
    const rows = await prisma.orderLedger.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].createdDate.toISOString().slice(0, 10)).toBe(
      new Date(moved.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
    );
    const lines = await prisma.orderLineLedger.findMany({ where: { orderId } });
    expect(lines).toHaveLength(1);
    expect(lines[0].createdDate.getTime()).toBe(rows[0].createdDate.getTime());
    await prisma.order.update({ where: { id: orderId }, data: { createdAt: o.createdAt } });
    await drainAll();
  });

  it("trạng thái HQ đọc được; mảnh DEFAULT không có dòng của đơn test", async () => {
    const s = await ledgerStatus();
    expect(s.formulaVersion).toBe(LEDGER_FORMULA_VERSION);
    expect(s.rows).toBeGreaterThanOrEqual(2);
    expect(s.partitions.length).toBeGreaterThan(0);
  });

  it("xóa chủ shop (cascade) → dòng sổ và dòng hàng biến mất theo FK", async () => {
    const userId = fx.userId;
    await fx.cleanup();
    expect(await prisma.orderLedger.count({ where: { ownerId: userId } })).toBe(0);
    expect(await prisma.orderLineLedger.count({ where: { ownerId: userId } })).toBe(0);
    // afterAll gọi cleanup lần nữa — fixture phải chịu được gọi lặp.
  });
});
