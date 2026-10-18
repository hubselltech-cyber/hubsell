// ============================================================
// LƯỢT VÁ ĐỊNH KỲ DÒNG ĐƠN GIÁ VỐN 0 CỦA LÁ ĐÃ CÓ GIÁ (18/10/2026 — docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 9), DB dev:
//   · lá có giá riêng gian → dòng 0 nhận giá riêng; lá dùng giá kho qua liên kết → nhận giá kho; lá không giá → giữ 0;
//   · dòng đã có số → không đụng; dòng có id chỉ khớp id (mã trùng lá khác không vá oan); dòng chưa có id khớp ba nhánh mã;
//   · lá trùng id (DELISTED cũ + ACTIVE mới) → giá của lá ACTIVE; gian khác không bị chạm; chạy lại idempotent;
//   · bước worker: công tắc COST_ZERO_REPAIR_OFF=1 → không ghi gì.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ChannelProductStatus } from "@prisma/client";
import { repairZeroCostLinesForChannel } from "../../lib/cost-price";
import { prisma } from "../../lib/prisma";
import { repairZeroCostLinesAfterSync } from "../../workers/product-catalog-sync";
import { createStockFixture, type StockFixture } from "./fixtures";

describe("repairZeroCostLinesForChannel — DB dev", () => {
  let fx: StockFixture;
  let otherChannelId: string;
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;
  const lineIds: Record<string, string> = {};

  async function leaf(
    name: string,
    externalId: string | null,
    over: { costPrice?: number; productId?: string; status?: ChannelProductStatus; channelId?: string } = {}
  ) {
    return prisma.channelProduct.create({
      data: {
        channelId: over.channelId ?? fx.channelId,
        channelSku: sku(name),
        productName: name,
        externalId,
        costPrice: over.costPrice,
        productId: over.productId,
        status: over.status ?? ChannelProductStatus.ACTIVE,
      },
    });
  }
  async function line(code: string, channelSku: string, externalId: string | null, cost: number, channelId = fx.channelId) {
    const o = await prisma.order.create({
      data: {
        channelId,
        orderCode: `TEST-${fx.suffix}-${code}`,
        customerName: "Khách test",
        itemCount: 1,
        items: { create: { channelSku, externalId, productName: code, quantity: 1, price: 200_000, costPriceAtSale: cost } },
      },
      include: { items: true },
    });
    lineIds[code] = o.items[0].id;
  }
  const lineCost = async (code: string) => Number((await prisma.orderItem.findUniqueOrThrow({ where: { id: lineIds[code] } })).costPriceAtSale);

  beforeAll(async () => {
    fx = await createStockFixture("zerorepair");
    otherChannelId = (
      await prisma.channel.create({
        data: { userId: fx.userId, channelName: ChannelName.TIKTOK, shopName: `TEST-${fx.suffix}-other` },
      })
    ).id;
    const kho = await fx.createProduct(0);
    await prisma.product.update({ where: { id: kho }, data: { costPrice: 90_000 } });

    // A: giá riêng gian 120k, id "100-1"; thêm bản DELISTED cũ cùng id giá 70k (người bán từng đổi mã) → ACTIVE thắng.
    await leaf("A", "100-1", { costPrice: 120_000 });
    await leaf("A-cu", "100-1", { costPrice: 70_000, status: ChannelProductStatus.DELISTED });
    // B: không giá riêng, nối kho 90k.
    await leaf("B", "200-1", { productId: kho });
    // C: không giá gì cả.
    await leaf("C", "300-1");
    // D: giá riêng 50k, id "400-7" — cho ba nhánh mã của dòng chưa có id.
    await leaf("D", "400-7", { costPrice: 50_000 });

    await line("A0", sku("A"), "100-1", 0); // → 120k (id)
    await line("A1", sku("A"), "100-1", 111_000); // đã có số → giữ
    await line("B0", sku("B"), "200-1", 0); // → 90k (giá kho qua liên kết)
    await line("C0", sku("C"), "300-1", 0); // lá không giá → 0
    await line("D-ma", sku("D"), null, 0); // → 50k (mã hiện tại)
    await line("D-skuid", "7", null, 0); // → 50k (sku_id sau dấu "-")
    await line("D-spe", "SPE-400-7", null, 0); // → 50k (SPE- + externalId)
    await line("X-id", sku("D"), "999-9", 0); // CÓ id nhưng không lá nào mang id đó → không dùng mã → 0
    await line("K-khac", sku("A"), "100-1", 0, otherChannelId); // gian khác → không chạm
    await line("N-sai", sku("Z"), null, 0); // không khớp gì → 0
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("vá đúng dòng 0 của lá có giá hiệu lực; id trước, mã sau; không đụng dòng có số / lá không giá / gian khác", async () => {
    const r = await repairZeroCostLinesForChannel(prisma, fx.channelId);
    expect(r).toEqual({ byId: 2, byCode: 3 });
    expect(await lineCost("A0")).toBe(120_000);
    expect(await lineCost("A1")).toBe(111_000);
    expect(await lineCost("B0")).toBe(90_000);
    expect(await lineCost("C0")).toBe(0);
    expect(await lineCost("D-ma")).toBe(50_000);
    expect(await lineCost("D-skuid")).toBe(50_000);
    expect(await lineCost("D-spe")).toBe(50_000);
    expect(await lineCost("X-id")).toBe(0);
    expect(await lineCost("K-khac")).toBe(0);
    expect(await lineCost("N-sai")).toBe(0);
    // Không tạo giá mới / không nối kho hộ.
    const c = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: fx.channelId, channelSku: sku("C") } });
    expect(c.costPrice).toBeNull();
    expect(c.productId).toBeNull();
    const b0 = await prisma.orderItem.findUniqueOrThrow({ where: { id: lineIds["B0"] } });
    expect(b0.productId).toBeNull();
  });

  it("chạy lại không ghi gì (idempotent)", async () => {
    expect(await repairZeroCostLinesForChannel(prisma, fx.channelId)).toEqual({ byId: 0, byCode: 0 });
  });

  it("bước worker: tắt bằng COST_ZERO_REPAIR_OFF=1 thì không ghi; bật thì vá", async () => {
    await prisma.orderItem.update({ where: { id: lineIds["A0"] }, data: { costPriceAtSale: 0 } });
    const ch = { id: fx.channelId, userId: fx.userId, shopName: "TEST", channelName: ChannelName.SHOPEE };
    process.env.COST_ZERO_REPAIR_OFF = "1";
    try {
      expect(await repairZeroCostLinesAfterSync(ch)).toBe(0);
      expect(await lineCost("A0")).toBe(0);
    } finally {
      delete process.env.COST_ZERO_REPAIR_OFF;
    }
    expect(await repairZeroCostLinesAfterSync(ch)).toBe(1);
    expect(await lineCost("A0")).toBe(120_000);
  });
});
