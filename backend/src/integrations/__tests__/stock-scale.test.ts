// ============================================================
// KHO CHUẨN QUỐC TẾ — BỊT LỖ QUY MÔ TRƯỚC KHI MỞ CHO MỌI SHOP (26/11/2026,
// docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 20 + 21).
//
// Chạy app Express thật trên cổng ngẫu nhiên + DB dev. Điều phải giữ:
//   · dòng nhật ký nào cũng có chủ shop (trigger database điền, nơi ghi không phải truyền);
//   · Nhật ký kho lọc theo cột chủ shop trả ĐÚNG các dòng mà cách lọc cũ (qua quan hệ sản phẩm) trả,
//     không lẫn shop khác; đếm có trần và báo rõ khi chạm trần;
//   · dòng "chưa về kho" bản mới = bản cũ trong cửa sổ ngày, bỏ đơn ngoài cửa sổ, tách khỏi danh sách;
//   · shop cách mới không còn chạy câu "Chờ giao";
//   · tra mã quét: ba kiểu khớp chính xác, khớp lỏng có cửa sổ, không lẫn shop khác, không coi % _ là ký tự đại diện.
// ============================================================
import "./load-env";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { InventoryLogType, ReturnStatus, ShippingStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { signToken } from "../../middleware/auth";
import { deductStockTx, restoreStockTx, shipStockTx } from "../order-stock";
import { LOG_COUNT_CAP } from "../../routes/inventory";
import { looseLookupIds, LOOKUP_LOOSE_DAYS } from "../../services/order-lookup";
import { NOT_BACK_WINDOW_DAYS, restockedNotBackYet } from "../../services/stock-awaiting-ship";
import { createStockFixture, setStockSettings, type StockFixture } from "./fixtures";

let shop: StockFixture; // cách mới (ON_HAND), cộng tồn khi sàn báo hủy
let legacy: StockFixture; // cách cũ
let other: StockFixture; // shop khác — không được lẫn
let server: Server;
let baseUrl = "";

type Json = Record<string, any>;
async function call(fx: StockFixture, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${signToken(fx.userId)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

/** Một đơn đi hết vòng: chốt (giữ) → rời kho → sàn báo hủy sau giao (cộng lại sổ, còn Chờ hàng về). */
async function cancelledAfterShip(fx: StockFixture, productId: string, qty: number): Promise<string> {
  const orderId = await fx.createOrder(productId, qty);
  await prisma.$transaction((tx) => deductStockTx(tx, orderId, "test"));
  await prisma.order.update({ where: { id: orderId }, data: { shippingStatus: ShippingStatus.SHIPPING } });
  await prisma.$transaction((tx) => shipStockTx(tx, orderId, "PLATFORM"));
  await prisma.$transaction((tx) => restoreStockTx(tx, orderId, "test"));
  await prisma.order.update({
    where: { id: orderId },
    data: { shippingStatus: ShippingStatus.CANCELLED, returnStatus: ReturnStatus.AWAITING, returnRequestedAt: new Date() },
  });
  return orderId;
}

/** Câu "chưa về kho" BẢN CŨ (trước 26/11/2026) — để so kết quả với bản mới. */
async function notBackYetOld(ownerId: string): Promise<{ units: number; orders: number }> {
  const rows = await prisma.$queryRaw<{ units: number; orders: number }[]>`
    SELECT COALESCE(SUM(-il."changeQuantity"), 0)::int AS units, COUNT(DISTINCT o."id")::int AS orders
    FROM "Channel" c
    JOIN "Order" o ON o."channelId" = c."id" AND o."returnStatus" = 'AWAITING' AND o."stockRestoredAt" IS NOT NULL
    JOIN "InventoryLog" il ON il."orderId" = o."id" AND il."changeQuantity" < 0
    WHERE c."userId" = ${ownerId}`;
  return rows[0];
}

beforeAll(async () => {
  shop = await createStockFixture("sc-main");
  legacy = await createStockFixture("sc-legacy");
  other = await createStockFixture("sc-other");
  await setStockSettings(shop.userId, { stockModel: "ON_HAND" });
  await setStockSettings(other.userId, { stockModel: "ON_HAND" });
  await setStockSettings(legacy.userId, { stockModel: "LEGACY" });
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const fx of [shop, legacy, other]) await fx.cleanup();
});

describe("Cột chủ shop của nhật ký kho (trigger inventory_log_owner_trg)", () => {
  it("mọi đường ghi đều ra dòng có chủ: nhập tay, đơn sàn giữ / rời kho / hủy, và cả câu INSERT không truyền chủ", async () => {
    const p = await shop.createProduct(20);
    expect((await call(shop, "POST", "/api/inventory/adjust", { productId: p, type: "IMPORT", quantity: 3 })).status).toBe(200);
    await cancelledAfterShip(shop, p, 2); // RESERVE, SHIP, RETURN
    await prisma.inventoryLog.create({
      data: { productId: p, changeQuantity: 1, type: InventoryLogType.ADJUST, reason: "chèn thẳng, không truyền chủ" },
    });
    const rows = await prisma.inventoryLog.findMany({ where: { productId: p }, select: { ownerId: true, kind: true } });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => r.ownerId === shop.userId)).toBe(true);
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(["RESERVE", "SHIP", "RETURN"]));
  });

  it("nơi ghi có truyền chủ thì trigger giữ nguyên, không đè", async () => {
    const p = await shop.createProduct(1);
    const row = await prisma.inventoryLog.create({
      data: { productId: p, changeQuantity: 1, type: InventoryLogType.ADJUST, ownerId: "chu-khac" },
    });
    expect(row.ownerId).toBe("chu-khac");
    await prisma.inventoryLog.delete({ where: { id: row.id } });
  });
});

