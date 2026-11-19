// ============================================================
// KIỂM KÊ THEO PHIÊN — kho chuẩn quốc tế LÁT 5 (20/11/2026, docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 17).
//
// Chạy app Express thật trên cổng ngẫu nhiên + DB dev. Điều phải giữ:
//   · nhiều người đếm vào một phiên: "add" cộng dồn, không ai đè ai;
//   · KHÔNG ghi gì vào kho cho tới khi chủ shop duyệt; nhân viên không tự duyệt được;
//   · duyệt ghi PHẦN CHÊNH so với số sổ lúc đếm → hàng bán / rời kho trong lúc chờ duyệt không bị
//     cộng ngược lại (ở cả shop cách cũ lẫn shop ON_HAND);
//   · duyệt hai lần / bấm cùng lúc không áp trùng; phiên đã áp dở không hủy, không mở lại được;
//   · đếm mù: nhân viên không nhận số sổ khi đang đếm.
// ============================================================
import "./load-env";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { signToken } from "../../middleware/auth";
import { deductStockTx, shipStockTx } from "../order-stock";
import { createRootLocationTx } from "../../services/stock-ledger";
import { createStockFixture, type StockFixture } from "./fixtures";

let legacy: StockFixture;
let onHand: StockFixture;
let staffId = "";
let server: Server;
let baseUrl = "";

type Json = Record<string, any>;
async function callAs(userId: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${signToken(userId)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}
const call = (fx: StockFixture, method: string, path: string, body?: unknown) => callAs(fx.userId, method, path, body);
const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).quantityInStock;
const open = async (fx: StockFixture, body: Json = {}) => {
  const r = await call(fx, "POST", "/api/stocktakes", body);
  expect(r.status).toBe(200);
  return r.body.id as string;
};
const count = (who: string, id: string, items: Json[]) => callAs(who, "POST", `/api/stocktakes/${id}/count`, { items });
const lineOf = async (fx: StockFixture, id: string, productId: string) =>
  ((await call(fx, "GET", `/api/stocktakes/${id}`)).body.lines as Json[]).find((l) => l.productId === productId);

beforeAll(async () => {
  legacy = await createStockFixture("kk-old");
  onHand = await createStockFixture("kk-new");
  await prisma.shopSyncSetting.create({ data: { userId: onHand.userId, stockModel: "ON_HAND" } });
  const staff = await prisma.user.create({
    data: {
      email: `test-kk-staff-${Date.now()}@hubsell.test`,
      passwordHash: "x",
      fullName: "TEST nhân viên kho",
      role: "WAREHOUSE",
      ownerId: legacy.userId,
      permissions: ["warehouse.products"],
    },
  });
  staffId = staff.id;
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.stocktakeSession.deleteMany({ where: { ownerId: { in: [legacy.userId, onHand.userId] } } });
  await prisma.user.delete({ where: { id: staffId } }).catch(() => undefined);
  for (const fx of [legacy, onHand]) await fx.cleanup();
});

