// Hộp "Sửa sản phẩm" ở Tổng kho (18/11/2026) — phần ghi DB: đổi tên cả mẫu, đổi chéo mã, thêm phân
// loại qua sổ kho, chặn gộp mẫu / trùng mã. Chạy trên DB dev, tự dọn.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { productGroupKey } from "../../lib/product-group";
import { loadProductGroup, ProductGroupEditError, saveProductGroup } from "../product-group-edit";

const stamp = Date.now();
const sku = (s: string) => `TEST-${s}-${stamp}`;
const NAME = `TEST Áo sửa mẫu ${stamp}`;
const OTHER_NAME = `TEST Váy mẫu khác ${stamp}`;
let userId = "";
let strangerId = "";
let idM = "";
let idL = "";
let idSingle = "";
let otherBarcode = "";
let channelId = "";

async function mk(owner: string, code: string, name: string, variant: string | null, qty = 0) {
  const p = await prisma.product.create({
    data: {
      userId: owner,
      skuCode: code,
      productName: name,
      variantName: variant,
      groupKey: productGroupKey(name, variant),
      sellingPrice: 100_000,
      costPrice: 40_000,
      quantityInStock: qty,
      imageUrl: variant === "M" ? "https://example.test/ao.jpg" : null,
    },
    select: { id: true, barcode: true },
  });
  return p;
}

const save = (productId: string, body: unknown, allowCost = true) =>
  saveProductGroup({ ownerId: userId, actorId: userId, productId, body, allowCost });
async function rejects(productId: string, body: unknown): Promise<ProductGroupEditError> {
  try {
    await save(productId, body);
  } catch (err) {
    if (err instanceof ProductGroupEditError) return err;
    throw err;
  }
  throw new Error("đáng lẽ phải báo lỗi");
}

