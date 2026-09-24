// ============================================================
// Ô "KHÔNG BÁN" (đợt 2): hàng nằm ở ô sellable=false KHÔNG tính vào tồn bán.
//   · chuyển kho bán → ô không bán: tồn bán giảm; chuyển ngược: tồn bán tăng
//   · hàng hoàn về "nơi nhận hoàn" là ô không bán: tồn bán KHÔNG tăng cho tới khi chuyển
//   · đơn không bao giờ trừ ở ô không bán (phân bổ bỏ qua)
//   · sửa số tại ô không bán không đổi tồn bán
// Bất biến: Σ level(sellable) = Product.quantityInStock sau mỗi bước.
// Kèm: phiếu nhặt in "Vị trí: …" từ log trừ (×số, nhắc sổ âm), "Vị trí: … (còn N)" khi chưa trừ.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InventoryLogType } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../../lib/prisma";
import { deductStockTx } from "../order-stock";
import {
  applyStockDelta,
  createRootLocationTx,
  setLevelAbsolute,
  transferStockTx,
} from "../../services/stock-ledger";
import { pickLocationText, pickLocationTextForOrders } from "../../services/fulfillment/pick-location";
import { buildPickListPdf } from "../../services/fulfillment/pick-list-pdf";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
let productId: string;
let rootId: string;
let badId: string;

async function levels(pid: string) {
  const rows = await prisma.productStockLevel.findMany({
    where: { productId: pid },
    select: { locationId: true, quantity: true, location: { select: { sellable: true } } },
  });
  return rows;
}
async function total(pid: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id: pid } })).quantityInStock;
}
async function expectInvariant(pid: string) {
  const rows = await levels(pid);
  const sellableSum = rows.filter((r) => r.location.sellable).reduce((a, r) => a + r.quantity, 0);
  expect(sellableSum).toBe(await total(pid));
}
async function qtyAt(pid: string, locId: string) {
  return (await levels(pid)).find((r) => r.locationId === locId)?.quantity ?? 0;
}

