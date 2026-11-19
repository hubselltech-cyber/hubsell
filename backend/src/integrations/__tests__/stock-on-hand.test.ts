// ============================================================
// "TỒN KHO = HÀNG TRONG KHO" theo cài đặt của shop — kho chuẩn quốc tế LÁT 3 (20/11/2026)
// Thiết kế: docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 4, 5.3, 5.4, 5.5, 15.
//
// Chạy app Express thật trên cổng ngẫu nhiên + DB dev. Hai shop:
//   onHand — shop_sync_settings.stockModel = ON_HAND (chuẩn): Tồn kho = sổ + đang giữ + không bán;
//            sửa ô / Excel đặt số trong kho; Kiểm kê ghi PHẦN CHÊNH.
//   legacy — mặc định: mọi thứ y như trước ngày 20/11 (không shop nào đổi số ngày lên bản).
// Bất biến phải giữ: số đẩy sàn (availableToSell) chỉ phụ thuộc sổ − giữ tạm − an toàn ở cả hai.
// ============================================================
import "./load-env";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { signToken } from "../../middleware/auth";
import { deductStockTx, holdStockTx, shipStockTx } from "../order-stock";
import { createRootLocationTx } from "../../services/stock-ledger";
import { createStockFixture, type StockFixture } from "./fixtures";

let onHand: StockFixture;
let legacy: StockFixture;
let stats: StockFixture;
let located: StockFixture;
let server: Server;
let baseUrl = "";

const deduct = (id: string) => prisma.$transaction((tx) => deductStockTx(tx, id, "test tồn kho"));
const ship = (id: string) => prisma.$transaction((tx) => shipStockTx(tx, id, "PLATFORM"));
const productOf = (id: string) =>
  prisma.product.findUniqueOrThrow({
    where: { id },
    select: { quantityInStock: true, holdQuantity: true, committedQuantity: true },
  });

type Json = Record<string, any>;
async function call(fx: StockFixture, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${signToken(fx.userId)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}
async function importExcel(fx: StockFixture, rows: Json[]): Promise<{ status: number; body: Json }> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buf)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "kho.xlsx"
  );
  const r = await fetch(`${baseUrl}/api/products/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${signToken(fx.userId)}` },
    body: form,
  });
  return { status: r.status, body: (await r.json()) as Json };
}
const skuOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id }, select: { skuCode: true, productName: true } }));
/** Đường nhập Excel tự viết HOA mã SKU → mã của bộ dựng test (có chữ thường) phải viết hoa trước mới khớp mã đã có. */
const upperSku = async (id: string) => {
  const { skuCode } = await skuOf(id);
  return prisma.product.update({ where: { id }, data: { skuCode: skuCode.toUpperCase() }, select: { skuCode: true, productName: true } });
};
const listItem = async (fx: StockFixture, productId: string) => {
  const sku = (await skuOf(productId)).skuCode;
  const r = await call(fx, "GET", `/api/products?page=1&pageSize=20&search=${encodeURIComponent(sku)}&awaiting=1`);
  expect(r.status).toBe(200);
  return { top: r.body, item: (r.body.items as Json[]).find((i) => i.id === productId)! };
};

beforeAll(async () => {
  onHand = await createStockFixture("oh-new");
  legacy = await createStockFixture("oh-old");
  stats = await createStockFixture("oh-stats");
  located = await createStockFixture("oh-loc");
  for (const fx of [onHand, stats, located]) {
    await prisma.shopSyncSetting.create({ data: { userId: fx.userId, stockModel: "ON_HAND" } });
  }
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const fx of [onHand, legacy, stats, located]) await fx.cleanup();
});