describe("saveProductGroup", () => {
  beforeAll(async () => {
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: { email: `test-group-edit-${tag}-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      });
    userId = (await mkUser("a")).id;
    strangerId = (await mkUser("b")).id;
    idM = (await mk(userId, sku("AO-M"), NAME, "M", 7)).id;
    idL = (await mk(userId, sku("AO-L"), NAME, "L", 3)).id;
    idSingle = (await mk(userId, sku("COC"), `TEST Cốc ${stamp}`, null)).id;
    const other = await mk(userId, sku("VAY-S"), OTHER_NAME, "S");
    await mk(userId, sku("VAY-M"), OTHER_NAME, "M");
    otherBarcode = other.barcode!;
    // Shop khác có mẫu trùng tên + mã trùng — không được ảnh hưởng, không được chặn.
    await mk(strangerId, sku("AO-XL"), NAME, "XL");
    channelId = (
      await prisma.channel.create({
        data: { userId, channelName: ChannelName.SHOPEE, shopName: `TEST-SUA-${stamp}`, externalShopId: `41${stamp}`, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    // Đơn thử của ca giá vốn: xóa đơn rồi quét luôn dòng sổ cái của chủ shop thử (sổ không có khóa ngoại tới đơn).
    await prisma.orderItem.deleteMany({ where: { order: { channelId } } });
    await prisma.order.deleteMany({ where: { channelId } });
    await prisma.$executeRaw`DELETE FROM "order_line_ledger" WHERE "ownerId" = ${userId}`;
    await prisma.$executeRaw`DELETE FROM "order_ledger" WHERE "ownerId" = ${userId}`;
    await prisma.channelProduct.deleteMany({ where: { channelId } });
    await prisma.channel.deleteMany({ where: { id: channelId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  it("đọc mẫu: đủ phân loại của shop mình, xếp theo phân loại, không lẫn shop khác", async () => {
    const d = await loadProductGroup(userId, idL);
    expect(d?.productName).toBe(NAME);
    expect(d?.anchorId).toBe(idL);
    expect(d?.variants.map((v) => v.variantName)).toEqual(["L", "M"]);
    expect(d?.imageUrl).toBe("https://example.test/ao.jpg");
    expect(await loadProductGroup(strangerId, idL)).toBeNull();
  });

  it("đổi tên → mọi phân loại cùng đổi tên + khóa gom, tồn giữ nguyên", async () => {
    const renamed = `${NAME} bản mới`;
    const d = await save(idM, { productName: renamed });
    expect(d?.variants).toHaveLength(2);
    const rows = await prisma.product.findMany({ where: { id: { in: [idM, idL] } }, orderBy: { skuCode: "asc" } });
    expect(rows.map((r) => r.productName)).toEqual([renamed, renamed]);
    expect(new Set(rows.map((r) => r.groupKey))).toEqual(new Set([productGroupKey(renamed, "x")]));
    expect(rows.map((r) => r.quantityInStock).sort()).toEqual([3, 7]);
    await save(idM, { productName: NAME });
  });

  it("đổi tên trùng một mẫu khác của shop → 409, không ghi gì", async () => {
    const e = await rejects(idM, { productName: OTHER_NAME });
    expect(e.status).toBe(409);
    expect(e.message).toContain("gộp làm một");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: idM } })).productName).toBe(NAME);
  });

  it("đổi chéo mã SKU giữa hai phân loại trong một lần lưu", async () => {
    await save(idM, {
      productName: NAME,
      variants: [
        { id: idM, skuCode: sku("AO-L") },
        { id: idL, skuCode: sku("AO-M") },
      ],
    });
    const m = await prisma.product.findUniqueOrThrow({ where: { id: idM } });
    const l = await prisma.product.findUniqueOrThrow({ where: { id: idL } });
    expect([m.skuCode, l.skuCode]).toEqual([sku("AO-L"), sku("AO-M")]);
    // Đổi nối đuôi: L nhả mã cho M, L sang mã mới.
    await save(idM, {
      productName: NAME,
      variants: [
        { id: idM, skuCode: sku("AO-M") },
        { id: idL, skuCode: sku("AO-L") },
      ],
    });
  });

  it("mã mới trùng mã SKU / mã vạch của sản phẩm khác trong shop → 409; trùng với shop khác thì không sao", async () => {
    const bySku = await rejects(idM, { productName: NAME, variants: [{ id: idM, skuCode: sku("VAY-S") }] });
    expect(bySku.status).toBe(409);
    expect(bySku.message).toContain("đã có trong Tổng kho");
    const byBarcode = await rejects(idM, { productName: NAME, added: [{ skuCode: otherBarcode, variantName: "XS", sellingPrice: 1 }] });
    expect(byBarcode.status).toBe(409);
    expect(byBarcode.message).toContain("mã vạch");
    // sku("AO-XL") đang là mã của shop khác — shop mình vẫn dùng được.
    const d = await save(idM, { productName: NAME, added: [{ skuCode: sku("AO-XL"), variantName: "XL", sellingPrice: 110_000 }] });
    expect(d?.variants.map((v) => v.variantName)).toEqual(["L", "M", "XL"]);
  });

  it("thêm phân loại: vào đúng mẫu, có mã vạch, kế thừa ảnh, tồn ban đầu đi qua sổ kho", async () => {
    await save(idL, {
      productName: NAME,
      added: [{ skuCode: sku("AO-XXL").toLowerCase(), variantName: "XXL", sellingPrice: 130_000, costPrice: 60_000, stock: 5 }],
    });
    const created = await prisma.product.findUniqueOrThrow({
      where: { userId_skuCode: { userId, skuCode: sku("AO-XXL") } },
      include: { inventoryLogs: true },
    });
    expect(created).toMatchObject({ productName: NAME, variantName: "XXL", groupKey: productGroupKey(NAME, "x"), quantityInStock: 5, isActive: true });
    expect(Number(created.costPrice)).toBe(60_000);
    expect(created.barcode).toMatch(/^2\d{12}$/);
    expect(created.imageUrl).toBe("https://example.test/ao.jpg");
    expect(created.inventoryLogs).toHaveLength(1);
    expect(created.inventoryLogs[0]).toMatchObject({ changeQuantity: 5, type: "IMPORT", reason: "Tồn ban đầu khi thêm phân loại" });
  });

  it("người không thấy tài chính thêm phân loại → giá vốn 0 dù gửi số", async () => {
    await save(idL, { productName: NAME, added: [{ skuCode: sku("AO-3XL"), variantName: "3XL", sellingPrice: 1, costPrice: 99_000 }] }, false);
    const p = await prisma.product.findUniqueOrThrow({ where: { userId_skuCode: { userId, skuCode: sku("AO-3XL") } } });
    expect(Number(p.costPrice)).toBe(0);
  });

  it("đổi giá vốn: ghi giá mặc định ở kho, vá đơn cũ còn 0, đơn cũ đã có giá giữ nguyên, dòng không đổi không bị đụng", async () => {
    const order = (code: string, productId: string, costPriceAtSale: number) =>
      prisma.order.create({
        data: {
          channelId,
          orderCode: `TEST-SUA-${stamp}-${code}`,
          customerName: "Khách test",
          itemCount: 1,
          items: { create: { channelSku: code, productId, productName: code, quantity: 1, price: 100_000, costPriceAtSale } },
        },
        select: { items: { select: { id: true } } },
      });
    const lineZero = (await order("chua-gia", idM, 0)).items[0].id;
    const lineFrozen = (await order("da-co-gia", idM, 33_000)).items[0].id;
    const costAtSale = async (id: string) => Number((await prisma.orderItem.findUniqueOrThrow({ where: { id } })).costPriceAtSale);

    const d = await save(idM, { productName: NAME, variants: [{ id: idM, costPrice: 52_000 }] });
    expect(d?.backfilledOrderLines).toBe(1);
    expect(d?.variants.find((v) => v.id === idM)?.costPrice).toBe(52_000);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: idM } })).costPrice)).toBe(52_000);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: idL } })).costPrice)).toBe(40_000);
    expect(await costAtSale(lineZero)).toBe(52_000);
    expect(await costAtSale(lineFrozen)).toBe(33_000);

    // Sửa giá lần nữa: dòng vừa vá đã là ảnh chụp có số → đóng băng như mọi đơn cũ khác.
    const again = await save(idM, { productName: NAME, variants: [{ id: idM, costPrice: 60_000 }] });
    expect(again?.backfilledOrderLines).toBe(0);
    expect(await costAtSale(lineZero)).toBe(52_000);
  });

  it("đếm SKU sàn đang có giá vốn riêng của gian (giá riêng thắng giá kho)", async () => {
    const mkCp = (code: string, costPrice?: number) =>
      prisma.channelProduct.create({ data: { channelId, channelSku: `${code}-${stamp}`, productName: code, productId: idL, costPrice } });
    await mkCp("GIA-RIENG", 45_000);
    await mkCp("THEO-KHO");
    const l = (await loadProductGroup(userId, idL))?.variants.find((v) => v.id === idL);
    expect(l).toMatchObject({ linkedChannels: 2, ownCostChannels: 1 });
  });

  it("người không thấy tài chính đổi giá vốn → 403, không ghi gì (kể cả tên gửi kèm)", async () => {
    const before = Number((await prisma.product.findUniqueOrThrow({ where: { id: idL } })).costPrice);
    let caught: unknown = null;
    try {
      await save(idL, { productName: `${NAME} lén`, variants: [{ id: idL, costPrice: 1 }] }, false);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductGroupEditError);
    expect((caught as ProductGroupEditError).status).toBe(403);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: idL } });
    expect(Number(after.costPrice)).toBe(before);
    expect(after.productName).toBe(NAME);
  });

  it("sản phẩm đơn → đặt phân loại + thêm phân loại thành mẫu cha–con", async () => {
    const name = `TEST Cốc ${stamp}`;
    const d = await save(idSingle, {
      productName: name,
      variants: [{ id: idSingle, variantName: "Trắng" }],
      added: [{ skuCode: sku("COC-XANH"), variantName: "Xanh", sellingPrice: 45_000 }],
    });
    expect(d?.variants.map((v) => v.variantName)).toEqual(["Trắng", "Xanh"]);
    const rows = await prisma.product.findMany({ where: { userId, groupKey: productGroupKey(name, "x") } });
    expect(rows).toHaveLength(2);
  });

  it("lỗi giữa chừng không để lại ghi dở (tên không đổi khi mã trùng)", async () => {
    const e = await rejects(idM, { productName: `${NAME} dở`, variants: [{ id: idM, skuCode: sku("VAY-M") }] });
    expect(e.status).toBe(409);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: idL } })).productName).toBe(NAME);
  });

  it("sản phẩm không thuộc shop → null", async () => {
    expect(await saveProductGroup({ ownerId: strangerId, actorId: strangerId, productId: idM, body: { productName: "x" }, allowCost: true })).toBeNull();
  });
});
