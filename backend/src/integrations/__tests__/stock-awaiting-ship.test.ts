// ============================================================
// HÀNG "CHỜ GIAO" (cột Tổng kho, 11/11/2026) — services/stock-awaiting-ship.ts
//
// Chạy trên DB dev thật qua đúng các hàm trừ / giữ / hoàn kho của webhook (order-stock.ts), để số
// Chờ giao luôn đi theo trạng thái đơn đang lưu. Thiết kế: docs/TONG-KHO-DANG-GIU-CHO-DON.md.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { deductStockTx, holdStockTx, restoreStockTx } from "../order-stock";
import { createRootLocationTx, transferStockTx } from "../../services/stock-ledger";
import { awaitingShipByProduct } from "../../services/stock-awaiting-ship";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let other: StockFixture;

const deduct = (orderId: string) => prisma.$transaction((tx) => deductStockTx(tx, orderId, "test chờ giao"));
const setStatus = (orderId: string, shippingStatus: ShippingStatus) =>
  prisma.order.update({ where: { id: orderId }, data: { shippingStatus } });
const awaitingOf = async (f: StockFixture, productId: string) =>
  (await awaitingShipByProduct(prisma, f.userId, [productId])).get(productId) ?? null;
const stockOf = async (productId: string) =>
  (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).quantityInStock;

beforeAll(async () => {
  fx = await createStockFixture("await");
  other = await createStockFixture("await-other");
});

afterAll(async () => {
  await fx.cleanup();
  await other.cleanup();
});

describe("Hàng chờ giao", () => {
  it("đơn đã trừ kho còn Chờ xử lý / Đã xử lý thì tính; sổ đã trừ, Chờ giao giữ đúng phần đã trừ", async () => {
    const p = await fx.createProduct(44);
    const o1 = await fx.createOrder(p, 7);
    const o2 = await fx.createOrder(p, 3);
    await deduct(o1); // đơn mới về mặc định PENDING
    await deduct(o2);
    await setStatus(o2, ShippingStatus.PROCESSED);

    expect(await stockOf(p)).toBe(34);
    expect(await awaitingOf(fx, p)).toEqual({ quantity: 10, orders: 2 });
  });

  it("shipper lấy kiện (Đang giao) hoặc đã giao thì hết tính — sổ không đổi", async () => {
    const p = await fx.createProduct(20);
    const o1 = await fx.createOrder(p, 2);
    const o2 = await fx.createOrder(p, 5);
    await deduct(o1);
    await deduct(o2);
    await setStatus(o1, ShippingStatus.SHIPPING);
    expect(await awaitingOf(fx, p)).toEqual({ quantity: 5, orders: 1 });

    await setStatus(o2, ShippingStatus.DELIVERED);
    expect(await awaitingOf(fx, p)).toBeNull();
    expect(await stockOf(p)).toBe(13);
  });

  it("hủy trước khi giao: hoàn kho xong là hết tính, kể cả khi trạng thái chưa kịp đổi", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 4);
    await deduct(o);
    expect(await awaitingOf(fx, p)).toEqual({ quantity: 4, orders: 1 });

    await prisma.$transaction((tx) => restoreStockTx(tx, o, "test chờ giao"));
    // Mốc stockRestoredAt đã loại đơn khỏi tập dù shippingStatus còn PENDING.
    expect(await awaitingOf(fx, p)).toBeNull();
    expect(await stockOf(p)).toBe(10);
  });

  it("đơn chưa thanh toán (chỉ GIỮ, chưa trừ sổ) không tính vào Chờ giao", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 3);
    await prisma.$transaction((tx) => holdStockTx(tx, o));
    expect(await awaitingOf(fx, p)).toBeNull();
    expect(await stockOf(p)).toBe(10);
  });

  it("đơn đã đánh mốc trừ kho nhưng không có dòng nhật ký (dòng đơn chưa nối SKU) không tính", async () => {
    const p = await fx.createProduct(10);
    const o = await fx.createOrder(p, 3);
    await prisma.order.update({ where: { id: o }, data: { stockDeductedAt: new Date() } });
    expect(await awaitingOf(fx, p)).toBeNull();
  });

  it("gian mất kết nối hoặc ngủ đông: không cộng; nối lại / thức dậy thì cộng lại", async () => {
    const p = await other.createProduct(30);
    const o = await other.createOrder(p, 6);
    await prisma.$transaction((tx) => deductStockTx(tx, o, "test chờ giao"));
    expect(await awaitingOf(other, p)).toEqual({ quantity: 6, orders: 1 });

    await prisma.channel.update({ where: { id: other.channelId }, data: { status: "DISCONNECTED" } });
    expect(await awaitingOf(other, p)).toBeNull();

    await prisma.channel.update({
      where: { id: other.channelId },
      data: { status: "ACTIVE", hibernatedAt: new Date() },
    });
    expect(await awaitingOf(other, p)).toBeNull();

    await prisma.channel.update({ where: { id: other.channelId }, data: { hibernatedAt: null } });
    expect(await awaitingOf(other, p)).toEqual({ quantity: 6, orders: 1 });
  });

  it("không lẫn sang chủ shop khác; mã không có đơn thì không có trong kết quả", async () => {
    const mine = await fx.createProduct(10);
    const o = await fx.createOrder(mine, 1);
    await deduct(o);
    const idle = await fx.createProduct(10);

    const asOther = await awaitingShipByProduct(prisma, other.userId, [mine, idle]);
    expect(asOther.size).toBe(0);
    const asMe = await awaitingShipByProduct(prisma, fx.userId, [mine, idle]);
    expect([...asMe.keys()]).toEqual([mine]);
    expect(await awaitingShipByProduct(prisma, fx.userId, [])).toEqual(new Map());
  });

  // Đặt CUỐI: bật vị trí là đổi cách ghi sổ của cả tài khoản thử.
  it("shop dùng vị trí: đơn trừ rải hai vị trí (hai dòng nhật ký) vẫn ra đúng tổng và đếm một đơn", async () => {
    const p = await fx.createProduct(6);
    const root = await prisma.$transaction((tx) => createRootLocationTx(tx, fx.userId));
    const kho2 = await prisma.stockLocation.create({ data: { userId: fx.userId, name: "Kho 2", sortOrder: 1 } });
    await prisma.$transaction((tx) =>
      transferStockTx(tx, { productId: p, fromLocationId: root.id, toLocationId: kho2.id, quantity: 4, reason: "test" })
    );
    // Gốc 2, Kho 2 4. Đơn 5 → không vị trí nào đủ → trừ rải hai nơi.
    const o = await fx.createOrder(p, 5);
    await deduct(o);
    const logs = await prisma.inventoryLog.count({ where: { orderId: o, changeQuantity: { lt: 0 } } });
    expect(logs).toBe(2);
    expect(await awaitingOf(fx, p)).toEqual({ quantity: 5, orders: 1 });
  });
});
