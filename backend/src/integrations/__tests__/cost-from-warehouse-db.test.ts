// ============================================================
// "LẤY GIÁ VỐN TỪ TỔNG KHO" (lát B, 27/11/2026 — lib/cost-from-warehouse.ts) trên DB dev: một sản phẩm kho giá
// 100k nối bốn SKU sàn ở hai gian — bằng giá kho, lệch ít, lệch nhiều lần, đang theo kho — cộng một sản phẩm kho
// chưa có giá. Kiểm số xem trước, thứ tự + cờ lệch nhiều, phạm vi theo gian, và lượt áp chỉ đụng đúng dòng.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";
import { applyCostFromWarehouse, previewCostFromWarehouse } from "../../lib/cost-from-warehouse";

describe("Lấy giá vốn từ Tổng kho", () => {
  let fx: StockFixture;
  let other: StockFixture;
  let chB: string;
  const cp: Record<string, string> = {};
  const own = async (key: string) => {
    const row = await prisma.channelProduct.findUniqueOrThrow({ where: { id: cp[key] } });
    return row.costPrice === null ? null : Number(row.costPrice);
  };

  beforeAll(async () => {
    fx = await createStockFixture("fromwh");
    other = await createStockFixture("fromwh-other");
    chB = (
      await prisma.channel.create({
        data: { userId: fx.userId, channelName: ChannelName.TIKTOK, shopName: `TEST-${fx.suffix}-B` },
      })
    ).id;
    const priced = await fx.createProduct(0);
    const unpriced = await fx.createProduct(0);
    await prisma.product.update({ where: { id: priced }, data: { costPrice: 100_000 } });
    const mk = async (key: string, channelId: string, productId: string, costPrice: number | null) => {
      cp[key] = (
        await prisma.channelProduct.create({
          data: { channelId, channelSku: `TEST-${fx.suffix}-${key}`, productName: `SP ${key}`, variantName: key, productId, costPrice },
        })
      ).id;
    };
    await mk("SAME", fx.channelId, priced, 100_000);
    await mk("NEAR", fx.channelId, priced, 130_000);
    await mk("FAR", chB, priced, 500_000);
    await mk("FOLLOW", chB, priced, null);
    await mk("NOKHO", fx.channelId, unpriced, 50_000);
    // SKU sàn đang bán còn thiếu giá vốn mà nút KHÔNG giúp được: đã nối nhưng kho cũng chưa có giá; chưa nối kho.
    await mk("BOTH0", chB, unpriced, null);
    cp.UNLINKED = (
      await prisma.channelProduct.create({
        data: { channelId: fx.channelId, channelSku: `TEST-${fx.suffix}-UNLINKED`, productName: "SP chưa nối" },
      })
    ).id;
    // Đã gỡ khỏi sàn thì không tính là "đang bán còn thiếu giá".
    await prisma.channelProduct.create({
      data: { channelId: fx.channelId, channelSku: `TEST-${fx.suffix}-GONE`, productName: "SP đã gỡ", status: "DELISTED" },
    });
    // SKU sàn của chủ shop KHÁC — không bao giờ được lọt vào xem trước lẫn lượt áp.
    const strangerProduct = await other.createProduct(0);
    await prisma.product.update({ where: { id: strangerProduct }, data: { costPrice: 100_000 } });
    cp.STRANGER = (
      await prisma.channelProduct.create({
        data: { channelId: other.channelId, channelSku: `TEST-${fx.suffix}-STRANGER`, productName: "SP lạ", productId: strangerProduct, costPrice: 70_000 },
      })
    ).id;
  });
  afterAll(async () => {
    await fx?.cleanup();
    await other?.cleanup();
  });

  const all = () => ({ ownerId: fx.userId, channelName: null, channelId: null });

  it("xem trước: đếm đúng hai nhóm, dòng lệch nhiều lên đầu + có cờ, không lẫn sản phẩm kho chưa có giá / shop khác", async () => {
    const p = await previewCostFromWarehouse(all());
    expect(p).toMatchObject({ same: 1, differ: 2 });
    expect(p.rows.map((r) => [r.id, r.ownCost, r.warehouseCost, r.bigGap])).toEqual([
      [cp.FAR, 500_000, 100_000, true],
      [cp.NEAR, 130_000, 100_000, false],
    ]);
    expect(p.rows[0]).toMatchObject({ shopName: `TEST-${fx.suffix}-B`, channelName: "TIKTOK", variantName: "FAR" });
  });

  // Anh Trung 27/11: shop có cả nghìn SKU sàn chưa có giá vốn thì hộp phải nói rõ vì sao nút chưa lấy giá được.
  it("đếm SKU sàn đang bán còn thiếu giá vốn mà nút không giúp được: chưa nối kho / đã nối nhưng kho chưa có giá", async () => {
    // SKU đang theo giá kho (FOLLOW) và SKU có giá riêng trên sản phẩm kho chưa giá (NOKHO) đều ĐÃ có giá vốn → không đếm.
    expect(await previewCostFromWarehouse(all())).toMatchObject({ unlinkedNoCost: 1, linkedNoWarehouseCost: 1 });
    expect(await previewCostFromWarehouse({ ...all(), channelId: chB })).toMatchObject({ unlinkedNoCost: 0, linkedNoWarehouseCost: 1 });
    expect(await previewCostFromWarehouse({ ...all(), channelName: ChannelName.SHOPEE })).toMatchObject({
      unlinkedNoCost: 1,
      linkedNoWarehouseCost: 0,
    });
  });

  it("phạm vi theo gian / theo sàn", async () => {
    expect(await previewCostFromWarehouse({ ...all(), channelId: chB })).toMatchObject({ same: 0, differ: 1 });
    expect(await previewCostFromWarehouse({ ...all(), channelName: ChannelName.SHOPEE })).toMatchObject({ same: 1, differ: 1 });
    expect(await previewCostFromWarehouse({ ...all(), channelName: ChannelName.LAZADA })).toMatchObject({ same: 0, differ: 0, rows: [] });
  });

  it("áp: SKU bằng giá kho luôn theo; dòng lệch chỉ theo khi được tích; id ngoài phạm vi bị bỏ qua", async () => {
    const r = await applyCostFromWarehouse(all(), [cp.NEAR, cp.NOKHO, cp.STRANGER, "khong-co"]);
    expect(r).toEqual({ followedSame: 1, followedDiffer: 1 });
    expect(await own("SAME")).toBeNull();
    expect(await own("NEAR")).toBeNull();
    expect(await own("FAR")).toBe(500_000); // lệch nhiều, khách không tích → giữ
    expect(await own("NOKHO")).toBe(50_000); // kho chưa có giá → không được bỏ giá riêng (giá vốn sẽ về 0)
    expect(await own("STRANGER")).toBe(70_000);
    // Bấm lại: chỉ còn dòng lệch nhiều.
    expect(await previewCostFromWarehouse(all())).toMatchObject({ same: 0, differ: 1 });
    expect(await applyCostFromWarehouse(all(), [])).toEqual({ followedSame: 0, followedDiffer: 0 });
  });
});
