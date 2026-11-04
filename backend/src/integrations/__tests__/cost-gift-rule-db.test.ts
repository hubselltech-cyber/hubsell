// ============================================================
// LỚP 1 (05/11/2026): dòng giá bán 0 đ đã khác món với lá thì KHÔNG nhận giá vốn của lá ở mọi đường vá đơn cũ; dòng có giá bán
// và dòng quà cùng món vẫn nhận. Dựng theo ca Hellokityhh (docs/TAI-CHINH-GIA-VON-0-ROI-ROAS-KHAO-SAT-02-11.md mục 12).
// ============================================================

import "./load-env";
import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { backfillOrderLinesByChannelProducts, backfillOwnerCostPrices, checkGiftCost, repairZeroCostLinesForChannel } from "../../lib/cost-price";
import { prisma } from "../../lib/prisma";
import { ensureLedgerFresh } from "../../services/order-ledger";
import { createStockFixture, type StockFixture } from "./fixtures";

describe("Dòng quà 0 đ khác món không nhận giá vốn của lá", () => {
  let fx: StockFixture;
  let cpIds: string[];
  let lineIds: Record<string, string>;
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;

  beforeAll(async () => {
    fx = await createStockFixture("giftrule");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
    // Lá hiện tại: KS = tin quà đã đổi thành Kẹo Sâm; QUA = quà thật, tên không đổi; DON = không tên phân loại; BAN = hàng bán đổi tên.
    const rows = [
      ["KS", "1-1", "Kẹo Sâm", "HỘP 32 VIÊN", 490_000],
      ["QUA", "2-1", "Quà", "Túi vải", 13_000],
      ["DON", "3-1", "Hộp giữ form", null, 7_000],
      ["BAN", "4-1", "Áo tên mới", "Đỏ", 50_000],
    ] as const;
    cpIds = [];
    for (const [name, externalId, productName, variantName, costPrice] of rows) {
      const cp = await prisma.channelProduct.create({
        data: { channelId: fx.channelId, channelSku: sku(name), externalId, productName, variantName, costPrice },
      });
      cpIds.push(cp.id);
    }
    const order = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-O`,
        customerName: "Khách test",
        itemCount: 4,
        shippingStatus: ShippingStatus.DELIVERED,
        items: {
          create: [
            { channelSku: sku("KS"), externalId: "1-1", productName: "Gum - THANK YOU 2", quantity: 1, price: 0, costPriceAtSale: 0 },
            { channelSku: sku("QUA"), externalId: "2-1", productName: "Quà - Túi vải", quantity: 1, price: 0, costPriceAtSale: 0 },
            { channelSku: sku("DON"), externalId: "3-1", productName: "Hộp giữ form - Mặc định", quantity: 1, price: 0, costPriceAtSale: 0 },
            { channelSku: sku("BAN"), externalId: "4-1", productName: "Áo tên cũ - Xanh", quantity: 1, price: 100_000, costPriceAtSale: 0 },
          ],
        },
      },
      include: { items: true },
    });
    lineIds = Object.fromEntries(order.items.map((i) => [i.channelSku.split("-").pop()!, i.id]));
  });
  afterAll(async () => {
    await fx?.cleanup();
  });
  beforeEach(async () => {
    await prisma.orderItem.updateMany({ where: { id: { in: Object.values(lineIds) } }, data: { costPriceAtSale: 0 } });
  });

  const costs = async () => {
    const items = await prisma.orderItem.findMany({ where: { id: { in: Object.values(lineIds) } } });
    return Object.fromEntries(items.map((i) => [i.channelSku.split("-").pop()!, Number(i.costPriceAtSale)]));
  };
  const expected = { KS: 0, QUA: 13_000, DON: 7_000, BAN: 50_000 };

  it("vá theo giá vừa nhập", async () => {
    await backfillOrderLinesByChannelProducts(prisma, cpIds);
    expect(await costs()).toEqual(expected);
  });

  it("nút Áp giá vốn cho đơn cũ; dòng quà còn 0 không bị đếm là chưa có giá vốn", async () => {
    const r = await backfillOwnerCostPrices(fx.userId);
    expect(await costs()).toEqual(expected);
    expect(r.remainingZeroLines).toBe(0);
  });

  it("lượt vá định kỳ theo gian", async () => {
    await repairZeroCostLinesForChannel(prisma, fx.channelId);
    expect(await costs()).toEqual(expected);
  });
});

describe("checkGiftCost — hỏi lại khi nhập giá cao cho mã đang là quà", () => {
  let fx: StockFixture;
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;
  let thẻ: string;
  let hàng: string;

  beforeAll(async () => {
    fx = await createStockFixture("giftcheck");
    await prisma.channel.update({ where: { id: fx.channelId }, data: { channelName: ChannelName.TIKTOK } });
    thẻ = (await prisma.channelProduct.create({ data: { channelId: fx.channelId, channelSku: sku("THE"), externalId: "5-1", productName: "Thẻ", variantName: "Thẻ 1" } })).id;
    hàng = (await prisma.channelProduct.create({ data: { channelId: fx.channelId, channelSku: sku("BAN"), externalId: "6-1", productName: "Áo", variantName: "Đỏ", costPrice: 30_000 } })).id;
    const line = (name: string, externalId: string, price: number, cost: number) => ({
      channelSku: sku(name),
      externalId,
      productName: `${name} - ${name}`,
      quantity: 1,
      price,
      costPriceAtSale: cost,
    });
    await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-A`,
        customerName: "Khách test",
        itemCount: 2,
        shippingStatus: ShippingStatus.DELIVERED,
        items: { create: [line("BAN", "6-1", 100_000, 30_000), line("THE", "5-1", 0, 1)] },
      },
    });
    await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-B`,
        customerName: "Khách test",
        itemCount: 2,
        shippingStatus: ShippingStatus.DELIVERED,
        items: { create: [line("BAN", "6-1", 300_000, 30_000), line("BAN2", "6-1", 0, 30_000), line("THE", "5-1", 0, 1)] },
      },
    });
    expect((await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 100 })).dirty).toBe(0);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("mã toàn dòng quà: đếm đơn mà giá vốn quà vượt doanh thu đơn", async () => {
    expect(await checkGiftCost(fx.userId, [thẻ], 200_000)).toEqual({ giftOrders: 2, exceedOrders: 1 });
    expect(await checkGiftCost(fx.userId, [thẻ], 686_868)).toEqual({ giftOrders: 2, exceedOrders: 2 });
    expect(await checkGiftCost(fx.userId, [thẻ], 13_000)).toEqual({ giftOrders: 2, exceedOrders: 0 });
  });

  it("mã vừa bán vừa tặng là hàng thật → không hỏi; mã không có đơn / id lạ → không hỏi", async () => {
    expect(await checkGiftCost(fx.userId, [hàng], 900_000)).toEqual({ giftOrders: 0, exceedOrders: 0 });
    expect(await checkGiftCost(fx.userId, ["khong-co"], 900_000)).toEqual({ giftOrders: 0, exceedOrders: 0 });
  });
});