describe("Đếm vào phiên", () => {
  it("hai người đếm cùng một mã: add cộng dồn; counted đặt lại số; counted null bỏ dòng; chưa duyệt thì kho đứng yên", async () => {
    const p = await legacy.createProduct(10);
    const q = await legacy.createProduct(5);
    const id = await open(legacy);
    expect((await count(legacy.userId, id, [{ productId: p, add: 3 }])).status).toBe(200);
    const b = await count(staffId, id, [{ productId: p, add: 4 }, { productId: q, counted: 5 }]);
    expect(b.status).toBe(200);
    expect((b.body.lines as Json[]).find((l) => l.productId === p)).toMatchObject({ counted: 7, bookAtCount: 10 });
    // Bắn song song 10 lượt +1 vào cùng một mã — không lượt nào mất.
    await Promise.all(Array.from({ length: 10 }, () => count(staffId, id, [{ productId: p, add: 1 }])));
    expect(await lineOf(legacy, id, p)).toMatchObject({ counted: 17, countedByName: "TEST nhân viên kho" });
    expect((await count(legacy.userId, id, [{ productId: p, counted: 9 }])).status).toBe(200);
    expect(await lineOf(legacy, id, p)).toMatchObject({ counted: 9 });
    expect((await count(legacy.userId, id, [{ productId: q, counted: null }])).body.cleared).toEqual([q]);
    expect(await lineOf(legacy, id, q)).toBeUndefined();
    expect(await stockOf(p)).toBe(10);
    expect(await prisma.inventoryLog.count({ where: { productId: p } })).toBe(0);
  });

  it("số đếm sai, mã của shop khác, phiên của shop khác đều bị từ chối", async () => {
    const p = await legacy.createProduct(10);
    const foreign = await onHand.createProduct(10);
    const id = await open(legacy);
    expect((await count(legacy.userId, id, [{ productId: p, counted: -1 }])).status).toBe(400);
    expect((await count(legacy.userId, id, [{ productId: p, add: 0 }])).status).toBe(400);
    expect((await count(legacy.userId, id, [{ productId: p, counted: 1.5 }])).status).toBe(400);
    expect((await count(legacy.userId, id, [])).status).toBe(400);
    expect((await count(legacy.userId, id, [{ productId: foreign, counted: 1 }])).status).toBe(404);
    expect((await count(onHand.userId, id, [{ productId: foreign, counted: 1 }])).status).toBe(404);
    expect((await call(onHand, "GET", `/api/stocktakes/${id}`)).status).toBe(404);
  });

  it("đếm mù: nhân viên không nhận số sổ khi đang đếm; chủ shop vẫn thấy; gửi duyệt xong thì ai cũng thấy", async () => {
    const p = await legacy.createProduct(10);
    const id = await open(legacy, { blind: true });
    const w = await count(staffId, id, [{ productId: p, counted: 8 }]);
    expect(w.body.lines[0]).toEqual({ productId: p, counted: 8 });
    const asStaff = await callAs(staffId, "GET", `/api/stocktakes/${id}`);
    expect(asStaff.body.hideBook).toBe(true);
    expect(asStaff.body.lines[0].bookAtCount).toBeUndefined();
    expect(asStaff.body.lines[0].drift).toBeUndefined();
    const asOwner = await call(legacy, "GET", `/api/stocktakes/${id}`);
    expect(asOwner.body.hideBook).toBe(false);
    expect(asOwner.body.lines[0]).toMatchObject({ counted: 8, bookAtCount: 10, drift: 0 });
    expect((await callAs(staffId, "POST", `/api/stocktakes/${id}/submit`)).status).toBe(200);
    const after = await callAs(staffId, "GET", `/api/stocktakes/${id}`);
    expect(after.body.hideBook).toBe(false);
    expect(after.body.lines[0].bookAtCount).toBe(10);
  });
});

