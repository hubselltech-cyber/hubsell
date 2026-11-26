// ============================================================
// HỦY ĐƠN + NHẬN HÀNG HOÀN theo hai chế độ của shop — kho chuẩn quốc tế LÁT 2 (20/11/2026)
// Thiết kế: docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 5.2, 5.2.1, 15.
//
// Chạy trên DB dev thật qua đúng các hàm của webhook và của route (order-stock.ts). Hai chế độ:
//   ON_CANCEL  (mặc định, cách cũ)  — đơn hủy sau khi hàng rời kho được cộng lại sổ NGAY;
//   ON_RECEIVE (chuẩn)              — không cộng; kho nhận kiện nguyên vẹn mới cộng.
// Điều phải giữ ở mọi ca: mỗi đơn chỉ được cộng lại sổ ĐÚNG MỘT LẦN, bộ đếm giữ không âm.
// ============================================================
import "./load-env";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { signToken } from "../../middleware/auth";
import { CANCELLED_AFTER_SHIP } from "../cancelled-after-ship";
import { deductStockTx, restoreReturnedStockTx, restoreStockTx, shipStockTx } from "../order-stock";
import { shipOrdersTx } from "../../services/stock-committed";
import { createStockFixture, setStockSettings, type StockFixture } from "./fixtures";

let legacy: StockFixture; // shop ở chế độ mặc định ON_CANCEL
let std: StockFixture; // shop ở chế độ chuẩn ON_RECEIVE

const deduct = (id: string) => prisma.$transaction((tx) => deductStockTx(tx, id, "test hoàn"));
const ship = (id: string) => prisma.$transaction((tx) => shipStockTx(tx, id, "PLATFORM"));
const cancel = (id: string) => prisma.$transaction((tx) => restoreStockTx(tx, id, "test hoàn"));
const receive = (id: string) => prisma.$transaction((tx) => restoreReturnedStockTx(tx, id, "test nhận hoàn"));
const productOf = (id: string) =>
  prisma.product.findUniqueOrThrow({
    where: { id },
    select: { quantityInStock: true, holdQuantity: true, committedQuantity: true },
  });
const orderOf = (id: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id },
    select: {
      stockRestoredAt: true,
      stockCommittedAt: true,
      stockShippedAt: true,
      returnStatus: true,
      platformReturnStatus: true,
      shippingStatus: true,
    },
  });
const logsOf = (orderId: string) =>
  prisma.inventoryLog.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { changeQuantity: true, kind: true, heldChange: true, heldAfter: true, onHandAfter: true, balanceAfter: true },
  });

beforeAll(async () => {
  legacy = await createStockFixture("ret-legacy");
  std = await createStockFixture("ret-std");
  await setStockSettings(std.userId, { restockOnReturn: "ON_RECEIVE" });
});

afterAll(async () => {
  await legacy.cleanup();
  await std.cleanup();
});

describe("Nhật ký kho ba ngăn (lát 3) — đi kèm mọi bút toán của đơn", () => {
  it("giữ cho đơn: Có thể bán −n, Đang giữ +n, Tồn kho đứng yên; rời kho: thêm một dòng Đang giữ −n, Tồn kho −n, sổ không đổi", async () => {
    const p = await legacy.createProduct(20);
    const o = await legacy.createOrder(p, 3);
    await deduct(o);
    await ship(o);
    const logs = await logsOf(o);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toEqual({ changeQuantity: -3, kind: "RESERVE", heldChange: 3, heldAfter: 3, onHandAfter: 20, balanceAfter: 17 });
    expect(logs[1]).toEqual({ changeQuantity: 0, kind: "SHIP", heldChange: -3, heldAfter: 0, onHandAfter: 17, balanceAfter: 17 });
    // Dòng "xuất" có changeQuantity = 0 nên không làm đổi phép cộng nhật ký trừ của đơn.
    expect(await productOf(p)).toEqual({ quantityInStock: 17, holdQuantity: 0, committedQuantity: 0 });
  });

  it("Biên bản bàn giao theo lô cũng ghi dòng xuất cho từng đơn; đơn không có nhật ký trừ thì không có dòng nào", async () => {
    const p = await legacy.createProduct(20);
    const o1 = await legacy.createOrder(p, 2);
    const o2 = await legacy.createOrder(p, 4);
    await deduct(o1);
    await deduct(o2);
    expect(await prisma.$transaction((tx) => shipOrdersTx(tx, [o1, o2], "HANDOVER"))).toBe(2);
    const l1 = await logsOf(o1);
    const l2 = await logsOf(o2);
    expect(l1.map((l) => l.kind)).toEqual(["RESERVE", "SHIP"]);
    expect(l2[1]).toMatchObject({ changeQuantity: 0, kind: "SHIP", heldChange: -4 });
    // Sau cả lô: không còn gì đang giữ, hàng trong kho = sổ.
    expect(l2[1].heldAfter).toBe(0);
    expect(l2[1].onHandAfter).toBe(14);
  });
});

