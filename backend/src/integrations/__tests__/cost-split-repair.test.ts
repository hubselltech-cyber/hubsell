// ============================================================
// SỬA MỘT LẦN GIÁ VỐN LÁ TÁCH 15/10 (Lát 3, 18/10/2026 — docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 8):
//   · luật thuần inheritedCostOf: một giá → giá đó; hai giá khác / không giá → null;
//   · DB dev: lá đích nhận giá nguồn (giá riêng gian hoặc giá kho chép xuống) + dấu thừa kế; lá đã có giá / đã nối kho /
//     tạo ngoài cửa sổ tách / nhóm nguồn khác giá / nhóm không nguồn → không đụng; dòng đơn giá 0 được vá, dòng có giá giữ;
//     chạy lại idempotent; khách sửa tay → dấu về NULL.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyChannelCostPrice } from "../../lib/cost-price";
import { prisma } from "../../lib/prisma";
import { inheritedCostOf, repairSplitLeafCosts, revertCrossProductInheritance } from "../../services/cost-split-repair";
import { createStockFixture, type StockFixture } from "./fixtures";

describe("inheritedCostOf — luật thuần", () => {
  const c = (...costs: number[]) => costs.map((effectiveCost) => ({ effectiveCost }));
  it("một nguồn có giá (các lá khác 0) → giá đó; nhiều nguồn cùng giá → giá đó", () => {
    expect(inheritedCostOf(c(120_000, 0, 0))).toBe(120_000);
    expect(inheritedCostOf(c(120_000, 120_000, 0))).toBe(120_000);
  });
  it("hai giá khác nhau (khách đã cố ý đặt khác) hoặc không ai có giá → null, không đoán", () => {
    expect(inheritedCostOf(c(120_000, 130_000, 0))).toBeNull();
    expect(inheritedCostOf(c(0, 0))).toBeNull();
    expect(inheritedCostOf([])).toBeNull();
  });
});