describe("Gửi duyệt, duyệt, hủy", () => {
  it("nhân viên gửi duyệt được nhưng KHÔNG duyệt được; phiên rỗng không gửi được; gửi rồi thì không đếm thêm", async () => {
    const p = await legacy.createProduct(10);
    const id = await open(legacy);
    expect((await callAs(staffId, "POST", `/api/stocktakes/${id}/submit`)).status).toBe(400);
    await count(staffId, id, [{ productId: p, counted: 8 }]);
    expect((await callAs(staffId, "POST", `/api/stocktakes/${id}/approve`)).status).toBe(403);
    expect((await call(legacy, "POST", `/api/stocktakes/${id}/approve`)).status).toBe(409); // chưa gửi duyệt
    expect((await callAs(staffId, "POST", `/api/stocktakes/${id}/submit`)).status).toBe(200);
    expect((await count(staffId, id, [{ productId: p, counted: 7 }])).status).toBe(409);
    expect((await callAs(staffId, "POST", `/api/stocktakes/${id}/approve`)).status).toBe(403);
    expect(await stockOf(p)).toBe(10);
  });

  it("shop cách cũ: duyệt ghi PHẦN CHÊNH so với sổ lúc đếm — hàng bán trong lúc chờ duyệt không bị cộng ngược lại", async () => {
    const p = await legacy.createProduct(20);
    const same = await legacy.createProduct(6);
    const id = await open(legacy);
    await count(staffId, id, [
      { productId: p, counted: 18 }, // sổ 20, đếm 18 → thiếu 2
      { productId: same, counted: 6 }, // khớp
    ]);
    await callAs(staffId, "POST", `/api/stocktakes/${id}/submit`);
    // Trong lúc chờ duyệt có đơn trừ 5 → sổ còn 15.
    const o = await legacy.createOrder(p, 5);
    await prisma.$transaction((tx) => deductStockTx(tx, o, "test phiên kiểm kê"));
    expect((await lineOf(legacy, id, p))!.drift).toBe(-5);

    const r = await call(legacy, "POST", `/api/stocktakes/${id}/approve`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "APPROVED", lineCount: 2, adjustedCount: 1, totalDown: 2, totalUp: 0 });
    // 15 − 2 = 13. Ghi đè bằng số đếm sẽ ra 18, cộng ngược 5 chiếc đã bán.
    expect(await stockOf(p)).toBe(13);
    expect(await stockOf(same)).toBe(6);
    const log = await prisma.inventoryLog.findFirstOrThrow({ where: { productId: p, kind: "STOCKTAKE" } });
    expect(log.changeQuantity).toBe(-2);
    expect(log.reason).toContain("sổ 20, đếm 18, chênh -2");
    expect(await prisma.inventoryLog.count({ where: { productId: same } })).toBe(0);
    expect(await lineOf(legacy, id, p)).toMatchObject({ delta: -2, bookAtApply: 15, applied: true });

    // Duyệt lại / mở lại / hủy sau khi đã duyệt đều bị từ chối, kho không đổi nữa.
    expect((await call(legacy, "POST", `/api/stocktakes/${id}/approve`)).status).toBe(409);
    expect((await call(legacy, "POST", `/api/stocktakes/${id}/reopen`)).status).toBe(409);
    expect((await call(legacy, "POST", `/api/stocktakes/${id}/cancel`)).status).toBe(409);
    expect(await stockOf(p)).toBe(13);
    const list = await call(legacy, "GET", "/api/stocktakes");
    expect((list.body.items as Json[]).find((s) => s.id === id)).toMatchObject({ status: "APPROVED", adjustedCount: 1, totalDown: 2 });
  });

  it("shop ON_HAND: số sổ là hàng trong kho (gồm kiện đã gói); kiện rời kho trong lúc chờ duyệt không làm lệch", async () => {
    const p = await onHand.createProduct(20);
    const o = await onHand.createOrder(p, 3);
    await prisma.$transaction((tx) => deductStockTx(tx, o, "test phiên kiểm kê")); // sổ 17, giữ 3 → trong kho 20
    const id = await open(onHand);
    const w = await count(onHand.userId, id, [{ productId: p, counted: 21 }]); // đếm thừa 1
    expect(w.body.lines[0]).toMatchObject({ counted: 21, bookAtCount: 20 });
    await call(onHand, "POST", `/api/stocktakes/${id}/submit`);
    await prisma.$transaction((tx) => shipStockTx(tx, o, "PLATFORM")); // trong kho còn 17
    const r = await call(onHand, "POST", `/api/stocktakes/${id}/approve`);
    expect(r.body).toMatchObject({ adjustedCount: 1, totalUp: 1, totalDown: 0 });
    expect(await stockOf(p)).toBe(18); // 17 + 1
    expect(await lineOf(onHand, id, p)).toMatchObject({ delta: 1, bookAtApply: 17 });
  });

  it("phiên theo vị trí: số sổ và bút toán đều tại vị trí đó", async () => {
    const fx = await createStockFixture("kk-loc");
    try {
      const root = await prisma.$transaction((tx) => createRootLocationTx(tx, fx.userId));
      const p = await fx.createProduct(0);
      await call(fx, "POST", "/api/inventory/adjust", { productId: p, type: "IMPORT", quantity: 12, locationId: root.id });
      const id = await open(fx, { locationId: root.id });
      const w = await count(fx.userId, id, [{ productId: p, counted: 10 }]);
      expect(w.body.lines[0]).toMatchObject({ bookAtCount: 12 });
      await call(fx, "POST", `/api/stocktakes/${id}/submit`);
      expect((await call(fx, "POST", `/api/stocktakes/${id}/approve`)).status).toBe(200);
      expect(await stockOf(p)).toBe(10);
      const lv = await prisma.productStockLevel.findUniqueOrThrow({ where: { productId_locationId: { productId: p, locationId: root.id } } });
      expect(lv.quantity).toBe(10);
      const log = await prisma.inventoryLog.findFirstOrThrow({ where: { productId: p, kind: "STOCKTAKE" } });
      expect(log.locationId).toBe(root.id);
    } finally {
      await prisma.stocktakeSession.deleteMany({ where: { ownerId: fx.userId } });
      await fx.cleanup();
    }
  });

  it("hai lượt duyệt cùng lúc: mỗi dòng chỉ áp MỘT lần", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await legacy.createProduct(10));
    const id = await open(legacy);
    await count(legacy.userId, id, ids.map((productId) => ({ productId, counted: 7 })));
    await call(legacy, "POST", `/api/stocktakes/${id}/submit`);
    const rs = await Promise.all([
      call(legacy, "POST", `/api/stocktakes/${id}/approve`),
      call(legacy, "POST", `/api/stocktakes/${id}/approve`),
    ]);
    expect(rs.some((r) => r.status === 200)).toBe(true);
    for (const productId of ids) {
      expect(await stockOf(productId)).toBe(7);
      expect(await prisma.inventoryLog.count({ where: { productId, kind: "STOCKTAKE" } })).toBe(1);
    }
    expect((await call(legacy, "GET", `/api/stocktakes/${id}`)).body.session.status).toBe("APPROVED");
  });

  it("mở lại để đếm tiếp rồi gửi lại; hủy thì không ghi gì; nhân viên chỉ hủy được phiên mình mở", async () => {
    const p = await legacy.createProduct(10);
    const id = await open(legacy);
    await count(staffId, id, [{ productId: p, counted: 8 }]);
    await callAs(staffId, "POST", `/api/stocktakes/${id}/submit`);
    expect((await callAs(staffId, "POST", `/api/stocktakes/${id}/reopen`)).status).toBe(200);
    expect((await count(staffId, id, [{ productId: p, counted: 9 }])).status).toBe(200);
    // Phiên do chủ shop mở → nhân viên không hủy được; chủ shop hủy được.
    expect((await callAs(staffId, "POST", `/api/stocktakes/${id}/cancel`)).status).toBe(403);
    expect((await call(legacy, "POST", `/api/stocktakes/${id}/cancel`)).status).toBe(200);
    expect((await count(staffId, id, [{ productId: p, counted: 1 }])).status).toBe(409);
    expect((await call(legacy, "POST", `/api/stocktakes/${id}/approve`)).status).toBe(409);
    expect(await stockOf(p)).toBe(10);
    // Nhân viên tự mở thì tự hủy được.
    const mine = await callAs(staffId, "POST", "/api/stocktakes", {});
    expect((await callAs(staffId, "POST", `/api/stocktakes/${mine.body.id}/cancel`)).status).toBe(200);
  });

  it("mã bị xóa khỏi kho sau lúc đếm: duyệt bỏ qua dòng đó, các dòng khác vẫn áp", async () => {
    const gone = await legacy.createProduct(4);
    const kept = await legacy.createProduct(4);
    const id = await open(legacy);
    await count(legacy.userId, id, [
      { productId: gone, counted: 1 },
      { productId: kept, counted: 6 },
    ]);
    await call(legacy, "POST", `/api/stocktakes/${id}/submit`);
    await prisma.product.delete({ where: { id: gone } });
    const r = await call(legacy, "POST", `/api/stocktakes/${id}/approve`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lineCount: 2, adjustedCount: 1, totalUp: 2, totalDown: 0 });
    expect(await stockOf(kept)).toBe(6);
    expect(await lineOf(legacy, id, gone)).toMatchObject({ delta: null, applied: true });
  });
});
