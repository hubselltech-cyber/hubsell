// ============================================================
// VỊ TRÍ CHỨA HÀNG (đợt B) — test tích hợp trên DB dev: bật vị trí lần đầu đổ
// tồn vào gốc, trừ đơn phân bổ theo ưu tiên, hủy đơn trả về đúng vị trí, chuyển
// vị trí giữ tổng, sửa số tại vị trí đổi tổng, hàng hoàn về nơi nhận hoàn.
// Bất biến kiểm ở mỗi bước: Σ level = Product.quantityInStock.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InventoryLogType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { deductStockTx, restoreStockTx } from "../order-stock";
import {
  applyStockDelta,
  createRootLocationTx,
  setLevelAbsolute,
  transferStockTx,
} from "../../services/stock-ledger";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let productId: string;
let rootId: string;
let kho2Id: string;

async function levels(pid: string): Promise<Record<string, number>> {
  const rows = await prisma.productStockLevel.findMany({
    where: { productId: pid },
    select: { locationId: true, quantity: true },
  });
  return Object.fromEntries(rows.map((r) => [r.locationId, r.quantity]));
}
async function total(pid: string): Promise<number> {
  const p = await prisma.product.findUniqueOrThrow({ where: { id: pid } });
  return p.quantityInStock;
}
async function expectInvariant(pid: string) {
  const lv = await levels(pid);
  const sum = Object.values(lv).reduce((a, b) => a + b, 0);
  expect(sum).toBe(await total(pid));
}

