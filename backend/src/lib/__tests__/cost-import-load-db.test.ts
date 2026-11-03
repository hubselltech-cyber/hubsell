// Nhập Excel chỉ đọc các mã có trong file (03/11/2026). Chạy trên DB dev.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import { effectiveSkuCost } from "../cost-price";
import { planCostImport } from "../cost-import";
import { loadCostImportData } from "../cost-import-load";

const stamp = Date.now();
let userId = "";
let otherId = "";
let chA = "";
let chB = "";
let chOther = "";
let productId = "";

describe("loadCostImportData", () => {
  beforeAll(async () => {
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: { email: `test-cost-import-${tag}-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      });
    userId = (await mkUser("a")).id;
    otherId = (await mkUser("b")).id;
    const mkCh = (owner: string, shopName: string, ext: string, channelName: ChannelName) =>
      prisma.channel.create({
        data: { userId: owner, channelName, shopName, externalShopId: ext, status: "ACTIVE" },
        select: { id: true },
      });
    chA = (await mkCh(userId, "TEST-A", `91${stamp}`, ChannelName.SHOPEE)).id;
    chB = (await mkCh(userId, "TEST-B", `92${stamp}`, ChannelName.TIKTOK)).id;
    chOther = (await mkCh(otherId, "TEST-KHAC", `93${stamp}`, ChannelName.SHOPEE)).id;
    productId = (
      await prisma.product.create({
        data: { userId, skuCode: "KHO-1", productName: "Kho", costPrice: 70000, sellingPrice: 100000 },
        select: { id: true },
      })
    ).id;
    await prisma.channelProduct.createMany({
      data: [
        { channelId: chA, channelSku: "AO_1", productName: "SP", costPrice: 50000 },
        { channelId: chB, channelSku: " ao_1 ", productName: "SP" }, // khác hoa thường + khoảng trắng
        { channelId: chA, channelSku: "AOX1", productName: "SP" }, // "_" mà thành ký tự đại diện là dính nhầm
        { channelId: chA, channelSku: "VÀNG-1", productName: "SP" }, // dạng dựng sẵn
        { channelId: chB, channelSku: "VÀNG-1", productName: "SP" }, // dạng tổ hợp
        { channelId: chA, channelSku: "KHO-1", productName: "SP", productId },
        { channelId: chA, channelSku: "KHONG-TRONG-FILE", productName: "SP" },
        { channelId: chOther, channelSku: "AO_1", productName: "SP cua chu shop khac", costPrice: 1 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: [chA, chB, chOther] } } });
    await prisma.channel.deleteMany({ where: { id: { in: [chA, chB, chOther] } } });
    await prisma.product.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("chỉ trả đúng mã trong file: không phân biệt hoa thường, cả NFC lẫn NFD, '_' là chữ thường, không lộ chủ shop khác", async () => {
    const { channelProducts, products } = await loadCostImportData(userId, ["ao_1", "ao_1", " vàng-1 ", "kho-1", "KHONG-CO"]);
    expect(channelProducts.map((c) => c.channelSku).sort()).toEqual(
      [" ao_1 ", "AO_1", "KHO-1", "VÀNG-1", "VÀNG-1"].sort()
    );
    expect(channelProducts.some((c) => c.channelId === chOther)).toBe(false);
    expect(products.map((p) => p.skuCode)).toEqual(["KHO-1"]);
  });

  it("giá đọc đúng để tính giá hiệu lực: giá riêng, giá kho đã nối, chưa có giá", async () => {
    const { channelProducts } = await loadCostImportData(userId, ["ao_1", "kho-1"]);
    const by = new Map(channelProducts.map((c) => [c.channelSku, c]));
    expect(effectiveSkuCost(by.get("AO_1"))).toBe(50000);
    expect(effectiveSkuCost(by.get(" ao_1 "))).toBe(0);
    expect(effectiveSkuCost(by.get("KHO-1"))).toBe(70000);
  });

  it("file rỗng không gọi nhầm cả danh mục", async () => {
    expect(await loadCostImportData(userId, ["  ", ""])).toEqual({ products: [], channelProducts: [] });
  });

  it("cả chuỗi với planCostImport: đúng dòng được ghi, mã không có báo lỗi theo dòng", async () => {
    const rows = [
      { row: 2, sku: "ao_1", cost: 60000, shop: "", channel: "" },
      { row: 3, sku: "KHONG-CO", cost: 1000, shop: "", channel: "" },
    ];
    const data = await loadCostImportData(userId, rows.map((r) => r.sku));
    const plan = planCostImport(rows, {
      products: data.products,
      channels: [
        { id: chA, channelName: ChannelName.SHOPEE, shopName: "TEST-A" },
        { id: chB, channelName: ChannelName.TIKTOK, shopName: "TEST-B" },
      ],
      channelProducts: data.channelProducts.map((cp) => ({
        id: cp.id,
        channelId: cp.channelId,
        channelSku: cp.channelSku,
        productId: cp.productId,
        ownCost: Number(cp.costPrice ?? 0),
        currentCost: effectiveSkuCost(cp),
      })),
    });
    expect(plan.matchedRows).toBe(1);
    expect(plan.shopCost.size).toBe(2);
    expect(plan.errors).toEqual([{ row: 3, message: 'Không tìm thấy SKU "KHONG-CO" trong hệ thống' }]);
  });
});
