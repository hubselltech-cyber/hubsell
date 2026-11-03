// Cảnh báo cháy hàng / sắp hết hàng gom trong DB, không tải cả danh mục vào RAM web (03/11/2026). Chạy trên DB dev.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { detectLowStock, detectStockouts } from "../ops-alerts";

const stamp = Date.now();
let userId = "";
let otherId = "";
let chA = "";
let chB = "";
let chGone = "";
let chOther = "";
const DAY = 86_400_000;

async function product(owner: string, sku: string, qty: number, over: { hold?: number; isActive?: boolean; low?: number } = {}) {
  const p = await prisma.product.create({
    data: {
      userId: owner,
      skuCode: `${sku}-${stamp}`,
      productName: sku,
      quantityInStock: qty,
      holdQuantity: over.hold ?? 0,
      isActive: over.isActive ?? true,
      lowStockThreshold: over.low,
      sellingPrice: 100000,
    },
    select: { id: true },
  });
  return p.id;
}
const link = (channelId: string, sku: string, productId: string) =>
  prisma.channelProduct.create({
    data: { channelId, channelSku: `${sku}-${channelId}`, productName: sku, productId },
    select: { id: true },
  });
async function sale(channelId: string, productId: string, ageDays: number, code: string) {
  await prisma.order.create({
    data: {
      channelId,
      orderCode: `TEST-${stamp}-${code}`,
      customerName: "Khách test",
      itemCount: 1,
      createdAt: new Date(Date.now() - ageDays * DAY),
      items: { create: { channelSku: code, productId, productName: code, quantity: 1, price: 100000 } },
    },
    select: { id: true },
  });
}

describe("detectStockouts / detectLowStock", () => {
  beforeAll(async () => {
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: { email: `test-ops-stock-${tag}-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      });
    userId = (await mkUser("a")).id;
    otherId = (await mkUser("b")).id;
    const mkCh = (owner: string, name: ChannelName, shopName: string, ext: string, status: "ACTIVE" | "DISCONNECTED" = "ACTIVE") =>
      prisma.channel.create({
        data: { userId: owner, channelName: name, shopName, externalShopId: ext, status },
        select: { id: true },
      });
    chA = (await mkCh(userId, ChannelName.SHOPEE, "GIAN-A", `51${stamp}`)).id;
    chB = (await mkCh(userId, ChannelName.TIKTOK, "GIAN-B", `52${stamp}`)).id;
    chGone = (await mkCh(userId, ChannelName.LAZADA, "GIAN-NGAT", `53${stamp}`, "DISCONNECTED")).id;
    chOther = (await mkCh(otherId, ChannelName.SHOPEE, "GIAN-KHAC", `54${stamp}`)).id;

    // A: 4 SKU cháy hàng có đơn gần đây → một thẻ, in 3 mã + "+1".
    for (const s of ["A1", "A2", "A3", "A4"]) {
      const id = await product(userId, s, 0);
      await link(chA, s, id);
      await sale(chA, id, 1, s);
    }
    // Hai dòng sàn cùng một sản phẩm kho: đếm một mã.
    const twin = await product(userId, "B1", 2, { hold: 2 });
    await link(chB, "B1", twin);
    await link(chB, "B1-2", twin);
    await sale(chB, twin, 1, "B1");

    // Không được báo:
    const noSale = await product(userId, "C-KHONG-DON", 0);
    await link(chA, "C-KHONG-DON", noSale);
    const oldSale = await product(userId, "C-DON-CU", 0);
    await link(chA, "C-DON-CU", oldSale);
    await sale(chA, oldSale, 45, "C-CU");
    const inactive = await product(userId, "C-NGUNG", 0, { isActive: false });
    await link(chA, "C-NGUNG", inactive);
    await sale(chA, inactive, 1, "C-NG");
    const inStock = await product(userId, "C-CON", 5, { low: 2 });
    await link(chA, "C-CON", inStock);
    await sale(chA, inStock, 1, "C-CON");
    const onGone = await product(userId, "C-GIAN-NGAT", 0);
    await link(chGone, "C-GIAN-NGAT", onGone);
    await sale(chGone, onGone, 1, "C-NGAT");
    // Đơn của chủ shop khác không làm SKU của chủ shop này thành "đang bán".
    const sharedLook = await product(userId, "C-DON-NGUOI-KHAC", 0);
    await link(chA, "C-DON-NGUOI-KHAC", sharedLook);
    await sale(chOther, sharedLook, 1, "C-KHAC");

    // Sắp hết: ngưỡng riêng.
    await product(userId, "L-DUOI-NGUONG", 3, { low: 5 });
    await product(userId, "L-TREN-NGUONG", 9, { low: 5 });
    await product(userId, "L-NGUNG", 1, { low: 5, isActive: false });
  }, 120_000);

  afterAll(async () => {
    const channels = [chA, chB, chGone, chOther];
    await prisma.orderItem.deleteMany({ where: { order: { channelId: { in: channels } } } });
    await prisma.order.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.channel.deleteMany({ where: { id: { in: channels } } });
    await prisma.shopSyncSetting.deleteMany({ where: { userId } });
    await prisma.product.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  }, 120_000);

  it("cháy hàng: mỗi gian một thẻ, chỉ SKU đang bán thật, đúng chữ và số", async () => {
    const alerts = await detectStockouts(userId);
    expect(alerts.map((a) => a.dedupeKey).sort()).toEqual([chA, chB].sort());
    const a = alerts.find((x) => x.dedupeKey === chA)!;
    expect(a.type).toBe("stockout");
    expect(a.title).toContain("4 SKU hết hàng");
    expect(a.title).toContain('"GIAN-A"');
    expect(a.summary).toContain("+1 SKU khác");
    const b = alerts.find((x) => x.dedupeKey === chB)!;
    expect(b.title).toContain(`B1-${stamp} hết hàng`); // một SKU: in mã, không in "N SKU"
    for (const x of alerts) expect(`${x.title} ${x.summary}`).not.toMatch(/C-(KHONG-DON|DON-CU|NGUNG|CON|GIAN-NGAT|DON-NGUOI-KHAC)/);
  });

  it("chủ shop khác không thấy gì", async () => {
    expect(await detectStockouts(otherId)).toEqual([]);
    expect(await detectLowStock(otherId)).toEqual([]);
  });

  it("sắp hết: theo ngưỡng riêng, ngừng bán không báo, không đặt ngưỡng thì không quét", async () => {
    const keys = (await detectLowStock(userId)).map((a) => a.title);
    expect(keys.some((t) => t.includes("L-DUOI-NGUONG"))).toBe(true);
    expect(keys.some((t) => t.includes("L-TREN-NGUONG"))).toBe(false);
    expect(keys.some((t) => t.includes("L-NGUNG"))).toBe(false);
    expect(keys.some((t) => t.includes("A1"))).toBe(false); // A1 không có ngưỡng, shop chưa đặt mặc định
  });

  it("sắp hết: shop đặt mặc định thì áp cho SKU không có ngưỡng riêng", async () => {
    await prisma.shopSyncSetting.upsert({
      where: { userId },
      create: { userId, lowStockDefault: 1 },
      update: { lowStockDefault: 1 },
    });
    const titles = (await detectLowStock(userId)).map((a) => a.title);
    expect(titles.some((t) => t.includes("A1"))).toBe(true);
    expect(titles.some((t) => t.includes("C-CON"))).toBe(false); // còn 5 > ngưỡng riêng 2
  });
});
