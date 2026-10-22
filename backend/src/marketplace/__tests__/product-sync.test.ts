// ============================================================
// ĐỒNG BỘ SẢN PHẨM — DANH TÍNH THEO externalId (15/10/2026, sự cố Hi.Bé)
//
// Chạy trên DB local thật, adapter mock qua registry. Kiểm:
//   1. Dòng gộp cũ "LT075-HONG" (externalId model đầu, đã nối kho) → sau sync
//      ĐỔI KHÓA thành "LT075-HONG (Hồng, 3-5kg)", GIỮ productId + giá vốn; 4 size
//      còn lại thành 4 dòng mới; không dòng nào bị DELISTED oan.
//   2. Đổi tên phân loại trên sàn → đổi khóa theo externalId, không tạo dòng mới.
//   3. Adapter lượt sau không trả tên (TikTok details=false) → khóa KHÔNG nhảy về "#id".
//   4. Khóa mới thuộc dòng khác → không đổi (giữ unique), vẫn cập nhật dữ liệu.
// ============================================================
import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName } from "@prisma/client";
import type { FetchedProducts, NormalizedChannelProduct } from "../types";

const fetchProducts = vi.fn<() => Promise<FetchedProducts>>();
vi.mock("../registry", () => ({
  getProductAdapter: () => ({ name: "mock-test", fetchProducts }),
}));
vi.mock("../../lib/cost-mapping", () => ({ autoFillCostForNewSkus: async () => 0 }));

import { prisma } from "../../lib/prisma";
import { syncChannelProducts } from "../product-sync";

const stamp = Date.now();
let userId = "";
let channelId = "";
let productId = "";

function p(over: Partial<NormalizedChannelProduct>): NormalizedChannelProduct {
  return {
    channelSku: "LT075-HONG",
    productName: "Bodysuit 3-11kg",
    variantName: null,
    price: 150000,
    imageUrl: null,
    externalId: null,
    itemSku: "LT075",
    channelStock: 5,
    channelStockLocationId: null,
    status: "ACTIVE",
    ...over,
  };
}

const SIZES = ["3-5kg", "5-7kg", "7-9kg", "9-11kg", "11-13kg"];
const leaf = (i: number) => `19996356384-${100 + i}`;

async function rows() {
  return prisma.channelProduct.findMany({
    where: { channelId },
    orderBy: { channelSku: "asc" },
    select: { channelSku: true, externalId: true, variantName: true, productId: true, status: true, channelStock: true },
  });
}