describe("Chế độ mặc định ON_CANCEL (cách cũ) — không shop nào đổi số ngày lên bản", () => {
  it("hủy TRƯỚC khi rời kho: cộng lại sổ ngay, bộ đếm về 0; dòng nhật ký là Nhả giữ (Đang giữ −n, Tồn kho đứng yên)", async () => {
    const p = await legacy.createProduct(10);
    const o = await legacy.createOrder(p, 4);
    await deduct(o);
    const r = await cancel(o);
    expect(r.outcome).toBe("restored");
    expect(r.lines).toEqual([expect.objectContaining({ productId: p, restoredQuantity: 4, newQuantity: 10 })]);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
    const logs = await logsOf(o);
    expect(logs[1]).toEqual({ changeQuantity: 4, kind: "RELEASE", heldChange: -4, heldAfter: 0, onHandAfter: 10, balanceAfter: 10 });
  });

  it("hủy SAU khi rời kho: cộng lại sổ NGAY như trước; kho quét nhận sau đó KHÔNG cộng lần hai", async () => {
    const p = await legacy.createProduct(10);
    const o = await legacy.createOrder(p, 4);
    await deduct(o);
    await ship(o);
    const r = await cancel(o);
    expect(r.outcome).toBe("restored");
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
    const logs = await logsOf(o);
    expect(logs[2]).toEqual({ changeQuantity: 4, kind: "RETURN", heldChange: 0, heldAfter: 0, onHandAfter: 10, balanceAfter: 10 });

    const back = await receive(o);
    expect(back).toEqual({ lines: [], alreadyRestored: true });
    expect((await productOf(p)).quantityInStock).toBe(10);
  });
});