describe("repairSplitLeafCosts — DB dev", () => {
  let fx: StockFixture;
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;
  const inWindow = new Date("2026-10-16T10:00:00+07:00");
  const before = new Date("2026-10-01T10:00:00+07:00");
  const ids: Record<string, string> = {};
  const lineIds: Record<string, string> = {};

  async function leaf(name: string, externalId: string, over: { costPrice?: number; productId?: string; createdAt?: Date } = {}) {
    const row = await prisma.channelProduct.create({
      data: {
        channelId: fx.channelId,
        channelSku: sku(name),
        productName: name,
        externalId,
        costPrice: over.costPrice,
        productId: over.productId,
        createdAt: over.createdAt ?? inWindow,
      },
    });
    ids[name] = row.id;
    return row;
  }
  async function line(code: string, name: string, externalId: string | null, cost: number) {
    const o = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-${code}`,
        customerName: "Khách test",
        itemCount: 1,
        items: { create: { channelSku: sku(name), externalId, productName: name, quantity: 1, price: 200_000, costPriceAtSale: cost } },
      },
      include: { items: true },
    });
    lineIds[code] = o.items[0].id;
  }
  const costOf = async (name: string) => {
    const r = await prisma.channelProduct.findUniqueOrThrow({ where: { id: ids[name] } });
    return { cost: Number(r.costPrice ?? 0), inherited: r.costPriceInheritedAt != null };
  };
  const lineCost = async (code: string) => Number((await prisma.orderItem.findUniqueOrThrow({ where: { id: lineIds[code] } })).costPriceAtSale);

  beforeAll(async () => {
    fx = await createStockFixture("splitrepair");
    const kho = await fx.createProduct(0);
    await prisma.product.update({ where: { id: kho }, data: { costPrice: 90_000 } });
    // A: nguồn giá riêng gian 120k (dòng gộp cũ, tạo trước 15/10) + 2 lá tách trống → nhận 120k.
    await leaf("A (Đỏ)", "100-1", { costPrice: 120_000, createdAt: before });
    await leaf("A (Xanh)", "100-2");
    await leaf("A (Vàng)", "100-3");
    // B: nguồn dùng GIÁ KHO qua liên kết (90k) → lá tách nhận 90k thành giá riêng gian, KHÔNG nối kho.
    await leaf("B (S)", "200-1", { productId: kho, createdAt: before });
    await leaf("B (M)", "200-2");
    // C: hai nguồn khác giá → không đoán.
    await leaf("C (1)", "300-1", { costPrice: 50_000, createdAt: before });
    await leaf("C (2)", "300-2", { costPrice: 55_000, createdAt: before });
    await leaf("C (3)", "300-3");
    // D: không nguồn nào có giá → không làm gì (Hi.Bé).
    await leaf("D (1)", "400-1", { createdAt: before });
    await leaf("D (2)", "400-2");
    // E: lá trống nhưng tạo NGOÀI cửa sổ tách (khách thêm phân loại sau này) → khách tự nhập.
    await leaf("E (1)", "500-1", { costPrice: 70_000, createdAt: before });
    await leaf("E (2)", "500-2", { createdAt: new Date("2026-10-25T10:00:00+07:00") });
    // G: cùng mã thô "A" nhưng SẢN PHẨM KHÁC (SPU 700) — không được mang giá của A sang (prod 18/10: 3.489 lá bị gán oan).
    await leaf("A (Khác SP)", "700-1");
    // Dòng đơn của lá A (Xanh): một dòng giá 0 (sẽ vá), một dòng đã có giá (giữ).
    await line("L0", "A (Xanh)", "100-2", 0);
    await line("L1", "A (Xanh)", "100-2", 111_000);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("trả giá cho đúng lá tách có lịch sử; chép giá kho xuống giá gian; không đụng nhóm khác giá / không nguồn / ngoài cửa sổ", async () => {
    const r = await repairSplitLeafCosts({ channelId: fx.channelId });
    expect(r).toMatchObject({ leaves: 3, orderLines: 1, channels: 1 });
    expect(await costOf("A (Xanh)")).toEqual({ cost: 120_000, inherited: true });
    expect(await costOf("A (Vàng)")).toEqual({ cost: 120_000, inherited: true });
    expect(await costOf("A (Đỏ)")).toEqual({ cost: 120_000, inherited: false }); // nguồn không đụng
    const bm = await prisma.channelProduct.findUniqueOrThrow({ where: { id: ids["B (M)"] } });
    expect(Number(bm.costPrice)).toBe(90_000);
    expect(bm.productId).toBeNull(); // không nối kho hộ
    expect(await costOf("C (3)")).toEqual({ cost: 0, inherited: false });
    expect(await costOf("D (2)")).toEqual({ cost: 0, inherited: false });
    expect(await costOf("E (2)")).toEqual({ cost: 0, inherited: false });
    expect(await costOf("A (Khác SP)")).toEqual({ cost: 0, inherited: false }); // trùng mã, khác sản phẩm → không mang giá sang
    expect(await lineCost("L0")).toBe(120_000);
    expect(await lineCost("L1")).toBe(111_000);
  });

  it("revertCrossProductInheritance: lá nhận giá oan (khác sản phẩm) → lá về trống, dòng đơn từ 15/10 mang giá đó về 0; lá đúng giữ nguyên", async () => {
    // Giả lập lượt prod 13:18: lá "A (Khác SP)" (SPU 700) bị gán giá 120k của A (SPU 100) + dòng đơn đã bị vá theo.
    await prisma.channelProduct.update({ where: { id: ids["A (Khác SP)"] }, data: { costPrice: 120_000, costPriceInheritedAt: new Date() } });
    await line("LX", "A (Khác SP)", "700-1", 120_000);
    await line("LY", "A (Khác SP)", "700-1", 99_000); // số thật khác giá thừa kế → không đụng
    const u = await revertCrossProductInheritance({ channelId: fx.channelId });
    expect(u).toEqual({ leaves: 1, orderLines: 1 });
    expect(await costOf("A (Khác SP)")).toEqual({ cost: 0, inherited: false });
    expect(await lineCost("LX")).toBe(0);
    expect(await lineCost("LY")).toBe(99_000);
    expect(await costOf("A (Xanh)")).toEqual({ cost: 120_000, inherited: true }); // lá đúng (cùng SPU) không bị hoàn tác
    expect(await revertCrossProductInheritance({ channelId: fx.channelId })).toEqual({ leaves: 0, orderLines: 0 });
  });

  it("chạy lại không ghi gì; khách sửa tay thì dấu thừa kế về NULL và lượt sau không ghi đè", async () => {
    expect(await repairSplitLeafCosts({ channelId: fx.channelId })).toMatchObject({ leaves: 0, orderLines: 0 });
    await applyChannelCostPrice([ids["A (Vàng)"]], 150_000, fx.userId);
    expect(await costOf("A (Vàng)")).toEqual({ cost: 150_000, inherited: false });
    expect(await repairSplitLeafCosts({ channelId: fx.channelId })).toMatchObject({ leaves: 0 });
    expect(await costOf("A (Vàng)")).toEqual({ cost: 150_000, inherited: false });
  });
});
