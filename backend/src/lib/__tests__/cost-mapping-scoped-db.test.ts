// Đường theo MÃ CỤ THỂ không tải cả danh mục + chắn đường cần cả danh mục (03/11/2026). Chạy trên DB dev.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import {
  CatalogTooLargeError,
  fillSuggested,
  findCostSiblings,
  listSkuGroups,
  setCostForCodes,
} from "../cost-mapping";

const stamp = Date.now();
let userId = "";
let chA = "";
let chB = "";
let savedId = "";
let emptyId = "";
let otherId = "";

describe("cost-mapping: theo mã cụ thể", () => {
  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `test-cost-scope-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST cost scope", role: "ADMIN" },
      select: { id: true },
    });
    userId = u.id;
    const mk = (shopName: string, ext: string) =>
      prisma.channel.create({
        data: { userId, channelName: ChannelName.SHOPEE, shopName, externalShopId: ext, status: "ACTIVE" },
        select: { id: true },
      });
    chA = (await mk("TEST-A", `71${stamp}`)).id;
    chB = (await mk("TEST-B", `72${stamp}`)).id;
    const cp = (channelId: string, channelSku: string, costPrice: number | null) =>
      prisma.channelProduct.create({
        data: { channelId, channelSku, productName: "SP", costPrice },
        select: { id: true },
      });
    savedId = (await cp(chA, "AO_1", 50000)).id;
    emptyId = (await cp(chB, "ao_1", null)).id; // cùng mã, khác hoa thường, gian khác còn trống
    otherId = (await cp(chB, "AOX1", null)).id; // "_" của ILIKE khớp nhầm X — phải bị loại
  });

  afterAll(async () => {
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: [chA, chB] } } });
    await prisma.channel.deleteMany({ where: { id: { in: [chA, chB] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    delete process.env.SKU_PRODUCTS_MAX_ROWS;
  });

  it("findCostSiblings: thấy đúng gian cùng mã, không dính mã khớp nhầm do ký tự đại diện", async () => {
    const r = await findCostSiblings(userId, [savedId]);
    expect(r.fillCodes).toEqual(["AO_1"]);
    expect(r.fillable).toBe(1);
    expect(r.fillShops).toBe(1);
  });

  it("vượt trần: đường theo mã vẫn chạy, đường cả danh mục báo CatalogTooLargeError", async () => {
    process.env.SKU_PRODUCTS_MAX_ROWS = "2";
    await expect(listSkuGroups(userId)).rejects.toBeInstanceOf(CatalogTooLargeError);
    await expect(fillSuggested(userId)).rejects.toBeInstanceOf(CatalogTooLargeError);
    expect((await findCostSiblings(userId, [savedId])).fillable).toBe(1);

    const filled = await fillSuggested(userId, ["AO_1"]);
    expect(filled.filledSkus).toBe(1);
    const rows = await prisma.channelProduct.findMany({
      where: { id: { in: [emptyId, otherId] } },
      select: { id: true, costPrice: true },
    });
    expect(Number(rows.find((x) => x.id === emptyId)?.costPrice)).toBe(50000);
    expect(rows.find((x) => x.id === otherId)?.costPrice).toBeNull();

    const set = await setCostForCodes(userId, ["ao_1"], 60000);
    expect(set.updatedSkus).toBe(2);
    delete process.env.SKU_PRODUCTS_MAX_ROWS;
  });
});