describe("Nhật ký kho (GET /api/inventory/logs) lọc theo chủ shop", () => {
  it("trả đúng các dòng mà cách lọc cũ (qua quan hệ sản phẩm) trả, cùng thứ tự; không lẫn shop khác", async () => {
    const a = await shop.createProduct(50);
    const b = await other.createProduct(50);
    for (let i = 0; i < 3; i++) {
      await call(shop, "POST", "/api/inventory/adjust", { productId: a, type: "EXPORT", quantity: 1 });
      await call(other, "POST", "/api/inventory/adjust", { productId: b, type: "EXPORT", quantity: 1 });
    }
    await cancelledAfterShip(shop, a, 1);
    const r = await call(shop, "GET", "/api/inventory/logs?pageSize=100");
    expect(r.status).toBe(200);
    const old = await prisma.inventoryLog.findMany({
      where: { product: { userId: shop.userId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true },
    });
    expect((r.body.items as Json[]).map((x) => x.id)).toEqual(old.map((x) => x.id));
    expect(r.body.total).toBe(old.length);
    expect(r.body.totalCapped).toBe(false);
    const otherIds = new Set((await prisma.inventoryLog.findMany({ where: { productId: b }, select: { id: true } })).map((x) => x.id));
    expect((r.body.items as Json[]).some((x) => otherIds.has(x.id))).toBe(false);
  });

  it("shop cách cũ vẫn không thấy dòng 'đổi 0' (xuất cho đơn); shop cách mới thấy", async () => {
    const p = await legacy.createProduct(10);
    const orderId = await legacy.createOrder(p, 2);
    await prisma.$transaction((tx) => deductStockTx(tx, orderId, "test"));
    await prisma.$transaction((tx) => shipStockTx(tx, orderId, "PLATFORM"));
    const r = await call(legacy, "GET", `/api/inventory/logs?productId=${p}`);
    expect((r.body.items as Json[]).map((x) => x.changeQuantity)).toEqual([-2]);
    const p2 = await shop.createProduct(10);
    const o2 = await shop.createOrder(p2, 2);
    await prisma.$transaction((tx) => deductStockTx(tx, o2, "test"));
    await prisma.$transaction((tx) => shipStockTx(tx, o2, "PLATFORM"));
    const r2 = await call(shop, "GET", `/api/inventory/logs?productId=${p2}`);
    expect((r2.body.items as Json[]).map((x) => x.kind)).toEqual(["SHIP", "RESERVE"]);
  });

  it("tìm theo mã / tên vẫn chỉ trong nhật ký của shop mình", async () => {
    const a = await shop.createProduct(5);
    await call(shop, "POST", "/api/inventory/adjust", { productId: a, type: "IMPORT", quantity: 1 });
    const sku = (await prisma.product.findUniqueOrThrow({ where: { id: a }, select: { skuCode: true } })).skuCode;
    const mine = await call(shop, "GET", `/api/inventory/logs?q=${encodeURIComponent(sku)}`);
    expect(mine.body.total).toBe(1);
    const theirs = await call(other, "GET", `/api/inventory/logs?q=${encodeURIComponent(sku)}`);
    expect(theirs.body.total).toBe(0);
  });

  it("đếm có TRẦN: quá trần thì total = trần, báo totalCapped, và không lật quá trang cuối trong trần", async () => {
    const fx = await createStockFixture("sc-cap");
    try {
      const p = await fx.createProduct(0);
      const n = LOG_COUNT_CAP + 5;
      await prisma.inventoryLog.createMany({
        data: Array.from({ length: n }, () => ({ productId: p, changeQuantity: 1, type: InventoryLogType.ADJUST })),
      });
      const r = await call(fx, "GET", "/api/inventory/logs?pageSize=100");
      expect(r.body.total).toBe(LOG_COUNT_CAP);
      expect(r.body.totalCapped).toBe(true);
      expect(r.body.pageCount).toBe(LOG_COUNT_CAP / 100);
      const far = await call(fx, "GET", "/api/inventory/logs?pageSize=100&page=999999");
      expect(far.body.page).toBe(LOG_COUNT_CAP / 100);
      expect((far.body.items as Json[]).length).toBe(100);
    } finally {
      await fx.cleanup();
    }
  }, 60_000);
});

describe("Báo cáo 'Hàng hỏng, mất & chênh kiểm kê' đi từ nhật ký của chủ shop", () => {
  it("chỉ cộng dòng tay của đúng shop", async () => {
    const a = await shop.createProduct(30);
    const b = await other.createProduct(30);
    await call(shop, "POST", "/api/inventory/adjust", { productId: a, type: "EXPORT", quantity: 4, reasonCode: "DAMAGED" });
    await call(other, "POST", "/api/inventory/adjust", { productId: b, type: "EXPORT", quantity: 9, reasonCode: "DAMAGED" });
    const before = await call(shop, "GET", "/api/inventory/loss-report");
    const g = (before.body.groups as Json[]).find((x) => x.key === "DAMAGED")!;
    const mine = await prisma.inventoryLog.aggregate({
      where: { product: { userId: shop.userId }, kind: "DAMAGED", orderId: null },
      _sum: { changeQuantity: true },
    });
    expect(g.down).toBe(-(mine._sum.changeQuantity ?? 0));
  });
});

describe("Dòng 'chưa về kho' của Tổng kho (GET /api/products/not-back-yet)", () => {
  it("bản mới = bản cũ khi mọi đơn nằm trong cửa sổ; đơn đã nhận, đơn hủy trước khi rời kho không tính", async () => {
    const fx = await createStockFixture("sc-nb");
    try {
      await setStockSettings(fx.userId, { stockModel: "ON_HAND" });
      const p = await fx.createProduct(100);
      await cancelledAfterShip(fx, p, 3);
      await cancelledAfterShip(fx, p, 2);
      const received = await cancelledAfterShip(fx, p, 7);
      await prisma.order.update({ where: { id: received }, data: { returnStatus: ReturnStatus.RECEIVED_INTACT } });
      // Hủy TRƯỚC khi rời kho: dòng cộng lại là RELEASE, đơn không ở Chờ hàng về.
      const early = await fx.createOrder(p, 5);
      await prisma.$transaction((tx) => deductStockTx(tx, early, "test"));
      await prisma.$transaction((tx) => restoreStockTx(tx, early, "test"));

      const r = await call(fx, "GET", "/api/products/not-back-yet");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ units: 5, orders: 2, days: NOT_BACK_WINDOW_DAYS });
      expect(await notBackYetOld(fx.userId)).toEqual({ units: 5, orders: 2 });
    } finally {
      await fx.cleanup();
    }
  });

  it("đơn cộng lại quá cửa sổ ngày thì không tính nữa; dòng cũ chưa có 'kind' (trước 20/11) trong cửa sổ vẫn tính", async () => {
    const fx = await createStockFixture("sc-nbw");
    try {
      await setStockSettings(fx.userId, { stockModel: "ON_HAND" });
      const p = await fx.createProduct(100);
      const oldOrder = await cancelledAfterShip(fx, p, 4);
      const legacyRow = await cancelledAfterShip(fx, p, 6);
      const longAgo = new Date(Date.now() - (NOT_BACK_WINDOW_DAYS + 5) * 86_400_000);
      await prisma.inventoryLog.updateMany({ where: { orderId: oldOrder, changeQuantity: { gt: 0 } }, data: { createdAt: longAgo } });
      await prisma.inventoryLog.updateMany({ where: { orderId: legacyRow, changeQuantity: { gt: 0 } }, data: { kind: null } });
      expect(await restockedNotBackYet(prisma, fx.userId)).toEqual({ units: 6, orders: 1, days: NOT_BACK_WINDOW_DAYS });
      // Mở rộng cửa sổ thì đơn cũ quay lại → đúng là cửa sổ loại nó, không phải lỗi đếm.
      expect(await restockedNotBackYet(prisma, fx.userId, NOT_BACK_WINDOW_DAYS + 10)).toMatchObject({ units: 10, orders: 2 });
    } finally {
      await fx.cleanup();
    }
  });

  it("shop cách cũ, và shop 'cộng tồn khi kho nhận kiện', nhận 0 mà không tính gì", async () => {
    const p = await legacy.createProduct(10);
    await cancelledAfterShip(legacy, p, 1);
    expect((await call(legacy, "GET", "/api/products/not-back-yet")).body).toEqual({ units: 0, orders: 0, days: NOT_BACK_WINDOW_DAYS });
  });

  it("danh sách Tổng kho không còn kèm con số này; shop cách mới không còn chạy câu Chờ giao, shop cách cũ vẫn có", async () => {
    const p = await shop.createProduct(10);
    const o = await shop.createOrder(p, 2);
    await prisma.$transaction((tx) => deductStockTx(tx, o, "test"));
    const r = await call(shop, "GET", "/api/products?awaiting=1&pageSize=100");
    expect(r.body.notBackYet).toBeUndefined();
    const row = (r.body.items as Json[]).find((x) => x.id === p)!;
    expect(row.awaitingShip).toBeUndefined();
    expect(row.heldQuantity).toBe(2); // "Đang giữ" đọc từ bộ đếm
    expect(row.onHand).toBe(10);

    const lp = await legacy.createProduct(10);
    const lo = await legacy.createOrder(lp, 3);
    await prisma.$transaction((tx) => deductStockTx(tx, lo, "test"));
    const lr = await call(legacy, "GET", "/api/products?awaiting=1&pageSize=100");
    expect((lr.body.items as Json[]).find((x) => x.id === lp)!.awaitingShip).toBe(3);
  });
});