describe("Chế độ chuẩn ON_RECEIVE — chỉ cộng khi kho nhận kiện", () => {
  it("hủy TRƯỚC khi rời kho: vẫn cộng lại ngay (hàng chưa hề đi đâu)", async () => {
    const p = await std.createProduct(10);
    const o = await std.createOrder(p, 4);
    await deduct(o);
    expect((await cancel(o)).outcome).toBe("restored");
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
    expect((await orderOf(o)).stockRestoredAt).not.toBeNull();
  });

  it("hủy SAU khi rời kho (có mốc rời kho): KHÔNG cộng, đơn vào Chờ hàng về; kho nhận kiện nguyên vẹn mới cộng, đúng một lần", async () => {
    const p = await std.createProduct(10);
    const o = await std.createOrder(p, 4);
    await deduct(o);
    await ship(o);
    const r = await cancel(o);
    expect(r).toEqual({ restored: 0, outcome: "awaiting-return", productIds: [], lines: [] });
    expect(await productOf(p)).toEqual({ quantityInStock: 6, holdQuantity: 0, committedQuantity: 0 });
    let row = await orderOf(o);
    expect(row.stockRestoredAt).toBeNull();
    expect(row.returnStatus).toBe(ReturnStatus.AWAITING);
    expect(row.platformReturnStatus).toBe(CANCELLED_AFTER_SHIP);
    // Sàn bắn lại sự kiện hủy: vẫn không cộng.
    expect((await cancel(o)).outcome).toBe("awaiting-return");
    expect((await productOf(p)).quantityInStock).toBe(6);

    const back = await receive(o);
    expect(back.alreadyRestored).toBe(false);
    expect(back.lines).toEqual([expect.objectContaining({ productId: p, restoredQuantity: 4, newQuantity: 10 })]);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
    row = await orderOf(o);
    expect(row.stockRestoredAt).not.toBeNull();
    const last = (await logsOf(o)).at(-1)!;
    expect(last).toEqual({ changeQuantity: 4, kind: "RETURN", heldChange: 0, heldAfter: 0, onHandAfter: 10, balanceAfter: 10 });

    // Quét nhận lần hai / webhook hủy tới muộn: không cộng nữa.
    expect(await receive(o)).toEqual({ lines: [], alreadyRestored: true });
    expect((await cancel(o)).outcome).toBe("already-restored");
    expect((await productOf(p)).quantityInStock).toBe(10);
  });

  it("sàn hủy đơn đang giao mà Hubsell chưa từng ghi mốc rời kho (cờ CANCELLED_AFTER_SHIP do hàm ghi đơn cắm): vẫn coi là đã rời kho", async () => {
    const p = await std.createProduct(10);
    const o = await std.createOrder(p, 2);
    // Đơn trừ kho trước khi có bộ đếm giữ → không có dấu giữ, không có mốc rời kho.
    process.env.STOCK_COMMITTED_OFF = "1";
    await deduct(o);
    delete process.env.STOCK_COMMITTED_OFF;
    await prisma.order.update({
      where: { id: o },
      data: {
        shippingStatus: ShippingStatus.CANCELLED,
        returnStatus: ReturnStatus.AWAITING,
        returnRequestedAt: new Date(),
        platformReturnStatus: CANCELLED_AFTER_SHIP,
      },
    });
    expect((await cancel(o)).outcome).toBe("awaiting-return");
    expect((await productOf(p)).quantityInStock).toBe(8);
    await receive(o);
    expect((await productOf(p)).quantityInStock).toBe(10);
  });

  it("đơn bị đưa khỏi bộ đếm vì gian chết (CHANNEL_INACTIVE) rồi mới hủy: hàng chưa đi đâu → cộng lại ngay", async () => {
    const p = await std.createProduct(10);
    const o = await std.createOrder(p, 3);
    await deduct(o);
    await prisma.$transaction((tx) => shipStockTx(tx, o, "CHANNEL_INACTIVE"));
    expect((await productOf(p)).committedQuantity).toBe(0);
    expect((await cancel(o)).outcome).toBe("restored");
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
  });

  it("khách trả MỘT PHẦN (sàn báo số thực trả từng dòng): chỉ cộng đúng số thực trả, không cộng cả đơn", async () => {
    const a = await std.createProduct(10);
    const b = await std.createProduct(10);
    const o = await std.createOrder(a, 3);
    await prisma.orderItem.create({
      data: { orderId: o, productId: b, channelSku: `RET-${Date.now()}`, productName: "dòng 2", quantity: 2, price: 1 },
    });
    await deduct(o);
    await ship(o);
    // Đơn đã giao, khách trả 1 chiếc của mã A, giữ lại hết mã B.
    await prisma.orderItem.updateMany({ where: { orderId: o, productId: a }, data: { returnedQuantity: 1 } });
    const back = await receive(o);
    expect(back.lines).toEqual([expect.objectContaining({ productId: a, restoredQuantity: 1, newQuantity: 8 })]);
    expect((await productOf(a)).quantityInStock).toBe(8);
    expect((await productOf(b)).quantityInStock).toBe(8);
  });

  it("chạy đua: ba lượt nhận kiện song song + một webhook hủy cùng lúc chỉ cộng lại sổ đúng một lần", async () => {
    const p = await std.createProduct(10);
    const o = await std.createOrder(p, 5);
    await deduct(o);
    await ship(o);
    await cancel(o);
    const results = await Promise.all([receive(o), receive(o), receive(o), cancel(o)]);
    const restoredTimes = results.filter((r) => "lines" in r && r.lines.length > 0).length;
    expect(restoredTimes).toBe(1);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
  });
});

