// Ghi giá cả file Excel trong một lượt (03/11/2026). Chạy trên DB dev.
// Đo tải, ghi kết quả ra tệp: COST_IMPORT_LOAD=do.txt npx vitest run src/lib/__tests__/cost-import-apply-db.test.ts
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { applyCostPriceIn } from "../cost-price";
import { backfillCostImport, writeCostImportPlan, type CostImportPlan } from "../cost-import-apply";

const stamp = Date.now();
const LOAD = process.env.COST_IMPORT_LOAD ?? "";
let userId = "";
let otherId = "";
let ch = "";
let chOther = "";

const costOfLine = async (orderCode: string) => {
  const o = await prisma.order.findFirstOrThrow({
    where: { orderCode: `T-${stamp}-${orderCode}` },
    select: { items: { select: { costPriceAtSale: true } } },
  });
  return Number(o.items[0].costPriceAtSale);
};
const order = (channelId: string, code: string, channelSku: string, productId: string | null, costPriceAtSale = 0) =>
  prisma.order.create({
    data: {
      channelId,
      orderCode: `T-${stamp}-${code}`,
      customerName: "Khách test",
      itemCount: 1,
      items: { create: { channelSku, productId, productName: code, quantity: 1, price: 100000, costPriceAtSale } },
    },
    select: { id: true },
  });

async function applyAll(tx: Prisma.TransactionClient, plan: CostImportPlan, ownerId: string) {
  const written = await writeCostImportPlan(tx, plan, ownerId);
  const backfilled = await backfillCostImport(tx, written, ownerId);
  return { updated: written.productIds.length + written.channelProductIds.length, backfilled };
}

