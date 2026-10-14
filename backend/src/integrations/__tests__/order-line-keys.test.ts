// ============================================================
// KHỚP DÒNG ĐƠN / DÒNG HOÀN THEO ID PHÂN LOẠI LÁ (15/10/2026, sự cố Hi.Bé)
//
// DB local thật. Gian có 2 size cùng mã "LT075-HONG" (hai dòng có đuôi) + một
// dòng cũ chưa có externalId. Kiểm:
//   · resolveOrderLineRows: id sàn thắng mã thô; mã thô là đường lui; không khớp → undefined.
//   · aggregateShopeeItems / aggregateLineItems: hai size cùng mã KHÔNG gộp thành một dòng.
//   · expandReturnKeys: id đầy đủ (Shopee) và id lá (TikTok) đều ra khóa dòng sàn.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  expandReturnKeys,
  lineKey,
  resolveOrderLineRows,
  shopeeLineExternalId,
  tiktokLineExternalId,
} from "../order-line-keys";
import { aggregateShopeeItems } from "../shopee/service";
import { aggregateLineItems } from "../tiktok/service";
import type { ShopeeOrderDetail } from "../shopee/client";
import type { TikTokOrder } from "../tiktok/client";

const stamp = Date.now();
let userId = "";
let channelId = "";

describe("order-line-keys", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-line-keys-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST line keys", role: "ADMIN" },
    });
    userId = user.id;
    const ch = await prisma.channel.create({
      data: { userId, channelName: ChannelName.SHOPEE, shopName: "TEST-LINEKEYS", externalShopId: `7${stamp}`, status: "ACTIVE" },
    });
    channelId = ch.id;
    await prisma.channelProduct.createMany({
      data: [
        { channelId, channelSku: "LT075-HONG (Hồng, 3-5kg)", productName: "Body", externalId: "111-1", costPrice: 60000 },
        { channelId, channelSku: "LT075-HONG (Hồng, 5-7kg)", productName: "Body", externalId: "111-2", costPrice: 65000 },
        { channelId, channelSku: "CU-KHONG-ID", productName: "Cũ", externalId: null },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it("externalId dòng đơn: Shopee item-model (model 0 = sản phẩm đơn), TikTok product-sku", () => {
    expect(shopeeLineExternalId(111, 2)).toBe("111-2");
    expect(shopeeLineExternalId(111, 0)).toBe("111");
    expect(shopeeLineExternalId(undefined, 2)).toBeNull();
    expect(tiktokLineExternalId("P", "S")).toBe("P-S");
    expect(tiktokLineExternalId("P", undefined)).toBeNull();
  });

  it("resolveOrderLineRows: id sàn thắng mã thô; mã thô là đường lui; không khớp → undefined", async () => {
    const lines = [
      { channelSku: "LT075-HONG", externalId: "111-2" },
      { channelSku: "CU-KHONG-ID", externalId: "999-9" },
      { channelSku: "LA", externalId: null },
    ];
    const m = await resolveOrderLineRows(prisma, channelId, lines);
    expect(m.get("111-2")?.channelSku).toBe("LT075-HONG (Hồng, 5-7kg)");
    expect(Number(m.get("111-2")?.costPrice)).toBe(65000);
    expect(m.get("999-9")?.channelSku).toBe("CU-KHONG-ID");
    expect(m.get("LA")).toBeUndefined();
  });

  it("aggregateShopeeItems: hai size cùng model_sku ra HAI dòng, cùng model gộp số lượng", () => {
    const order = {
      order_sn: "SN",
      item_list: [
        { item_id: 111, model_id: 1, model_sku: "LT075-HONG", item_name: "Body", model_name: "Hồng,3-5kg", model_quantity_purchased: 1, model_discounted_price: 100 },
        { item_id: 111, model_id: 2, model_sku: "LT075-HONG", item_name: "Body", model_name: "Hồng,5-7kg", model_quantity_purchased: 2, model_discounted_price: 100 },
        { item_id: 111, model_id: 2, model_sku: "LT075-HONG", item_name: "Body", model_name: "Hồng,5-7kg", model_quantity_purchased: 1, model_discounted_price: 100 },
      ],
    } as ShopeeOrderDetail;
    const lines = aggregateShopeeItems(order);
    expect(lines.map((l) => [lineKey(l), l.channelSku, l.quantity])).toEqual([
      ["111-1", "LT075-HONG", 1],
      ["111-2", "LT075-HONG", 3],
    ]);
  });

  it("aggregateLineItems (TikTok): hai sku_id cùng seller_sku ra HAI dòng", () => {
    const order = {
      id: "O",
      line_items: [
        { id: "a", product_id: "P", sku_id: "S1", seller_sku: "LT121-BE", sku_name: "Bé, 3-5kg", sale_price: "100" },
        { id: "b", product_id: "P", sku_id: "S2", seller_sku: "LT121-BE", sku_name: "Bé, 5-7kg", sale_price: "100" },
        { id: "c", product_id: "P", sku_id: "S2", seller_sku: "LT121-BE", sku_name: "Bé, 5-7kg", sale_price: "100" },
      ],
    } as unknown as TikTokOrder;
    const lines = aggregateLineItems(order);
    expect(lines.map((l) => [lineKey(l), l.quantity])).toEqual([
      ["P-S1", 1],
      ["P-S2", 2],
    ]);
  });

  it("expandReturnKeys: id đầy đủ và id lá đều ra khóa dòng sàn", async () => {
    const full = await expandReturnKeys(prisma, channelId, new Map([["111-1", 2]]));
    expect([...full]).toEqual([["LT075-HONG (Hồng, 3-5kg)", 2]]);
    const leaf = await expandReturnKeys(prisma, channelId, new Map([["2", 1]]));
    expect([...leaf]).toEqual([["LT075-HONG (Hồng, 5-7kg)", 1]]);
    expect((await expandReturnKeys(prisma, channelId, new Map())).size).toBe(0);
  });
});
