// ============================================================
// GIÁ VỐN THEO GIAN (11/10/2026) trên DB dev: một sản phẩm kho nối vào hai
// gian, gian A đặt giá riêng 120k, gian B theo giá kho 100k. Kiểm các đường vá
// đơn cũ của lib/cost-price.ts tôn trọng "giá gian thắng giá kho", và gỡ liên
// kết thì gian đang theo giá kho giữ được giá.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import {
  applyChannelCostPrice,
  applyCostPrice,
  backfillOwnerCostPrices,
  effectiveSkuCost,
  keepCostOnDetach,
} from "../../lib/cost-price";

describe("Giá vốn theo gian", () => {
  let fx: StockFixture;
  let productId: string;
  let chB: string;
  let cpA: string;
  let cpB: string;
  let lineA: string;
  let lineB: string;
  const sku = () => `TEST-${fx.suffix}-X`;

  const lineCost = async (id: string) =>
    Number((await prisma.orderItem.findUniqueOrThrow({ where: { id } })).costPriceAtSale);
  const resetLines = () =>
    prisma.orderItem.updateMany({ where: { id: { in: [lineA, lineB] } }, data: { costPriceAtSale: 0 } });

  beforeAll(async () => {
    fx = await createStockFixture("costshop");
    productId = await fx.createProduct(0);
    chB = (
      await prisma.channel.create({
        data: { userId: fx.userId, channelName: ChannelName.SHOPEE, shopName: `TEST-${fx.suffix}-B` },
      })
    ).id;
    cpA = (
      await prisma.channelProduct.create({
        data: { channelId: fx.channelId, channelSku: sku(), productName: "X", productId },
      })
    ).id;
    cpB = (
      await prisma.channelProduct.create({
        data: { channelId: chB, channelSku: sku(), productName: "X", productId },
      })
    ).id;
    const order = async (channelId: string, code: string) =>
      (
        await prisma.order.create({
          data: {
            channelId,
            orderCode: `TEST-${fx.suffix}-${code}`,
            customerName: "Khách test",
            itemCount: 1,
            items: {
              create: { productId, channelSku: sku(), productName: "X", quantity: 1, price: 200_000 },
            },
          },
          include: { items: true },
        })
      ).items[0].id;
    lineA = await order(fx.channelId, "A");
    lineB = await order(chB, "B");
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("đặt giá kho không đè dòng đơn của gian có giá riêng; giá gian vá đúng gian", async () => {
    await prisma.channelProduct.update({ where: { id: cpA }, data: { costPrice: 120_000 } });
    await applyCostPrice([productId], 100_000, fx.userId);
    expect(await lineCost(lineA)).toBe(0); // gian A có giá riêng → kho không vá
    expect(await lineCost(lineB)).toBe(100_000);

    await applyChannelCostPrice([cpA], 120_000, fx.userId);
    expect(await lineCost(lineA)).toBe(120_000);
    expect(await lineCost(lineB)).toBe(100_000);

    const cps = await prisma.channelProduct.findMany({
      where: { id: { in: [cpA, cpB] } },
      include: { product: { select: { costPrice: true } } },
      orderBy: { channelId: "asc" },
    });
    const byId = new Map(cps.map((c) => [c.id, effectiveSkuCost(c)]));
    expect(byId.get(cpA)).toBe(120_000);
    expect(byId.get(cpB)).toBe(100_000);
  });

  it("nút Áp giá vốn cho đơn cũ: mỗi gian nhận đúng giá của nó", async () => {
    await resetLines();
    const r = await backfillOwnerCostPrices(fx.userId);
    expect(r.backfilledOrderLines).toBe(2);
    expect(await lineCost(lineA)).toBe(120_000);
    expect(await lineCost(lineB)).toBe(100_000);
  });

  it("gỡ liên kết: gian đang theo giá kho giữ được giá, gian có giá riêng giữ nguyên", async () => {
    await keepCostOnDetach(prisma, { channelProductIds: [cpA, cpB] }, fx.userId);
    const after = await prisma.channelProduct.findMany({ where: { id: { in: [cpA, cpB] } } });
    const own = new Map(after.map((c) => [c.id, Number(c.costPrice)]));
    expect(own.get(cpA)).toBe(120_000);
    expect(own.get(cpB)).toBe(100_000);
  });
});