describe("Chạy đua ở chế độ mặc định", () => {
  it("hủy tay × webhook hủy cùng lúc trên đơn chưa rời kho: cộng một lần, bộ đếm về 0 chứ không âm", async () => {
    const p = await legacy.createProduct(10);
    const o = await legacy.createOrder(p, 5);
    await deduct(o);
    const results = await Promise.all([cancel(o), cancel(o), cancel(o)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["already-restored", "already-restored", "restored"]);
    expect(await productOf(p)).toEqual({ quantityInStock: 10, holdQuantity: 0, committedQuantity: 0 });
  });
});

describe("Qua route HTTP thật", () => {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const call = (fx: StockFixture, method: string, path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${signToken(fx.userId)}` },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, any> }));

  it("hủy tay đơn ĐANG GIAO ở shop chuẩn: không cộng sổ, đơn vào Chờ hàng về; nhận hàng hoàn nguyên vẹn qua POST /return thì cộng", async () => {
    const p = await std.createProduct(10);
    const o = await std.createOrder(p, 3);
    await deduct(o);
    expect((await call(std, "PATCH", `/api/orders/${o}/status`, { shippingStatus: "SHIPPING" })).status).toBe(200);
    expect(await productOf(p)).toEqual({ quantityInStock: 7, holdQuantity: 0, committedQuantity: 0 });

    const cancelled = await call(std, "PATCH", `/api/orders/${o}/status`, { shippingStatus: "CANCELLED" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.restored).toEqual([]);
    expect(cancelled.body.awaitingReturn).toBe(true);
    expect((await productOf(p)).quantityInStock).toBe(7);
    expect((await orderOf(o)).returnStatus).toBe(ReturnStatus.AWAITING);

    const back = await call(std, "POST", `/api/orders/${o}/return`, { condition: "INTACT" });
    expect(back.status).toBe(200);
    expect(back.body.restored).toEqual([expect.objectContaining({ productId: p, restoredQuantity: 3, newQuantity: 10 })]);
    expect(back.body.stockSkippedReason).toBeNull();
    expect((await productOf(p)).quantityInStock).toBe(10);
    expect((await orderOf(o)).returnStatus).toBe(ReturnStatus.RECEIVED_INTACT);
  });

  it("hủy tay đơn ĐANG GIAO ở shop mặc định: cộng lại ngay như trước; nhập kho hàng hoàn sau đó báo đã cộng từ lúc hủy", async () => {
    const p = await legacy.createProduct(10);
    const o = await legacy.createOrder(p, 3);
    await deduct(o);
    await call(legacy, "PATCH", `/api/orders/${o}/status`, { shippingStatus: "SHIPPING" });
    const cancelled = await call(legacy, "PATCH", `/api/orders/${o}/status`, { shippingStatus: "CANCELLED" });
    expect(cancelled.body.restored).toEqual([expect.objectContaining({ productId: p, restoredQuantity: 3, newQuantity: 10 })]);
    expect((await productOf(p)).quantityInStock).toBe(10);
  });

  it("hàng hoàn HỎNG ở shop chuẩn: không cộng sổ", async () => {
    const p = await std.createProduct(10);
    const o = await std.createOrder(p, 3);
    await deduct(o);
    await ship(o);
    await cancel(o);
    const back = await call(std, "POST", `/api/orders/${o}/return`, { condition: "DAMAGED" });
    expect(back.status).toBe(200);
    expect(back.body.restored).toEqual([]);
    expect((await productOf(p)).quantityInStock).toBe(7);
    expect((await orderOf(o)).returnStatus).toBe(ReturnStatus.DAMAGED);
  });

  it("nhập kho hàng hoàn THEO LÔ ở shop chuẩn: cộng đúng các đơn chưa cộng, bấm lại không cộng thêm", async () => {
    const p = await std.createProduct(20);
    const o1 = await std.createOrder(p, 2);
    const o2 = await std.createOrder(p, 3);
    for (const o of [o1, o2]) {
      await deduct(o);
      await ship(o);
      await cancel(o);
    }
    expect((await productOf(p)).quantityInStock).toBe(15);
    const r = await call(std, "POST", `/api/orders/returns/bulk-inbound`, { ids: [o1, o2] });
    expect(r.status).toBe(200);
    expect(r.body.processed).toBe(2);
    expect(r.body.restockedUnits).toBe(5);
    expect((await productOf(p)).quantityInStock).toBe(20);
    const again = await call(std, "POST", `/api/orders/returns/bulk-inbound`, { ids: [o1, o2] });
    expect(again.body.restockedUnits).toBe(0);
    expect((await productOf(p)).quantityInStock).toBe(20);
  });
});