describe("Bật cách 'hàng trong kho' cho mọi shop (26/11/2026)", () => {
  it("shop CHƯA có dòng cài đặt chạy cách mới; lưu một cài đặt khác không lặng lẽ đổi cách; dòng LEGACY thì về cách cũ", async () => {
    const fx = await createStockFixture("sc-default");
    try {
      await prisma.shopSyncSetting.deleteMany({ where: { userId: fx.userId } });
      const p = await fx.createProduct(10);
      const o = await fx.createOrder(p, 4);
      await prisma.$transaction((tx) => deductStockTx(tx, o, "test"));
      const list = await call(fx, "GET", "/api/products?awaiting=1&pageSize=100");
      expect(list.body.stockModel).toBe("ON_HAND");
      const row = (list.body.items as Json[]).find((x) => x.id === p)!;
      expect(row).toMatchObject({ stockModel: "ON_HAND", onHand: 10, heldQuantity: 4, quantityInStock: 6 });
      expect((await call(fx, "GET", "/api/inventory/sync-settings")).body.stockModel).toBe("ON_HAND");

      // Khách lưu tồn an toàn → dòng cài đặt được tạo, cách hiển thị vẫn là cách mới.
      const put = await call(fx, "PUT", "/api/inventory/sync-settings", { safetyStockDefault: 1 });
      expect(put.status).toBe(200);
      expect(put.body.stockModel).toBe("ON_HAND");
      expect((await prisma.shopSyncSetting.findUniqueOrThrow({ where: { userId: fx.userId } })).stockModel).toBe("ON_HAND");

      // Hubsell cho riêng shop này về cách cũ.
      await setStockSettings(fx.userId, { stockModel: "LEGACY" });
      expect((await call(fx, "GET", "/api/products?pageSize=100")).body.stockModel).toBe("LEGACY");
    } finally {
      await fx.cleanup();
    }
  });

  it("công tắc khẩn STOCK_MODEL_FORCE=LEGACY đưa cả shop đã bật về cách cũ, gỡ ra thì về lại", async () => {
    process.env.STOCK_MODEL_FORCE = "LEGACY";
    try {
      expect((await call(shop, "GET", "/api/products?pageSize=20")).body.stockModel).toBe("LEGACY");
    } finally {
      delete process.env.STOCK_MODEL_FORCE;
    }
    expect((await call(shop, "GET", "/api/products?pageSize=20")).body.stockModel).toBe("ON_HAND");
  });
});

