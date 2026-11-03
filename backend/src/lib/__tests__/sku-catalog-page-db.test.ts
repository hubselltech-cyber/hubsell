// Trang Giá vốn theo trang ở DB (lát 3.8, 03/11/2026). Chạy trên DB dev.
// Đo tải: SKU_PAGE_LOAD_ROWS=60000 npx vitest run src/lib/__tests__/sku-catalog-page-db.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import { foldSearchText, loadSkuCatalogPage, type SkuCatalogFilters } from "../sku-catalog-page";

const stamp = Date.now();
let userId = "";
let chA = "";
let chB = "";
const LOAD_ROWS = Number(process.env.SKU_PAGE_LOAD_ROWS) || 0;

const base = (): SkuCatalogFilters => ({
  ownerId: userId,
  channelName: null,
  channelId: null,
  q: "",
  status: "all",
  listing: "all",
  page: 1,
  pageSize: 20,
});

async function skus(ids: string[]) {
  const rows = await prisma.channelProduct.findMany({
    where: { id: { in: ids } },
    select: { id: true, channelSku: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r.channelSku]));
  return ids.map((id) => byId.get(id));
}

describe("loadSkuCatalogPage", () => {
  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `test-sku-page-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST sku page", role: "ADMIN" },
      select: { id: true },
    });
    userId = u.id;
    const mk = (channelName: ChannelName, shopName: string, ext: string) =>
      prisma.channel.create({
        data: { userId, channelName, shopName, externalShopId: ext, status: "ACTIVE" },
        select: { id: true },
      });
    chA = (await mk(ChannelName.SHOPEE, "TEST-A", `81${stamp}`)).id;
    chB = (await mk(ChannelName.TIKTOK, "TEST-B", `82${stamp}`)).id;
    const prod = await prisma.product.create({
      data: { userId, skuCode: `KHO-${stamp}`, productName: "Kho có giá", costPrice: 70000, sellingPrice: 100000 },
      select: { id: true },
    });
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
    await prisma.channelProduct.createMany({
      data: [
        // Mẫu 111 (cũ nhất): 2 phân loại, một có giá riêng, một trống.
        { channelId: chA, channelSku: "A-DO", productName: "Áo thun đỏ", externalId: "111-1", costPrice: 50000, createdAt: at(1) },
        { channelId: chA, channelSku: "A-XANH", productName: "Áo thun đỏ", variantName: "Xanh", externalId: "111-2", createdAt: at(2) },
        // Mẫu 222: nối kho có giá mặc định → tính là đã có giá dù ô riêng trống.
        { channelId: chA, channelSku: "B-1", productName: "Mũ lưỡi trai", externalId: "222-1", productId: prod.id, createdAt: at(3) },
        // Mẫu 333: đã gỡ, mã có dấu gạch dưới.
        { channelId: chA, channelSku: "C_1", productName: "Túi", externalId: "333-1", status: "DELISTED", createdAt: at(4) },
        // Cùng mã sản phẩm 111 nhưng gian khác = mẫu khác; không có externalId = đứng một mình.
        { channelId: chB, channelSku: "D-1", productName: "Dép", externalId: "111-9", createdAt: at(5) },
        { channelId: chB, channelSku: "E-1", productName: "Ví", createdAt: at(6) },
      ],
    });
    if (LOAD_ROWS > 0) {
      for (let done = 0; done < LOAD_ROWS; done += 5000) {
        await prisma.channelProduct.createMany({
          data: Array.from({ length: Math.min(5000, LOAD_ROWS - done) }, (_, i) => {
            const n = done + i;
            return {
              channelId: n % 3 === 0 ? chB : chA,
              channelSku: `LOAD-${n}`,
              productName: `Sản phẩm số ${Math.floor(n / 4)} váy đầm mùa hè giá tốt`,
              variantName: `Màu ${n % 4}`,
              externalId: `${900000 + Math.floor(n / 4)}-${n}`,
              costPrice: n % 2 === 0 ? 10000 : null,
            };
          }),
        });
      }
    }
  }, 300_000);

  afterAll(async () => {
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: [chA, chB] } } });
    await prisma.channel.deleteMany({ where: { id: { in: [chA, chB] } } });
    await prisma.product.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }, 300_000);

  it("foldSearchText: bỏ dấu cả dạng dựng sẵn lẫn tổ hợp", () => {
    expect(foldSearchText("Áo Thun ĐỎ")).toBe("ao thun do");
    expect(foldSearchText("Áo")).toBe("ao");
  });

  it.skipIf(LOAD_ROWS > 0)("chia trang theo MẪU, mẫu mới nhất trước, mỗi mẫu đủ phân loại", async () => {
    const p1 = await loadSkuCatalogPage({ ...base(), pageSize: 2 });
    expect(p1.filteredRows).toBe(6);
    expect(p1.totalGroups).toBe(5); // 111@A, 222@A, 333@A, 111@B, cp:E-1
    expect(await skus(p1.ids)).toEqual(["E-1", "D-1"]);
    const p3 = await loadSkuCatalogPage({ ...base(), pageSize: 2, page: 3 });
    expect(await skus(p3.ids)).toEqual(["A-XANH", "A-DO"]);
    const beyond = await loadSkuCatalogPage({ ...base(), pageSize: 2, page: 9 });
    expect(beyond.ids).toEqual([]);
    expect(beyond.filteredRows).toBe(6);
  });

  it.skipIf(LOAD_ROWS > 0)("lọc trạng thái giá vốn theo giá HIỆU LỰC, gồm giá mặc định ở kho", async () => {
    const missing = await loadSkuCatalogPage({ ...base(), status: "missing" });
    expect(await skus(missing.ids)).toEqual(["E-1", "D-1", "C_1", "A-XANH"]);
    const filled = await loadSkuCatalogPage({ ...base(), status: "filled" });
    expect(await skus(filled.ids)).toEqual(["B-1", "A-DO"]);
  });

  it.skipIf(LOAD_ROWS > 0)("lọc sàn, gian, đang bán / đã gỡ", async () => {
    expect((await loadSkuCatalogPage({ ...base(), channelName: ChannelName.TIKTOK })).filteredRows).toBe(2);
    expect((await loadSkuCatalogPage({ ...base(), channelId: chA })).filteredRows).toBe(4);
    expect((await loadSkuCatalogPage({ ...base(), listing: "delisted" })).filteredRows).toBe(1);
    expect((await loadSkuCatalogPage({ ...base(), listing: "active" })).filteredRows).toBe(5);
  });

  it.skipIf(LOAD_ROWS > 0)("tìm không dấu, tìm tên kho, tìm mã sàn; '_' là chữ thường không phải ký tự đại diện", async () => {
    expect(await skus((await loadSkuCatalogPage({ ...base(), q: "ao thun" })).ids)).toEqual(["A-XANH", "A-DO"]);
    expect(await skus((await loadSkuCatalogPage({ ...base(), q: "mu luoi" })).ids)).toEqual(["B-1"]);
    expect(await skus((await loadSkuCatalogPage({ ...base(), q: "kho co gia" })).ids)).toEqual(["B-1"]);
    expect(await skus((await loadSkuCatalogPage({ ...base(), q: "333" })).ids)).toEqual(["C_1"]);
    expect(await skus((await loadSkuCatalogPage({ ...base(), q: "c_1" })).ids)).toEqual(["C_1"]);
    expect((await loadSkuCatalogPage({ ...base(), q: "a_do" })).filteredRows).toBe(0);
  });

  it.skipIf(LOAD_ROWS > 0)("không lộ dữ liệu chủ shop khác", async () => {
    expect((await loadSkuCatalogPage({ ...base(), ownerId: "khong-ton-tai" })).filteredRows).toBe(0);
    expect((await loadSkuCatalogPage({ ...base(), ownerId: "khong-ton-tai", channelId: chA })).filteredRows).toBe(0);
  });

  it.runIf(LOAD_ROWS > 0)(
    "đo tải",
    async () => {
      const run = async (label: string, f: Partial<SkuCatalogFilters>) => {
        const t0 = Date.now();
        const r = await loadSkuCatalogPage({ ...base(), ...f });
        console.log(`[đo] ${label}: ${Date.now() - t0} ms, ${r.ids.length} dòng trang, ${r.filteredRows} dòng lọc, ${r.totalGroups} mẫu`);
      };
      await run("nguội trang 1", {});
      await run("trang 1", {});
      await run("trang giữa", { page: 300 });
      await run("thiếu giá", { status: "missing", listing: "active" });
      await run("một gian", { channelId: chA });
      await run("tìm có kết quả", { q: "vay dam" });
      await run("tìm mã", { q: "LOAD-1234" });
      await run("tìm không ra", { q: "khongcomanay" });
    },
    300_000
  );
});