beforeAll(async () => {
  fx = await createStockFixture("loc");
  productId = await fx.createProduct(10);
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Vị trí chứa hàng", () => {
  it("bật lần đầu: gốc nhận toàn bộ tồn hiện có, SKU tồn 0 không sinh dòng", async () => {
    const zero = await fx.createProduct(0);
    const root = await prisma.$transaction((tx) => createRootLocationTx(tx, fx.userId));
    rootId = root.id;
    expect(await levels(productId)).toEqual({ [rootId]: 10 });
    expect(await levels(zero)).toEqual({});
    await expectInvariant(productId);

    const kho2 = await prisma.stockLocation.create({
      data: { userId: fx.userId, name: "Kho 2", sortOrder: 1 },
    });
    kho2Id = kho2.id;
  });

  it("chuyển vị trí: tổng không đổi, hai dòng TRANSFER kèm vị trí", async () => {
    await prisma.$transaction((tx) =>
      transferStockTx(tx, {
        productId,
        fromLocationId: rootId,
        toLocationId: kho2Id,
        quantity: 4,
        reason: "test chuyển",
      })
    );
    expect(await levels(productId)).toEqual({ [rootId]: 6, [kho2Id]: 4 });
    expect(await total(productId)).toBe(10);
    const logs = await prisma.inventoryLog.findMany({
      where: { productId, type: InventoryLogType.TRANSFER },
      orderBy: { changeQuantity: "asc" },
    });
    expect(logs.map((l) => [l.locationId, l.changeQuantity, l.balanceAfter])).toEqual([
      [rootId, -4, 10],
      [kho2Id, 4, 10],
    ]);

    await expect(
      prisma.$transaction((tx) =>
        transferStockTx(tx, {
          productId,
          fromLocationId: kho2Id,
          toLocationId: rootId,
          quantity: 99,
          reason: "quá tay",
        })
      )
    ).rejects.toThrow(/không đủ/);
  });

  it("đơn trừ theo ưu tiên: vị trí đủ cả dòng lấy trọn; không ai đủ thì trừ lần lượt", async () => {
    // Gốc 6, Kho 2 4. Đơn 5 → gốc đủ → gốc 1.
    const o1 = await fx.createOrder(productId, 5);
    await prisma.$transaction((tx) => deductStockTx(tx, o1, "test"));
    expect(await levels(productId)).toEqual({ [rootId]: 1, [kho2Id]: 4 });
    await expectInvariant(productId);

    // Gốc 1, Kho 2 4. Đơn 5 → không ai đủ → gốc 1 + Kho 2 4 → hai dòng log.
    const o2 = await fx.createOrder(productId, 5);
    await prisma.$transaction((tx) => deductStockTx(tx, o2, "test"));
    expect(await levels(productId)).toEqual({ [rootId]: 0, [kho2Id]: 0 });
    expect(await total(productId)).toBe(0);
    const o2logs = await prisma.inventoryLog.findMany({ where: { orderId: o2 } });
    expect(o2logs.map((l) => [l.locationId, l.changeQuantity]).sort()).toEqual(
      [
        [rootId, -1],
        [kho2Id, -4],
      ].sort()
    );

    // Hủy đơn 2 → trả về ĐÚNG hai vị trí đã trừ.
    await prisma.$transaction((tx) => restoreStockTx(tx, o2, "test"));
    expect(await levels(productId)).toEqual({ [rootId]: 1, [kho2Id]: 4 });
    await expectInvariant(productId);
  });

  it("bán vượt: thiếu toàn kho thì vị trí cuối cùng âm, tổng âm — không chặn", async () => {
    // Gốc 1, Kho 2 4 = 5. Đơn 7.
    const o3 = await fx.createOrder(productId, 7);
    await prisma.$transaction((tx) => deductStockTx(tx, o3, "test"));
    expect(await levels(productId)).toEqual({ [rootId]: 0, [kho2Id]: -2 });
    expect(await total(productId)).toBe(-2);
    await prisma.$transaction((tx) => restoreStockTx(tx, o3, "test"));
    expect(await levels(productId)).toEqual({ [rootId]: 1, [kho2Id]: 4 });
  });

  it("sửa số tại vị trí: tổng đổi theo đúng chênh lệch, log ADJUST kèm vị trí", async () => {
    const r = await prisma.$transaction((tx) =>
      setLevelAbsolute(tx, { productId, locationId: kho2Id, quantity: 9, reason: "kiểm" })
    );
    expect(r.previous).toBe(4);
    expect(r.delta).toBe(5);
    expect(await levels(productId)).toEqual({ [rootId]: 1, [kho2Id]: 9 });
    expect(await total(productId)).toBe(10);
    await expectInvariant(productId);
  });

  it("hàng hoàn: có nơi nhận hoàn thì về đó, không thì về đúng vị trí đã trừ", async () => {
    // Không đặt nơi nhận hoàn → về vị trí chỉ định (gốc).
    await prisma.$transaction((tx) =>
      applyStockDelta(tx, {
        productId,
        delta: 2,
        type: InventoryLogType.SYNC,
        reason: "hoàn",
        locationId: rootId,
        useReturnDefault: true,
      })
    );
    expect(await levels(productId)).toEqual({ [rootId]: 3, [kho2Id]: 9 });

    // Đặt Kho 2 là nơi nhận hoàn → dù đã trừ ở gốc vẫn về Kho 2.
    await prisma.stockLocation.update({ where: { id: kho2Id }, data: { isReturnDefault: true } });
    await prisma.$transaction((tx) =>
      applyStockDelta(tx, {
        productId,
        delta: 1,
        type: InventoryLogType.SYNC,
        reason: "hoàn",
        locationId: rootId,
        useReturnDefault: true,
      })
    );
    expect(await levels(productId)).toEqual({ [rootId]: 3, [kho2Id]: 10 });
    await expectInvariant(productId);
  });

  it("nhập tay có chỉ định vị trí thì vào đúng vị trí; không chỉ định thì vào gốc", async () => {
    await prisma.$transaction((tx) =>
      applyStockDelta(tx, {
        productId,
        delta: 5,
        type: InventoryLogType.IMPORT,
        reason: "nhập kho 2",
        locationId: kho2Id,
      })
    );
    await prisma.$transaction((tx) =>
      applyStockDelta(tx, { productId, delta: 1, type: InventoryLogType.IMPORT, reason: "nhập" })
    );
    expect(await levels(productId)).toEqual({ [rootId]: 4, [kho2Id]: 15 });
    await expectInvariant(productId);
  });
});