describe("ghi giá cả file", () => {
  beforeAll(async () => {
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: { email: `test-cost-apply-${tag}-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      });
    userId = (await mkUser("a")).id;
    otherId = (await mkUser("b")).id;
    const mkCh = (owner: string, ext: string) =>
      prisma.channel.create({
        data: { userId: owner, channelName: ChannelName.SHOPEE, shopName: `TEST-${ext}`, externalShopId: ext, status: "ACTIVE" },
        select: { id: true },
      });
    ch = (await mkCh(userId, `31${stamp}`)).id;
    chOther = (await mkCh(otherId, `32${stamp}`)).id;
  });

  afterAll(async () => {
    const channels = [ch, chOther];
    await prisma.orderItem.deleteMany({ where: { order: { channelId: { in: channels } } } });
    await prisma.order.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.product.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.channel.deleteMany({ where: { id: { in: channels } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  }, 300_000);

  it.skipIf(Boolean(LOAD))("ghi đúng từng giá, vá đúng dòng đơn đang 0, không đụng dòng đã có giá và chủ shop khác", async () => {
    const p1 = (
      await prisma.product.create({
        data: { userId, skuCode: `KHO-${stamp}`, productName: "Kho", sellingPrice: 1 },
        select: { id: true },
      })
    ).id;
    const pOther = (
      await prisma.product.create({
        data: { userId: otherId, skuCode: `KHAC-${stamp}`, productName: "Khac", costPrice: 7, sellingPrice: 1 },
        select: { id: true },
      })
    ).id;
    const mkCp = (channelId: string, sku: string, productId?: string, costPrice?: number) =>
      prisma.channelProduct.create({
        data: { channelId, channelSku: sku, productName: sku, productId, costPrice, costPriceInheritedAt: new Date() },
        select: { id: true },
      });
    const shopA = (await mkCp(ch, "SHOP-A")).id;
    const shopB = (await mkCp(ch, "SHOP-B")).id;
    const shopOther = (await mkCp(chOther, "SHOP-KHAC", undefined, 5)).id;
    await mkCp(ch, "THEO-KHO", p1);

    await order(ch, "kho", "THEO-KHO", p1);
    await order(ch, "a", "SHOP-A", null);
    await order(ch, "b", "SHOP-B", null);
    await order(ch, "co-gia", "SHOP-A", null, 111);
    await order(chOther, "khac", "SHOP-KHAC", null);

    const r = await prisma.$transaction((tx) =>
      applyAll(
        tx,
        {
          productCost: new Map([[p1, 70000], [pOther, 1]]),
          shopCost: new Map([[shopA, 50000], [shopB, 60000], [shopOther, 2]]),
        },
        userId
      )
    );
    expect(r.updated).toBe(3); // 1 kho + 2 gian; 2 dòng của chủ shop khác bị bỏ
    expect(r.backfilled).toBe(3);

    const cost = async (id: string) => prisma.channelProduct.findUniqueOrThrow({ where: { id }, select: { costPrice: true, costPriceInheritedAt: true } });
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: p1 } })).costPrice)).toBe(70000);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: pOther } })).costPrice)).toBe(7);
    expect(Number((await cost(shopA)).costPrice)).toBe(50000);
    expect((await cost(shopA)).costPriceInheritedAt).toBeNull();
    expect(Number((await cost(shopB)).costPrice)).toBe(60000);
    expect(Number((await cost(shopOther)).costPrice)).toBe(5);

    expect(await costOfLine("kho")).toBe(70000);
    expect(await costOfLine("a")).toBe(50000);
    expect(await costOfLine("b")).toBe(60000);
    expect(await costOfLine("co-gia")).toBe(111);
    expect(await costOfLine("khac")).toBe(0);
  });

  it.skipIf(Boolean(LOAD))("giữ đúng luật khớp: id trước, mã SKU, số sau gạch nối, SPE-, id khác thì không khớp", async () => {
    const mk = (sku: string, externalId: string | null, costPrice?: number, productId?: string) =>
      prisma.channelProduct.create({
        data: { channelId: ch, channelSku: `${sku}-${stamp}`, externalId, productName: sku, costPrice, productId },
        select: { id: true },
      });
    const line = (code: string, channelSku: string, externalId: string | null, productId: string | null = null) =>
      prisma.order.create({
        data: {
          channelId: ch,
          orderCode: `T-${stamp}-${code}`,
          customerName: "Khách test",
          itemCount: 1,
          items: { create: { channelSku, externalId, productId, productName: code, quantity: 1, price: 1 } },
        },
        select: { id: true },
      });
    const a = (await mk("LUAT", `71${stamp}-72${stamp}`, 900)).id;
    await line("id", "ma-khac", `71${stamp}-72${stamp}`);
    await line("id-khac", `LUAT-${stamp}`, `71${stamp}-99`); // có id riêng khác thì không khớp theo mã
    await line("ma", `LUAT-${stamp}`, null);
    await line("sau-gach", `72${stamp}`, null);
    await line("spe", `SPE-71${stamp}-72${stamp}`, null);
    await line("la", `la-${stamp}`, null);
    expect(await backfillCostImport(prisma, { productIds: [], channelProductIds: [a] }, userId)).toBe(4);
    for (const c of ["id", "ma", "sau-gach", "spe"]) expect(await costOfLine(c)).toBe(900);
    for (const c of ["id-khac", "la"]) expect(await costOfLine(c)).toBe(0);

    // Giá kho: dòng khớp SKU đã nối được vá; dòng của gian có giá riêng giữ cho lượt gian.
    const p = (
      await prisma.product.create({
        data: { userId, skuCode: `LUAT-KHO-${stamp}`, productName: "Kho", costPrice: 300, sellingPrice: 1 },
        select: { id: true },
      })
    ).id;
    await mk("NOI", `73${stamp}-74${stamp}`, undefined, p);
    await mk("NOI-RIENG", `75${stamp}-76${stamp}`, 800, p);
    await line("kho-id", "x", `73${stamp}-74${stamp}`);
    await line("kho-ma", `NOI-${stamp}`, null);
    await line("kho-mang-id", "y", null, p);
    await line("kho-gia-rieng", "z", `75${stamp}-76${stamp}`, p);
    expect(await backfillCostImport(prisma, { productIds: [p], channelProductIds: [] }, userId)).toBe(3);
    for (const c of ["kho-id", "kho-ma", "kho-mang-id"]) expect(await costOfLine(c)).toBe(300);
    expect(await costOfLine("kho-gia-rieng")).toBe(0);
  });

  // Đúng cỡ gian của khách 03/11: 38.889 dòng sàn, 16.836 dòng có giá, 2.756 dòng đơn chưa có giá.
  it.runIf(Boolean(LOAD))(
    "đo: file 1.228 dòng, 40 mức giá, gian 38.889 dòng",
    async () => {
      const ROWS = 1228;
      const CP = 38889;
      const PRICED = 16836;
      const LINES = 2756;
      await prisma.product.createMany({
        data: Array.from({ length: ROWS }, (_, i) => ({
          userId,
          skuCode: `P${stamp}-${i}`,
          productName: `SP ${i}`,
          sellingPrice: 1,
        })),
      });
      const products = await prisma.product.findMany({ where: { userId }, select: { id: true }, orderBy: { skuCode: "asc" } });
      for (let i = 0; i < CP; i += 5000) {
        await prisma.channelProduct.createMany({
          data: Array.from({ length: Math.min(5000, CP - i) }, (_, k) => {
            const n = i + k;
            return {
              channelId: ch,
              channelSku: `S${stamp}-${n}`,
              externalId: `${900000 + Math.floor(n / 4)}-${n}`,
              productName: `Sàn ${n}`,
              productId: n < ROWS ? products[n].id : null,
              costPrice: n >= CP - PRICED ? 5000 : null,
            };
          }),
        });
      }
      for (let i = 0; i < LINES; i += 500) {
        await prisma.$transaction(
          Array.from({ length: Math.min(500, LINES - i) }, (_, k) => {
            const n = (i + k) % ROWS;
            return prisma.order.create({
              data: {
                channelId: ch,
                orderCode: `T-${stamp}-L${i + k}`,
                customerName: "Khách test",
                itemCount: 1,
                items: {
                  create: {
                    channelSku: `S${stamp}-${n}`,
                    externalId: `${900000 + Math.floor(n / 4)}-${n}`,
                    productName: `L${i + k}`,
                    quantity: 1,
                    price: 100000,
                  },
                },
              },
              select: { id: true },
            });
          })
        );
      }
      const productCost = new Map(products.map((p, i) => [p.id, 1000 + (i % 40)]));
      const shopCost = new Map<string, number>();

      const rollback = async (name: string, fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const t = Date.now();
        await prisma
          .$transaction(
            async (tx) => {
              await fn(tx);
              throw new Error("rollback-do");
            },
            { timeout: 280_000, maxWait: 10_000 }
          )
          .catch((e: Error) => {
            if (e.message !== "rollback-do") throw e;
          });
        appendFileSync(LOAD, `${name}: ${Date.now() - t} ms
`);
      };
      await rollback("cả file một lượt", (tx) => applyAll(tx, { productCost, shopCost }, userId));
      await rollback("một ô giá", (tx) => applyCostPriceIn(tx, [products[0].id], 1234, userId));
    },
    590_000
  );
});
