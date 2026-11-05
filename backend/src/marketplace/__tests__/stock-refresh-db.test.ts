// ============================================================
// LÀM MỚI TỒN SÀN CHO SKU ĐÃ NỐI — chỉ ghi dòng có số KHÁC (05/11/2026, lát 3.9 GĐ3).
// Chạy trên DB dev, sàn giả. Trước đây mỗi lượt đối soát UPDATE mọi dòng đã nối dù sàn trả đúng số cũ.
// ============================================================
import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName } from "@prisma/client";
import type { FetchedProducts } from "../types";

const m = vi.hoisted(() => ({ fetchProducts: vi.fn(), getItemBaseInfo: vi.fn(), getModelList: vi.fn() }));
vi.mock("../registry", () => ({ getProductAdapter: () => ({ name: "san-gia", fetchProducts: m.fetchProducts }) }));
vi.mock("../../integrations/shopee/client", async (orig) => ({
  ...(await orig<typeof import("../../integrations/shopee/client")>()),
  getItemBaseInfo: m.getItemBaseInfo,
  getModelList: m.getModelList,
}));
vi.mock("../../integrations/shopee/service", () => ({
  getValidShopeeAccessToken: async () => ({ accessToken: "tok", shopId: "1" }),
}));

import { prisma } from "../../lib/prisma";
import { refreshLinkedChannelStock } from "../stock-refresh";

const stamp = Date.now();
let userId = "";
let productId = "";

async function xmins(channelId: string): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ ext: string; x: string }[]>`
    SELECT "externalId" AS ext, xmin::text AS x FROM "ChannelProduct" WHERE "channelId" = ${channelId}`;
  return new Map(rows.map((r) => [r.ext, r.x]));
}
const changed = (a: Map<string, string>, b: Map<string, string>) => [...b].filter(([k, x]) => a.get(k) !== x).map(([k]) => k).sort();

async function makeChannel(channelName: ChannelName, rows: { externalId: string; channelStock: number; loc?: string }[]) {
  const ch = await prisma.channel.create({
    data: { userId, channelName, shopName: `TEST-REFRESH-${channelName}`, externalShopId: `6${stamp}${channelName}`, status: "ACTIVE" },
  });
  await prisma.channelProduct.createMany({
    data: rows.map((r) => ({
      channelId: ch.id,
      channelSku: `SKU-${r.externalId}`,
      productName: "SP",
      externalId: r.externalId,
      productId,
      channelStock: r.channelStock,
      channelStockLocationId: r.loc ?? null,
    })),
  });
  return ch;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `test-stock-refresh-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST stock refresh", role: "ADMIN" },
  });
  userId = user.id;
  const prod = await prisma.product.create({ data: { userId, skuCode: `REFRESH-${stamp}`, productName: "Kho", costPrice: 1, sellingPrice: 2 } });
  productId = prod.id;
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
});

describe("refreshLinkedChannelStock — chỉ ghi dòng có số khác", () => {
  it("Lazada/TikTok (qua adapter): sàn trả đúng số cũ → 0 lệnh ghi; một dòng đổi → đúng 1 lệnh ghi", async () => {
    const ch = await makeChannel(ChannelName.LAZADA, [
      { externalId: "10-1", channelStock: 5 },
      { externalId: "10-2", channelStock: 7 },
      { externalId: "10-3", channelStock: 9 },
    ]);
    const answer = (stock2: number): FetchedProducts => ({
      complete: true,
      products: [
        ["10-1", 5],
        ["10-2", stock2],
      ].map(([ext, stock]) => ({
        channelSku: `SKU-${ext}`,
        productName: "SP",
        variantName: null,
        price: 1,
        imageUrl: null,
        externalId: String(ext),
        itemSku: null,
        channelStock: Number(stock),
        channelStockLocationId: null,
        status: "ACTIVE" as const,
      })),
    });
    m.fetchProducts.mockResolvedValue(answer(7));
    const before = await xmins(ch.id);
    expect(await refreshLinkedChannelStock(ch)).toEqual({ refreshed: 2, missing: 1 });
    expect(changed(before, await xmins(ch.id))).toEqual([]);

    m.fetchProducts.mockResolvedValue(answer(6));
    expect(await refreshLinkedChannelStock(ch)).toEqual({ refreshed: 2, missing: 1 });
    expect(changed(before, await xmins(ch.id))).toEqual(["10-2"]);
    const row = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: ch.id, externalId: "10-2" } });
    expect(row.channelStock).toBe(6);
  });

  it("Shopee: cấp sản phẩm + cấp phân loại; số và địa điểm kho giống cũ → không ghi; đổi địa điểm kho cũng tính là khác", async () => {
    const ch = await makeChannel(ChannelName.SHOPEE, [
      { externalId: "20", channelStock: 4, loc: "VNZ" },
      { externalId: "21-1", channelStock: 2, loc: "VNZ" },
      { externalId: "21-2", channelStock: 3, loc: "VNZ" },
    ]);
    const stock = (n: number, loc = "VNZ") => ({ seller_stock: [{ location_id: loc, stock: n }] });
    m.getItemBaseInfo.mockResolvedValue([
      { item_id: 20, stock_info_v2: stock(4) },
      { item_id: 21, has_model: true },
    ]);
    m.getModelList.mockResolvedValue([
      { model_id: 1, stock_info_v2: stock(2) },
      { model_id: 2, stock_info_v2: stock(3) },
    ]);
    const before = await xmins(ch.id);
    expect(await refreshLinkedChannelStock(ch)).toEqual({ refreshed: 3, missing: 0 });
    expect(changed(before, await xmins(ch.id))).toEqual([]);

    m.getModelList.mockResolvedValue([
      { model_id: 1, stock_info_v2: stock(0) },
      { model_id: 2, stock_info_v2: stock(3, "VNH") },
    ]);
    expect(await refreshLinkedChannelStock(ch)).toEqual({ refreshed: 3, missing: 0 });
    expect(changed(before, await xmins(ch.id))).toEqual(["21-1", "21-2"]);
    const rows = await prisma.channelProduct.findMany({ where: { channelId: ch.id }, orderBy: { externalId: "asc" } });
    expect(rows.map((r) => [r.externalId, r.channelStock, r.channelStockLocationId])).toEqual([
      ["20", 4, "VNZ"],
      ["21-1", 0, "VNZ"],
      ["21-2", 3, "VNH"],
    ]);
  });
});