describe("Danh sách sản phẩm — ba ngăn số", () => {
  it("shop ON_HAND: Tồn kho (onHand) gồm cả hàng đang giữ cho đơn; Có thể bán không đổi nghĩa; hàng rời kho thì Tồn kho mới giảm", async () => {
    const p = await onHand.createProduct(20);
    const o = await onHand.createOrder(p, 3);
    await deduct(o);
    let { top, item } = await listItem(onHand, p);
    expect(top.stockModel).toBe("ON_HAND");
    expect(top.restockOnReturn).toBe("ON_CANCEL");
    expect(item).toMatchObject({ quantityInStock: 17, onHand: 20, heldQuantity: 3, unsellableQuantity: 0, availableToSell: 17 });

    await ship(o);
    ({ item } = await listItem(onHand, p));
    expect(item).toMatchObject({ quantityInStock: 17, onHand: 17, heldQuantity: 0, availableToSell: 17 });
  });

  it("đơn chưa thanh toán (giữ tạm) nằm trong Đang giữ, không làm đổi Tồn kho", async () => {
    const p = await onHand.createProduct(10);
    const o = await onHand.createOrder(p, 4);
    await prisma.$transaction((tx) => holdStockTx(tx, o));
    const { item } = await listItem(onHand, p);
    expect(item).toMatchObject({ quantityInStock: 10, onHand: 10, heldQuantity: 4, availableToSell: 6 });
  });

  it("shop mặc định: stockModel = LEGACY (màn hình giữ nguyên cách cũ)", async () => {
    const p = await legacy.createProduct(20);
    const o = await legacy.createOrder(p, 3);
    await deduct(o);
    const { top, item } = await listItem(legacy, p);
    expect(top.stockModel).toBe("LEGACY");
    expect(item).toMatchObject({ quantityInStock: 17, availableToSell: 17, awaitingShip: 3 });
  });

  it("lọc Hết hàng: shop ON_HAND tính theo khả dụng (sổ − giữ tạm ≤ 0); shop LEGACY vẫn theo sổ ≤ 0", async () => {
    const mk = async (fx: StockFixture) => {
      const p = await fx.createProduct(2);
      const o = await fx.createOrder(p, 2);
      await prisma.$transaction((tx) => holdStockTx(tx, o)); // sổ 2, giữ tạm 2 → khả dụng 0
      return p;
    };
    const pNew = await mk(onHand);
    const pOld = await mk(legacy);
    const out = async (fx: StockFixture, id: string) => {
      const sku = (await skuOf(id)).skuCode;
      const r = await call(fx, "GET", `/api/products?page=1&pageSize=20&stock=out&search=${encodeURIComponent(sku)}`);
      return (r.body.items as Json[]).some((i) => i.id === id);
    };
    expect(await out(onHand, pNew)).toBe(true);
    expect(await out(legacy, pOld)).toBe(false);
  });
});

describe("Sửa ô Tồn kho (POST /api/inventory/set)", () => {
  it("shop ON_HAND: số gõ là hàng TRONG KHO → tồn bán = số gõ − đang giữ; gõ đúng số đang có thì không ghi gì", async () => {
    const p = await onHand.createProduct(20);
    const o = await onHand.createOrder(p, 3);
    await deduct(o); // sổ 17, giữ 3, trong kho 20
    const same = await call(onHand, "POST", "/api/inventory/set", { productId: p, quantity: 20 });
    expect(same.status).toBe(200);
    expect(same.body.delta).toBe(0);
    expect(same.body.log).toBeNull();

    const r = await call(onHand, "POST", "/api/inventory/set", { productId: p, quantity: 25 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ delta: 5, stockModel: "ON_HAND", onHand: 25, previousOnHand: 20 });
    expect(await productOf(p)).toEqual({ quantityInStock: 22, holdQuantity: 0, committedQuantity: 3 });
    expect(r.body.log).toMatchObject({ changeQuantity: 5, kind: "SET", heldChange: 0, heldAfter: 3, onHandAfter: 25, balanceAfter: 22 });
  });

  it("shop ON_HAND: gõ thấp hơn phần đang giữ cho đơn → cảnh báo 409 kèm số thiếu, KHÔNG ghi; gửi lại kèm force thì ghi (tồn bán âm để lộ thiếu hàng)", async () => {
    const p = await onHand.createProduct(10);
    const o = await onHand.createOrder(p, 6);
    await deduct(o); // sổ 4, giữ 6, trong kho 10
    const warn = await call(onHand, "POST", "/api/inventory/set", { productId: p, quantity: 4 });
    expect(warn.status).toBe(409);
    expect(warn.body).toMatchObject({ code: "BELOW_HELD", committed: 6, onHand: 4, short: 2 });
    expect(await productOf(p)).toEqual({ quantityInStock: 4, holdQuantity: 0, committedQuantity: 6 });

    const forced = await call(onHand, "POST", "/api/inventory/set", { productId: p, quantity: 4, force: true });
    expect(forced.status).toBe(200);
    expect(await productOf(p)).toEqual({ quantityInStock: -2, holdQuantity: 0, committedQuantity: 6 });
  });

  it("shop LEGACY: số gõ ghi đè sổ tồn bán như trước", async () => {
    const p = await legacy.createProduct(20);
    const o = await legacy.createOrder(p, 3);
    await deduct(o);
    const r = await call(legacy, "POST", "/api/inventory/set", { productId: p, quantity: 25 });
    expect(r.status).toBe(200);
    expect(await productOf(p)).toEqual({ quantityInStock: 25, holdQuantity: 0, committedQuantity: 3 });
  });
});

