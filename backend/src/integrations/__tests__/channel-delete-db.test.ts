// ============================================================
// XÓA GIAN THEO LÔ (services/channel-delete.ts) trên DB dev: đơn đi từng lô, sổ
// cái đi theo đơn, dòng gian xóa sau cùng; gian đang hoạt động thì không đụng;
// quá thời gian chờ thì trả "đang xóa nốt" và lượt nền vẫn chạy tới xong.
// Kèm kiểm sau migration 20260930270000: xóa riêng một dòng hàng không còn kéo
// dòng sổ theo ngay (khóa ngoại đã bỏ) nhưng worker tính lại là dòng sổ biến mất.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { deleteChannelWithin, startChannelDelete } from "../../services/channel-delete";

const ledgerReady: boolean = await (async () => {
  try {
    const r = await prisma.$queryRaw<{ r: string | null }[]>`SELECT to_regclass('order_line_ledger')::text AS r`;
    return r[0]?.r != null;
  } catch {
    return false;
  }
})();

async function seedOrders(fx: StockFixture, tag: string, n: number, channelId = fx.channelId) {
  for (let i = 1; i <= n; i++) {
    await prisma.order.create({
      data: {
        channelId,
        orderCode: `TEST-${fx.suffix}-${tag}${i}`,
        customerName: "Khách test",
        itemCount: 2,
        items: {
          create: [
            { channelSku: `TEST-${fx.suffix}-A`, productName: "Dòng A", quantity: 1, price: 100_000, costPriceAtSale: 40_000 },
            { channelSku: `TEST-${fx.suffix}-B`, productName: "Dòng B", quantity: 2, price: 50_000, costPriceAtSale: 20_000 },
          ],
        },
      },
    });
  }
  const fresh = await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 });
  expect(fresh.dirty).toBe(0);
}

const counts = async (channelId: string) => ({
  channel: await prisma.channel.count({ where: { id: channelId } }),
  orders: await prisma.order.count({ where: { channelId } }),
  items: await prisma.orderItem.count({ where: { order: { channelId } } }),
  ledger: await prisma.orderLedger.count({ where: { channelId } }),
  lines: await prisma.orderLineLedger.count({ where: { channelId } }),
});

describe.skipIf(!ledgerReady)("Xóa gian theo lô", () => {
  let fx: StockFixture;
  const newChannel = async (status: string) =>
    (
      await prisma.channel.create({
        data: { userId: fx.userId, channelName: "LAZADA", shopName: `TEST-${fx.suffix}-${Date.now()}`, status },
      })
    ).id;

  beforeAll(async () => {
    fx = await createStockFixture("chdelete");
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("xóa hết đơn qua nhiều lô rồi xóa gian; sổ đơn và sổ dòng hàng đi theo", async () => {
    const id = await newChannel("DISCONNECTED");
    await seedOrders(fx, "X", 7, id);
    expect(await counts(id)).toEqual({ channel: 1, orders: 7, items: 14, ledger: 7, lines: 14 });
    const outcome = await startChannelDelete(id, { batch: 3, pauseMs: 0 });
    expect(outcome).toEqual({ status: "deleted", deletedOrders: 7 });
    expect(await counts(id)).toEqual({ channel: 0, orders: 0, items: 0, ledger: 0, lines: 0 });
  });

  it("gian đang hoạt động: không xóa đơn nào, không xóa gian", async () => {
    const id = await newChannel("ACTIVE");
    await seedOrders(fx, "A", 2, id);
    const outcome = await startChannelDelete(id, { batch: 3, pauseMs: 0 });
    expect(outcome).toEqual({ status: "reconnected", deletedOrders: 0 });
    expect(await counts(id)).toMatchObject({ channel: 1, orders: 2, lines: 4 });
  });

  it("gian được nối lại GIỮA CHỪNG: dừng ở lô kế tiếp, gian và các đơn còn lại được giữ", async () => {
    const id = await newChannel("DISCONNECTED");
    await seedOrders(fx, "R", 6, id);
    const job = startChannelDelete(id, { batch: 2, pauseMs: 150 });
    // Trong lúc nghỉ sau lô đầu, gian được nối lại.
    await new Promise((r) => setTimeout(r, 60));
    await prisma.channel.update({ where: { id }, data: { status: "ACTIVE" } });
    const outcome = await job;
    expect(outcome.status).toBe("reconnected");
    expect(outcome.deletedOrders).toBeGreaterThan(0);
    expect(outcome.deletedOrders).toBeLessThan(6);
    const left = await counts(id);
    expect(left.channel).toBe(1);
    expect(left.orders).toBe(6 - outcome.deletedOrders);
  });

  it("bấm hai lần: dùng chung một lượt; gian không còn → gone", async () => {
    const id = await newChannel("DISCONNECTED");
    await seedOrders(fx, "D", 3, id);
    const a = startChannelDelete(id, { batch: 1, pauseMs: 20 });
    const b = startChannelDelete(id, { batch: 1, pauseMs: 20 });
    expect(b).toBe(a);
    expect(await a).toEqual({ status: "deleted", deletedOrders: 3 });
    expect(await startChannelDelete(id)).toEqual({ status: "gone", deletedOrders: 0 });
  });

  it("quá thời gian chờ: trả pending, lượt nền vẫn xóa tới xong", async () => {
    const id = await newChannel("DISCONNECTED");
    await seedOrders(fx, "P", 4, id);
    const result = await deleteChannelWithin(id, 0, { batch: 1, pauseMs: 30 });
    expect(result.pending).toBe(true);
    if (!result.pending) return;
    expect((await counts(id)).channel).toBe(1); // chưa xong: gian còn đó
    expect(await result.job).toEqual({ status: "deleted", deletedOrders: 4 });
    expect(await counts(id)).toEqual({ channel: 0, orders: 0, items: 0, ledger: 0, lines: 0 });
    // Đủ thời gian chờ thì trả kết quả ngay.
    const id2 = await newChannel("DISCONNECTED");
    const quick = await deleteChannelWithin(id2, 10_000);
    expect(quick).toEqual({ pending: false, outcome: { status: "deleted", deletedOrders: 0 } });
  });

  it("sau khi bỏ khóa ngoại orderItemId: xóa một dòng hàng → đơn bị đánh dấu, worker tính lại thì dòng sổ của nó biến mất", async () => {
    await seedOrders(fx, "I", 1);
    const order = await prisma.order.findFirstOrThrow({
      where: { channelId: fx.channelId, orderCode: `TEST-${fx.suffix}-I1` },
      include: { items: true },
    });
    const gone = order.items[0];
    await prisma.orderItem.delete({ where: { id: gone.id } });
    const dirty = await prisma.orderLedger.findFirstOrThrow({ where: { orderId: order.id } });
    expect(dirty.dirtyAt).not.toBeNull();
    expect(dirty.dirtyReason).toBe("item:delete");
    const fresh = await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 });
    expect(fresh.dirty).toBe(0);
    const lines = await prisma.orderLineLedger.findMany({ where: { orderId: order.id } });
    expect(lines.map((l) => l.orderItemId)).toEqual([order.items[1].id]);
    // Xóa cả đơn vẫn dọn sạch dòng sổ qua khóa ngoại orderId.
    await prisma.order.delete({ where: { id: order.id } });
    expect(await prisma.orderLineLedger.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.orderLedger.count({ where: { orderId: order.id } })).toBe(0);
  });
});
