// Nguồn "Tạo mới" — ghi Tổng kho (ensureWarehouseProducts) với GIÁ VỐN TỪNG PHÂN LOẠI (27/11/2026, cột Giá vốn
// trong bảng phân loại của form). Chạy trên DB dev, tự dọn.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { ensureWarehouseProducts, parseManualListing, type ManualSource } from "../manual";

const stamp = Date.now();
const sku = (s: string) => `TESTMW${stamp}-${s}`;
let userId = "";

const body = (costs: (number | string | undefined)[], costPrice: number | null) => ({
  title: `TEST Mũ giá vốn từng phân loại ${stamp}`,
  description: "Mô tả đủ dài để qua ngưỡng tối thiểu hai mươi ký tự của mọi sàn.",
  images: [],
  descriptionImages: [],
  options: [{ name: "Màu", values: ["Đen", "Be", "Xanh"] }],
  variants: ["Đen", "Be", "Xanh"].map((name, i) => ({
    sku: sku(`${costPrice ?? "x"}-${name === "Đen" ? "DEN" : name === "Be" ? "BE" : "XANH"}`),
    name,
    price: 99_000,
    stock: i === 0 ? 4 : 0,
    costPrice: costs[i],
  })),
  costPrice,
});

async function save(costs: (number | string | undefined)[], costPrice: number | null, allowCost: boolean) {
  const parsed = parseManualListing(body(costs, costPrice));
  const source: ManualSource = { ...parsed.listing, manual: parsed.manual };
  await ensureWarehouseProducts(userId, userId, source, { allowCost });
  const rows = await prisma.product.findMany({
    where: { userId, skuCode: { in: parsed.listing.variants.map((v) => v.sku.toUpperCase()) } },
    select: { variantName: true, costPrice: true, quantityInStock: true },
  });
  return Object.fromEntries(rows.map((r) => [r.variantName, Number(r.costPrice)]));
}

describe("ensureWarehouseProducts — giá vốn từng phân loại", () => {
  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { email: `test-manual-warehouse-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("phân loại có giá riêng dùng giá riêng (kể cả 0), phân loại không gửi thì theo giá vốn chung", async () => {
    expect(await save([45_500, 0, undefined], 40_000, true)).toEqual({ Đen: 45_500, Be: 0, Xanh: 40_000 });
  });

  it("không có giá chung lẫn giá riêng → 0; người không thấy tài chính → 0 dù form gửi số", async () => {
    expect(await save([undefined, 30_000, ""], null, true)).toEqual({ Đen: 0, Be: 30_000, Xanh: 0 });
    expect(await save([45_500, 46_000, 47_000], 41_000, false)).toEqual({ Đen: 0, Be: 0, Xanh: 0 });
  });
});