describe("Kiểm kê", () => {
  it("shop ON_HAND: số sổ trên phiếu là hàng trong kho; chốt ghi PHẦN CHÊNH so với số sổ lúc đếm — hàng rời kho sau lúc đếm không bị cộng ngược lại", async () => {
    const p = await onHand.createProduct(20);
    const o = await onHand.createOrder(p, 3);
    await deduct(o); // sổ 17, giữ 3 → trong kho 20
    const rows = await call(onHand, "POST", "/api/inventory/stocktake/rows", { productIds: [p] });
    expect(rows.body.stockModel).toBe("ON_HAND");
    expect(rows.body.rows[0]).toMatchObject({ productId: p, book: 20, held: 3 });

    // Nhân viên đếm được 19 (thiếu 1 so với sổ 20). Trước khi bấm chốt, shipper lấy kiện của đơn.
    await ship(o); // trong kho còn 17
    const r = await call(onHand, "POST", "/api/inventory/stocktake", { items: [{ productId: p, counted: 19, book: 20 }] });
    expect(r.status).toBe(200);
    expect(r.body.adjusted).toBe(1);
    expect(r.body.lines[0]).toMatchObject({ productId: p, before: 17, after: 16, delta: -1, drift: -3 });
    // Chỉ lệch thật (−1) vào sổ: 17 − 1 = 16. Ghi đè kiểu cũ sẽ ra 19, cộng ngược 3 chiếc đã đi.
    expect(await productOf(p)).toEqual({ quantityInStock: 16, holdQuantity: 0, committedQuantity: 0 });
    const log = await prisma.inventoryLog.findFirstOrThrow({ where: { productId: p, kind: "STOCKTAKE" } });
    expect(log.changeQuantity).toBe(-1);
    expect(log.reason).toContain("sổ 20, đếm 19, chênh -1");
  });

  it("shop ON_HAND: đếm cả kiện đã gói chưa giao thì KHỚP sổ → không điều chỉnh gì (bản cũ sẽ cộng lại hàng đã bán)", async () => {
    const p = await onHand.createProduct(20);
    const o = await onHand.createOrder(p, 5);
    await deduct(o); // 15 trên kệ + 5 kiện đã gói = 20 trong kho
    const r = await call(onHand, "POST", "/api/inventory/stocktake", { items: [{ productId: p, counted: 20, book: 20 }] });
    expect(r.body.adjusted).toBe(0);
    expect(await productOf(p)).toEqual({ quantityInStock: 15, holdQuantity: 0, committedQuantity: 5 });
  });

  it("shop LEGACY: vẫn ghi đè sổ bằng số đếm như trước", async () => {
    const p = await legacy.createProduct(20);
    const r = await call(legacy, "POST", "/api/inventory/stocktake", { items: [{ productId: p, counted: 18 }] });
    expect(r.status).toBe(200);
    expect(r.body.lines[0]).toMatchObject({ before: 20, after: 18, delta: -2 });
    expect((await productOf(p)).quantityInStock).toBe(18);
  });
});

describe("Nhập Excel", () => {
  it("shop ON_HAND: cột Tồn kho là hàng trong kho; tệp không có cột Tồn kho thì KHÔNG đụng tồn; tệp xuất từ bản cũ (có cột Chờ giao) đọc theo nghĩa cũ", async () => {
    const p = await onHand.createProduct(20);
    const o = await onHand.createOrder(p, 3);
    await deduct(o); // sổ 17, giữ 3
    const { skuCode, productName } = await upperSku(p);

    const priceOnly = await importExcel(onHand, [{ "Mã SKU": skuCode, "Tên sản phẩm": productName, "Giá bán": 120000 }]);
    expect(priceOnly.status).toBe(200);
    expect(priceOnly.body.updated).toBe(1);
    expect((await productOf(p)).quantityInStock).toBe(17);

    const set = await importExcel(onHand, [{ "Mã SKU": skuCode, "Tên sản phẩm": productName, "Tồn kho": 30 }]);
    expect(set.body).toMatchObject({ updated: 1, stockColumn: "ON_HAND", legacyFile: false });
    expect(await productOf(p)).toEqual({ quantityInStock: 27, holdQuantity: 0, committedQuantity: 3 });

    const old = await importExcel(onHand, [{ "Mã SKU": skuCode, "Tên sản phẩm": productName, "Tồn kho": 27, "Chờ giao": 3 }]);
    expect(old.body).toMatchObject({ stockColumn: "SELLABLE", legacyFile: true });
    expect((await productOf(p)).quantityInStock).toBe(27);
  });

  it("shop LEGACY: cột Tồn kho đè sổ như trước; ô Tồn kho trống thì không đè về 0 nữa", async () => {
    const p = await legacy.createProduct(20);
    const { skuCode, productName } = await upperSku(p);
    await importExcel(legacy, [{ "Mã SKU": skuCode, "Tên sản phẩm": productName }]);
    expect((await productOf(p)).quantityInStock).toBe(20);
    const r = await importExcel(legacy, [{ "Mã SKU": skuCode, "Tên sản phẩm": productName, "Tồn kho": 12 }]);
    expect(r.body.stockColumn).toBe("SELLABLE");
    expect((await productOf(p)).quantityInStock).toBe(12);
  });
});