beforeAll(async () => {
  fx = await createStockFixture("sellable");
  productId = await fx.createProduct(20);
  const root = await prisma.$transaction((tx) => createRootLocationTx(tx, fx.userId));
  rootId = root.id;
  const bad = await prisma.stockLocation.create({
    data: {
      userId: fx.userId,
      name: "Hàng hoàn chờ kiểm",
      sortOrder: 1,
      sellable: false,
      isReturnDefault: true,
    },
  });
  badId = bad.id;
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Ô không bán", () => {
  it("chuyển vào ô không bán → tồn bán giảm; chuyển ra → tăng lại", async () => {
    const r = await prisma.$transaction((tx) =>
      transferStockTx(tx, { productId, fromLocationId: rootId, toLocationId: badId, quantity: 5, reason: "cách ly" })
    );
    expect(r.totalChanged).toBe(true);
    expect(r.quantityInStock).toBe(15);
    expect(await qtyAt(productId, badId)).toBe(5);
    await expectInvariant(productId);

    const back = await prisma.$transaction((tx) =>
      transferStockTx(tx, { productId, fromLocationId: badId, toLocationId: rootId, quantity: 2, reason: "kiểm xong" })
    );
    expect(back.totalChanged).toBe(true);
    expect(back.quantityInStock).toBe(17);
    await expectInvariant(productId);
  });

  it("hàng hoàn về ô nhận hoàn (không bán) → tồn bán KHÔNG tăng", async () => {
    const before = await total(productId);
    await prisma.$transaction((tx) =>
      applyStockDelta(tx, {
        productId,
        delta: 4,
        type: InventoryLogType.SYNC,
        reason: "hoàn về kiểm",
        locationId: rootId,
        useReturnDefault: true,
      })
    );
    expect(await total(productId)).toBe(before);
    expect(await qtyAt(productId, badId)).toBe(7);
    await expectInvariant(productId);
  });

  it("đơn không trừ ở ô không bán — bán vượt thì gốc âm chứ không đụng hàng chờ kiểm", async () => {
    // gốc 17, ô không bán 7. Đơn 20 → gốc -3, ô không bán vẫn 7.
    const o = await fx.createOrder(productId, 20);
    await prisma.$transaction((tx) => deductStockTx(tx, o, "test"));
    expect(await qtyAt(productId, rootId)).toBe(-3);
    expect(await qtyAt(productId, badId)).toBe(7);
    expect(await total(productId)).toBe(-3);
    await expectInvariant(productId);
    // dọn: trả gốc về 17 bằng sửa số tại vị trí
    await prisma.$transaction((tx) =>
      setLevelAbsolute(tx, { productId, locationId: rootId, quantity: 17, reason: "dọn test" })
    );
    expect(await total(productId)).toBe(17);
  });

  it("sửa số tại ô không bán không đổi tồn bán, log ADJUST kèm vị trí", async () => {
    const r = await prisma.$transaction((tx) =>
      setLevelAbsolute(tx, { productId, locationId: badId, quantity: 10, reason: "đếm lại ô kiểm" })
    );
    expect(r.previous).toBe(7);
    expect(r.delta).toBe(3);
    expect(r.quantityInStock).toBe(17);
    await expectInvariant(productId);
    const log = await prisma.inventoryLog.findFirst({
      where: { productId, locationId: badId, type: InventoryLogType.ADJUST },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.changeQuantity).toBe(3);
    expect(log?.balanceAfter).toBe(17);
  });
});

describe("Phiếu nhặt in vị trí", () => {
  it("pickLocationText: đã trừ → Vị trí (gộp cùng vị trí, ×số), chưa trừ → Vị trí (còn N) theo ưu tiên", () => {
    expect(pickLocationText([{ locationName: "Kho 2", quantity: 3 }], [])).toBe("Vị trí: Kho 2");
    expect(
      pickLocationText(
        [
          { locationName: "Kho chính", quantity: 1 },
          { locationName: "Kho 2", quantity: 4 },
          { locationName: "Kho 2", quantity: 1 },
        ],
        []
      )
    ).toBe("Vị trí: Kho chính ×1\nVị trí: Kho 2 ×5");
    expect(
      pickLocationText(
        [],
        [
          { locationName: "Kho 2", quantity: 4, sortOrder: 1 },
          { locationName: "Kho chính", quantity: 40, sortOrder: 0 },
          { locationName: "Kệ rỗng", quantity: 0, sortOrder: 2 },
        ]
      )
    ).toBe("Vị trí: Kho chính (còn 40)\nVị trí: Kho 2 (còn 4)");
    expect(pickLocationText([], [])).toBeNull();
  });

  it("tra theo đơn thật: đơn đã trừ ở gốc → Vị trí: Kho chính; đơn chưa trừ → Vị trí (còn N)", async () => {
    const o1 = await fx.createOrder(productId, 2);
    await prisma.$transaction((tx) => deductStockTx(tx, o1, "test"));
    const o2 = await fx.createOrder(productId, 1);
    const map = await pickLocationTextForOrders(fx.userId, [
      { id: o1, productIds: [productId] },
      { id: o2, productIds: [productId] },
    ]);
    expect(map.get(o1)?.get(productId)).toBe("Vị trí: Kho chính");
    expect(map.get(o2)?.get(productId)).toMatch(/^Vị trí: Kho chính \(còn 15\)/);
  });

  it("PDF phiếu nhặt vẫn dựng được khi có dòng vị trí", async () => {
    const bytes = await buildPickListPdf({
      orderCode: "TEST-LOC-1",
      channelLabel: "Shopee",
      shopName: "Shop test",
      trackingCode: null,
      carrierLabel: "GHN",
      isExpress: false,
      createdAt: new Date(),
      items: [
        { sku: "A1", name: "Áo test", quantity: 2, location: "Vị trí: Kho chính ×1\nVị trí: Kho 2 ×1" },
        { sku: "B2", name: "Quần test", quantity: 1, location: null },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
