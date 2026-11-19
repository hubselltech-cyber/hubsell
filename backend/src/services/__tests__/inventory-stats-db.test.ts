// Thống kê Tổng kho (19/11/2026) — số ở hộp phải cộng ra đúng định nghĩa của bảng. Chạy trên DB dev, tự dọn.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { productGroupKey } from "../../lib/product-group";
import { loadInventoryStats } from "../inventory-stats";

const stamp = Date.now();
let userId = "";
let otherId = "";

const mk = (owner: string, code: string, name: string, variant: string | null, qty: number, cost: number, isActive = true) =>
  prisma.product.create({
    data: {
      userId: owner,
      skuCode: `TEST-TK-${code}-${stamp}`,
      productName: name,
      variantName: variant,
      groupKey: productGroupKey(name, variant),
      sellingPrice: 100_000,
      costPrice: cost,
      quantityInStock: qty,
      isActive,
    },
  });

describe("loadInventoryStats", () => {
  beforeAll(async () => {
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: { email: `test-kho-thong-ke-${tag}-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      });
    userId = (await mkUser("a")).id;
    otherId = (await mkUser("b")).id;
    const ao = `TEST Áo thống kê ${stamp}`;
    await mk(userId, "AO-M", ao, "M", 10, 50_000); // còn hàng, 500.000
    await mk(userId, "AO-L", ao, "L", 0, 50_000); // hết hàng
    await mk(userId, "AO-XL", ao, "XL", -3, 50_000); // âm tồn → tính 0, vẫn là hết hàng
    await mk(userId, "COC", `TEST Cốc thống kê ${stamp}`, null, 4, 0); // còn hàng, chưa có giá vốn
    await mk(userId, "CU", `TEST Hàng cũ ${stamp}`, null, 2, 30_000, false); // ngừng bán còn tồn, 60.000
    // Chủ shop khác — không được lẫn vào.
    await mk(otherId, "KHAC", `TEST Shop khác ${stamp}`, null, 999, 999_000);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("đếm theo mẫu / SKU, tồn âm tính 0, giá trị = tồn × giá vốn, không lẫn shop khác", async () => {
    const s = await loadInventoryStats(userId, { seesCost: true });
    expect(s.products).toBe(2); // Áo (3 phân loại) + Cốc; hàng ngừng bán không tính là sản phẩm đang bán
    expect(s.inStock).toEqual({ skus: 2, quantity: 14, value: 500_000 });
    expect(s.outOfStock).toEqual({ skus: 2, quantity: 0, value: 0 });
    expect(s.inactive).toEqual({ skus: 1, quantity: 2, value: 60_000 });
    expect(s.total).toEqual({ skus: 5, quantity: 16, value: 560_000 });
    expect(s.negativeSkus).toBe(1);
    expect(s).toMatchObject({ noCostSkus: 1, noCostQuantity: 4, costPriceHidden: false });
  });

  it("người không thấy tài chính: có số lượng, KHÔNG có trường tiền nào", async () => {
    const s = await loadInventoryStats(userId, { seesCost: false });
    expect(s.total).toEqual({ skus: 5, quantity: 16 });
    expect(s.inStock).toEqual({ skus: 2, quantity: 14 });
    expect(s.costPriceHidden).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/value|noCost/);
  });

  it("kho trống → toàn số 0, không lỗi", async () => {
    const empty = await prisma.user.create({
      data: { email: `test-kho-thong-ke-rong-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
      select: { id: true },
    });
    try {
      const s = await loadInventoryStats(empty.id, { seesCost: true });
      expect(s.products).toBe(0);
      expect(s.total).toEqual({ skus: 0, quantity: 0, value: 0 });
    } finally {
      await prisma.user.delete({ where: { id: empty.id } });
    }
  });
});