describe("Nhật ký kho + Thống kê + vị trí", () => {
  it("GET /api/inventory/logs trả đủ ba ngăn cho dòng mới", async () => {
    const p = await onHand.createProduct(9);
    const o = await onHand.createOrder(p, 2);
    await deduct(o);
    await ship(o);
    const r = await call(onHand, "GET", `/api/inventory/logs?productId=${p}&page=1&pageSize=20`);
    expect(r.status).toBe(200);
    const kinds = (r.body.items as Json[]).map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["RESERVE", "SHIP"]));
    const shipRow = (r.body.items as Json[]).find((i) => i.kind === "SHIP")!;
    expect(shipRow).toMatchObject({ changeQuantity: 0, heldChange: -2, heldAfter: 0, onHandAfter: 7, balanceAfter: 7 });
  });

  it("Thống kê: shop ON_HAND tính số lượng và giá trị trên hàng trong kho (gồm hàng đang giữ)", async () => {
    const p = await stats.createProduct(20);
    await prisma.product.update({ where: { id: p }, data: { costPrice: 10 } });
    const o = await stats.createOrder(p, 3);
    await deduct(o); // sổ 17, giữ 3
    const r = await call(stats, "GET", "/api/products/stats");
    expect(r.status).toBe(200);
    expect(r.body.stockModel).toBe("ON_HAND");
    expect(r.body.total).toMatchObject({ skus: 1, quantity: 20, value: 200 });
  });

  it("shop dùng vị trí, ON_HAND: phiếu đếm tại vị trí và ô sửa số tại vị trí đều theo hàng trong kho tại đó", async () => {
    const p = await located.createProduct(6);
    const root = await prisma.$transaction((tx) => createRootLocationTx(tx, located.userId));
    const o = await located.createOrder(p, 2);
    await deduct(o); // tại Kho chính: bán được 4, đang giữ 2 → trong kho 6
    const sheet = await call(located, "GET", `/api/inventory/stocktake/sheet?locationId=${root.id}`);
    expect(sheet.body.rows.find((r: Json) => r.productId === p)).toMatchObject({ book: 6, held: 2 });

    const set = await call(located, "POST", "/api/stock-locations/set-level", { productId: p, locationId: root.id, quantity: 10 });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ previous: 6, delta: 4 });
    expect(await productOf(p)).toEqual({ quantityInStock: 8, holdQuantity: 0, committedQuantity: 2 });

    const take = await call(located, "POST", "/api/inventory/stocktake", {
      locationId: root.id,
      items: [{ productId: p, counted: 9, book: 10 }],
    });
    expect(take.body.lines[0]).toMatchObject({ before: 10, after: 9, delta: -1, drift: 0 });
    expect(await productOf(p)).toEqual({ quantityInStock: 7, holdQuantity: 0, committedQuantity: 2 });
  });
});

describe("Cài đặt của shop", () => {
  it("chủ shop tự đổi cách cộng tồn hàng hoàn; giá trị lạ bị từ chối; cách hiển thị không đổi qua đường này", async () => {
    const bad = await call(legacy, "PUT", "/api/inventory/sync-settings", { restockOnReturn: "LUNG_TUNG" });
    expect(bad.status).toBe(400);
    const ok = await call(legacy, "PUT", "/api/inventory/sync-settings", { restockOnReturn: "ON_RECEIVE", stockModel: "ON_HAND" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ restockOnReturn: "ON_RECEIVE", stockModel: "LEGACY" });
    expect((await call(legacy, "GET", "/api/inventory/stock-model")).body).toEqual({ stockModel: "LEGACY", restockOnReturn: "ON_RECEIVE" });
    await call(legacy, "PUT", "/api/inventory/sync-settings", { restockOnReturn: "ON_CANCEL" });
  });
});