describe("Tra mã quét (GET /api/orders/lookup?fast=1)", () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const TRACK = `SCTRK${stamp}A1`;
  const RET = `SCRET${stamp}B2`;
  let orderId = "";
  let orderCode = "";

  beforeAll(async () => {
    const p = await shop.createProduct(5);
    orderId = await shop.createOrder(p, 1, `SCORD${stamp}C3`);
    orderCode = `SCORD${stamp}C3`;
    await prisma.order.update({ where: { id: orderId }, data: { trackingCode: TRACK, returnTrackingCode: RET } });
  });

  it("khớp chính xác theo mã vận đơn chiều đi, mã đơn, mã vận đơn chiều hoàn", async () => {
    for (const code of [TRACK, orderCode, RET]) {
      const r = await call(shop, "GET", `/api/orders/lookup?fast=1&code=${code}`);
      expect(r.status).toBe(200);
      expect(r.body.order.id).toBe(orderId);
    }
  });

  it("shop khác quét đúng mã đó thì không ra đơn", async () => {
    for (const code of [TRACK, orderCode, RET, TRACK.slice(2)]) {
      expect((await call(other, "GET", `/api/orders/lookup?fast=1&code=${code}`)).status).toBe(404);
    }
  });

  it("khớp lỏng: quét thiếu đầu / đuôi mã vẫn ra đơn (không phân biệt hoa thường)", async () => {
    const r = await call(shop, "GET", `/api/orders/lookup?fast=1&code=${TRACK.slice(2).toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(r.body.order.id).toBe(orderId);
    const r2 = await call(shop, "GET", `/api/orders/lookup?fast=1&code=${RET.slice(0, -1)}`);
    expect(r2.body.order.id).toBe(orderId);
  });

  it("khớp lỏng ra nhiều đơn thì báo 409, không đoán", async () => {
    const p = await shop.createProduct(5);
    const o2 = await shop.createOrder(p, 1);
    await prisma.order.update({ where: { id: o2 }, data: { trackingCode: `${TRACK}X` } });
    const r = await call(shop, "GET", `/api/orders/lookup?fast=1&code=${TRACK.slice(1)}`);
    expect(r.status).toBe(409);
    expect((r.body.candidates as Json[]).length).toBe(2);
    await prisma.order.delete({ where: { id: o2 } });
  });

  it("ký tự % và _ trong mã quét là ký tự thường, không khớp bừa", async () => {
    expect((await call(shop, "GET", `/api/orders/lookup?fast=1&code=${encodeURIComponent("%%%%%%")}`)).status).toBe(404);
    expect((await call(shop, "GET", `/api/orders/lookup?fast=1&code=${encodeURIComponent("______")}`)).status).toBe(404);
  });

  it("khớp lỏng chỉ tìm đơn trong cửa sổ ngày + trần số đơn mỗi gian; khớp chính xác thì đơn cũ mấy cũng ra", async () => {
    const p = await shop.createProduct(5);
    const oldId = await shop.createOrder(p, 1);
    const oldTrack = `SCOLD${stamp}Z9`;
    await prisma.order.update({
      where: { id: oldId },
      data: { trackingCode: oldTrack, createdAt: new Date(Date.now() - (LOOKUP_LOOSE_DAYS + 10) * 86_400_000) },
    });
    expect((await call(shop, "GET", `/api/orders/lookup?fast=1&code=${oldTrack}`)).body.order.id).toBe(oldId);
    expect((await call(shop, "GET", `/api/orders/lookup?fast=1&code=${oldTrack.slice(2)}`)).status).toBe(404);
    // Trần số đơn: chỉ đọc 1 đơn mới nhất của gian thì đơn tạo trước đó không còn trong tầm khớp lỏng.
    const newest = await shop.createOrder(p, 1);
    expect(await looseLookupIds([shop.channelId], TRACK.slice(2), { rows: 1 })).toEqual([]);
    expect(await looseLookupIds([shop.channelId], TRACK.slice(2))).toEqual([orderId]);
    await prisma.order.deleteMany({ where: { id: { in: [oldId, newest] } } });
  });
});