describe("product-sync: externalId là danh tính, mã trùng thêm đuôi phân loại", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-product-sync-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST product sync", role: "ADMIN" },
    });
    userId = user.id;
    const ch = await prisma.channel.create({
      data: { userId, channelName: ChannelName.SHOPEE, shopName: "TEST-PSYNC", externalShopId: `8${stamp}`, status: "ACTIVE" },
    });
    channelId = ch.id;
    const prod = await prisma.product.create({
      data: { userId, skuCode: `LT075-HONG-${stamp}`, productName: "Kho Hồng", costPrice: 70000, sellingPrice: 150000 },
    });
    productId = prod.id;
    // Dòng GỘP cũ như prod trước 15/10: khóa mã thô, externalId model đầu, đã nối kho.
    await prisma.channelProduct.create({
      data: { channelId, channelSku: "LT075-HONG", productName: "Bodysuit 3-11kg", externalId: leaf(0), productId, costPrice: 71000, channelStock: 295 },
    });
    // Dòng mã duy nhất không liên quan — phải giữ nguyên.
    await prisma.channelProduct.create({
      data: { channelId, channelSku: "LT098", productName: "Jumpsuit", externalId: "22265224437-177071501528", channelStock: 325 },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  it("1. dòng gộp cũ đổi khóa theo externalId, giữ liên kết kho; 4 size mới tách dòng; không DELISTED oan", async () => {
    fetchProducts.mockResolvedValue({
      complete: true,
      products: [
        ...SIZES.map((s, i) => p({ externalId: leaf(i), variantName: `Hồng,${s}`, channelStock: 10 + i })),
        p({ channelSku: "LT098", externalId: "22265224437-177071501528", productName: "Jumpsuit", channelStock: 320 }),
      ],
    });
    const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const r = await syncChannelProducts(ch);
    expect(r).toMatchObject({ scanned: 6, created: 4, updated: 2, renamed: 1, delisted: 0, complete: true });

    const all = await rows();
    expect(all.map((x) => x.channelSku).sort()).toEqual(
      [...SIZES.map((s) => `LT075-HONG (Hồng, ${s})`), "LT098"].sort()
    );
    const first = all.find((x) => x.externalId === leaf(0))!;
    expect(first.productId).toBe(productId);
    expect(first.channelStock).toBe(10);
    expect(first.variantName).toBe("Hồng,3-5kg");
    expect(all.filter((x) => x.productId).length).toBe(1);
    expect(all.every((x) => x.status === "ACTIVE")).toBe(true);
    const cost = await prisma.channelProduct.findFirst({ where: { channelId, externalId: leaf(0) }, select: { costPrice: true } });
    expect(Number(cost?.costPrice)).toBe(71000);
  });

  it("2. đổi tên phân loại trên sàn → đổi khóa, không tạo dòng mới", async () => {
    fetchProducts.mockResolvedValue({
      complete: true,
      products: [
        ...SIZES.map((s, i) => p({ externalId: leaf(i), variantName: i === 0 ? "Hồng,3-5 kg" : `Hồng,${s}` })),
        p({ channelSku: "LT098", externalId: "22265224437-177071501528", productName: "Jumpsuit" }),
      ],
    });
    const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const r = await syncChannelProducts(ch);
    expect(r).toMatchObject({ created: 0, updated: 6, renamed: 1, delisted: 0 });
    const first = await prisma.channelProduct.findFirst({ where: { channelId, externalId: leaf(0) } });
    expect(first?.channelSku).toBe("LT075-HONG (Hồng, 3-5 kg)");
    expect(first?.productId).toBe(productId);
  });

  it("3. lượt không trả tên phân loại (details=false) → khóa giữ nguyên nhờ tên đã lưu", async () => {
    fetchProducts.mockResolvedValue({
      complete: true,
      products: [
        ...SIZES.map((_, i) => p({ externalId: leaf(i), variantName: null, channelStock: 1 })),
        p({ channelSku: "LT098", externalId: "22265224437-177071501528", productName: "Jumpsuit", variantName: null, channelStock: 1 }),
      ],
    });
    const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const r = await syncChannelProducts(ch);
    expect(r).toMatchObject({ created: 0, updated: 6, renamed: 0, delisted: 0 });
    const all = await rows();
    expect(all.map((x) => x.channelSku).sort()).toEqual(
      ["LT075-HONG (Hồng, 3-5 kg)", ...SIZES.slice(1).map((s) => `LT075-HONG (Hồng, ${s})`), "LT098"].sort()
    );
    expect(all.every((x) => x.channelStock === 1)).toBe(true);
  });

  it("4. khóa mới đang thuộc dòng khác → không đổi khóa, vẫn cập nhật; sàn bỏ model → DELISTED", async () => {
    // Dòng lạ đang chiếm khóa mà model 1 sẽ muốn lấy.
    await prisma.channelProduct.create({
      data: { channelId, channelSku: "LT075-HONG (Hồng, 5-7kg) #x", productName: "Lạ", externalId: "1-1" },
    });
    await prisma.channelProduct.update({
      where: { channelId_channelSku: { channelId, channelSku: "LT075-HONG (Hồng, 5-7kg)" } },
      data: { channelSku: "LT075-HONG (Hồng, 5-7kg) #old" },
    });
    await prisma.channelProduct.create({
      data: { channelId, channelSku: "LT075-HONG (Hồng, 5-7kg)", productName: "Chiếm khóa", externalId: "2-2" },
    });
    fetchProducts.mockResolvedValue({
      complete: true,
      // Bỏ model 4 (size 11-13kg) → phải DELISTED; model 1 muốn khóa đang bị "2-2" chiếm.
      products: SIZES.slice(0, 4).map((s, i) => p({ externalId: leaf(i), variantName: `Hồng,${s}`, channelStock: 7 })),
    });
    const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const r = await syncChannelProducts(ch);
    expect(r).toMatchObject({ created: 0, updated: 4, renamed: 1 });
    // DELISTED: size 11-13kg + LT098 + 2 dòng lạ (không có trong lượt kéo).
    expect(r.delisted).toBe(4);
    const m1 = await prisma.channelProduct.findFirst({ where: { channelId, externalId: leaf(1) } });
    expect(m1?.channelSku).toBe("LT075-HONG (Hồng, 5-7kg) #old");
    expect(m1?.channelStock).toBe(7);
    expect(m1?.status).toBe("ACTIVE");
    const gone = await prisma.channelProduct.findFirst({ where: { channelId, externalId: leaf(4) } });
    expect(gone?.status).toBe("DELISTED");
    // SKU kho vẫn còn liên kết ACTIVE (4 size kia) → KHÔNG tự Ngừng bán.
    expect(r.deactivated).toBe(0);
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(prod.isActive).toBe(true);
  });

  it("5. sàn gỡ HẾT phân loại của một SKU kho → SKU kho tự Ngừng bán; SKU còn gian khác bán thì giữ", async () => {
    // SKU kho thứ hai nối với LT098 (đang DELISTED từ test 4) + một gian khác còn ACTIVE.
    const other = await prisma.channel.create({
      data: { userId, channelName: ChannelName.LAZADA, shopName: "TEST-PSYNC-2", externalShopId: `9${stamp}`, status: "ACTIVE" },
    });
    const keep = await prisma.product.create({
      data: { userId, skuCode: `LT098-${stamp}`, productName: "Kho Jumpsuit", variantName: null },
    });
    await prisma.channelProduct.update({
      where: { channelId_channelSku: { channelId, channelSku: "LT098" } },
      data: { productId: keep.id, status: "ACTIVE" },
    });
    await prisma.channelProduct.create({
      data: { channelId: other.id, channelSku: "LT098", productName: "Jumpsuit LZD", externalId: "l-1", productId: keep.id },
    });
    // Lượt kéo mới: sàn bỏ cả 4 size còn lại của LT075-HONG lẫn LT098.
    fetchProducts.mockResolvedValue({ complete: true, products: [] });
    const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const r = await syncChannelProducts(ch);
    expect(r.delisted).toBeGreaterThanOrEqual(5);
    // LT075-HONG: mọi liên kết đều DELISTED → Ngừng bán. LT098: gian Lazada còn ACTIVE → giữ.
    expect(r.deactivated).toBe(1);
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(prod.isActive).toBe(false);
    const kept = await prisma.product.findUniqueOrThrow({ where: { id: keep.id } });
    expect(kept.isActive).toBe(true);
  });
});
