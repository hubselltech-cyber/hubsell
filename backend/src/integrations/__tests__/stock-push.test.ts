// ============================================================
// ĐỒNG BỘ TỒN KHO ĐA SÀN — 3 nhóm kiểm chứng:
//
//   1. CÔNG THỨC TỒN KHẢ DỤNG: available = max(0, tồn − hold − tồn an toàn);
//      safetyStock per-SKU đè lên mặc định toàn shop.
//   2. HÀNG ĐỢI ĐẨY TỒN: cờ Channel.stockSyncEnabled THEO GIAN gác ở cửa
//      enqueue (mặc định TẮT → biến động tự động không sinh job; force vẫn
//      qua); job GỘP theo (channelId, channelSku) — 10 biến động liên tiếp chỉ
//      còn 1 job và giữ nguyên oldAvailable của biến động đầu; channelIds
//      giới hạn job về đúng gian được chỉ định.
//   3. TRỪ KHO ĐƠN LAZADA (upsertLazadaOrderTx): unpaid → HOLD, pending →
//      TRỪ thật, canceled → hoàn; vòng quét 10' đẩy lại cùng đơn không trừ
//      trùng (idempotent nhờ mốc trên Order — dùng chung lõi order-stock).
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, StockPushStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { availableToPush, dropPendingStockPushJobs, enqueueStockPush, stockSyncOn } from "../inventory-push";
import { describeReconcile } from "../../workers/stock-reconcile";
import { upsertLazadaOrderTx } from "../lazada/service";
import type { LazadaOrder, LazadaOrderItem } from "../lazada/client";
import { createStockFixture, type StockFixture } from "./fixtures";

// ---------- 1. Công thức tồn khả dụng ----------

describe("availableToPush — công thức tồn khả dụng", () => {
  it("trừ đủ ba tầng: tồn − hold − tồn an toàn, chặn sàn 0", () => {
    const base = { quantityInStock: 10, holdQuantity: 3, safetyStock: null };
    expect(availableToPush(base, 0)).toBe(7); // không đặt tồn an toàn
    expect(availableToPush(base, 2)).toBe(5); // dùng mặc định toàn shop
    expect(availableToPush({ ...base, safetyStock: 6 }, 2)).toBe(1); // per-SKU đè mặc định
    expect(availableToPush({ ...base, safetyStock: 0 }, 2)).toBe(7); // per-SKU 0 ≠ null
    expect(availableToPush({ ...base, quantityInStock: 2 }, 5)).toBe(0); // âm → 0
  });
});

// ---------- 2. Hàng đợi đẩy tồn (switch + coalesce) ----------

describe("enqueueStockPush — switch autoSync + gộp job", () => {
  let fx: StockFixture;
  let productId: string;

  beforeAll(async () => {
    fx = await createStockFixture("stockpush");
    productId = await fx.createProduct(10);
    await fx.createMapping(productId, "123456");
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("mặc định TẮT: biến động tự động không sinh job; force vẫn qua", async () => {
    const auto = await enqueueStockPush([productId], { source: "test auto" });
    expect(auto.queued).toBe(0);

    const forced = await enqueueStockPush([productId], {
      source: "test force",
      force: true,
    });
    expect(forced.queued).toBe(1);

    const jobs = await prisma.stockPushJob.findMany({
      where: { channelId: fx.channelId },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].forced).toBe(true);
    // oldAvailable = tồn khả dụng lúc enqueue (10 − 0 hold − 0 an toàn).
    expect(jobs[0].oldAvailable).toBe(10);
    await prisma.stockPushJob.deleteMany({ where: { channelId: fx.channelId } });
  });

  it("không truyền nguồn: cột source để trống (câu ghi cả lô nhận tham số null)", async () => {
    expect((await enqueueStockPush([productId], { force: true })).queued).toBe(1);
    const jobs = await prisma.stockPushJob.findMany({ where: { channelId: fx.channelId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source: null, forced: true, status: StockPushStatus.PENDING });
    await prisma.stockPushJob.deleteMany({ where: { channelId: fx.channelId } });
  });

  it("bật đồng bộ GIAN: sinh job; nhiều biến động GỘP còn một job, giữ oldAvailable đầu", async () => {
    await prisma.channel.update({
      where: { id: fx.channelId },
      data: { stockSyncEnabled: true, stockSyncEnabledAt: new Date() },
    });

    // channelIds trỏ gian khác → không sinh job cho gian này.
    const elsewhere = await enqueueStockPush([productId], {
      source: "gian khác",
      channelIds: ["khong-ton-tai"],
    });
    expect(elsewhere.queued).toBe(0);

    const first = await enqueueStockPush([productId], { source: "biến động 1" });
    expect(first.queued).toBe(1);

    // Giả lập worker đã cầm job + kho biến động tiếp → enqueue phải reset về
    // PENDING (worker tôn trọng: không xóa job bị reset) và GIỮ oldAvailable cũ.
    await prisma.stockPushJob.updateMany({
      where: { channelId: fx.channelId },
      data: { status: StockPushStatus.RUNNING, attempts: 2 },
    });
    await prisma.product.update({
      where: { id: productId },
      data: { quantityInStock: 4 },
    });
    const second = await enqueueStockPush([productId], { source: "biến động 2" });
    expect(second.queued).toBe(1);

    const jobs = await prisma.stockPushJob.findMany({
      where: { channelId: fx.channelId },
    });
    expect(jobs).toHaveLength(1); // gộp — không đẻ job thứ hai
    expect(jobs[0].status).toBe(StockPushStatus.PENDING);
    expect(jobs[0].attempts).toBe(0);
    expect(jobs[0].source).toBe("biến động 2"); // ngữ cảnh mới nhất
    expect(jobs[0].oldAvailable).toBe(10); // snapshot TRƯỚC chuỗi biến động
  });
});

// ---------- 2b. Công tắc đồng bộ tồn theo PHÂN LOẠI (06/11/2026) ----------
// ChannelProduct.stockSyncEnabled: null = theo gian; true / false = khách đặt riêng. Cửa xếp việc
// (không force) chỉ nhận dòng đang bật; force (bật cả gian) bỏ qua mọi công tắc.

describe("công tắc đồng bộ tồn theo phân loại", () => {
  let fx: StockFixture;
  let productA: string;
  let productB: string;
  let skuA: string;
  let skuB: string;

  const setChannel = (on: boolean) => prisma.channel.update({ where: { id: fx.channelId }, data: { stockSyncEnabled: on } });
  const setVariant = (channelSku: string, on: boolean | null) =>
    prisma.channelProduct.update({ where: { channelId_channelSku: { channelId: fx.channelId, channelSku } }, data: { stockSyncEnabled: on } });
  const jobSkus = async () =>
    (await prisma.stockPushJob.findMany({ where: { channelId: fx.channelId }, select: { channelSku: true }, orderBy: { channelSku: "asc" } })).map((j) => j.channelSku);
  const clearJobs = () => prisma.stockPushJob.deleteMany({ where: { channelId: fx.channelId } });

  beforeAll(async () => {
    fx = await createStockFixture("variantsync");
    productA = await fx.createProduct(10);
    productB = await fx.createProduct(5);
    skuA = await fx.createMapping(productA, "555-1");
    skuB = await fx.createMapping(productB, "555-2");
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("stockSyncOn: công tắc riêng thắng gian; chưa đặt riêng thì theo gian", () => {
    expect(stockSyncOn({ stockSyncEnabled: null }, { stockSyncEnabled: false })).toBe(false);
    expect(stockSyncOn({ stockSyncEnabled: null }, { stockSyncEnabled: true })).toBe(true);
    expect(stockSyncOn({ stockSyncEnabled: true }, { stockSyncEnabled: false })).toBe(true);
    expect(stockSyncOn({ stockSyncEnabled: false }, { stockSyncEnabled: true })).toBe(false);
  });

  it("gian TẮT, bật riêng A: biến động tự động chỉ sinh job cho A", async () => {
    await setChannel(false);
    await setVariant(skuA, true);
    await setVariant(skuB, null);
    const r = await enqueueStockPush([productA, productB], { source: "test bật riêng" });
    expect(r.queued).toBe(1);
    expect(await jobSkus()).toEqual([skuA]);
    await clearJobs();
  });

  it("gian BẬT, tắt riêng A: chỉ B (theo gian) sinh job", async () => {
    await setChannel(true);
    await setVariant(skuA, false);
    await setVariant(skuB, null);
    const r = await enqueueStockPush([productA, productB], { source: "test tắt riêng" });
    expect(r.queued).toBe(1);
    expect(await jobSkus()).toEqual([skuB]);
    await clearJobs();
  });

  it("chưa đặt riêng dòng nào: y như trước — gian tắt 0 job, gian bật đủ job", async () => {
    await setVariant(skuA, null);
    await setVariant(skuB, null);
    await setChannel(false);
    expect((await enqueueStockPush([productA, productB], { source: "test" })).queued).toBe(0);
    await setChannel(true);
    expect((await enqueueStockPush([productA, productB], { source: "test" })).queued).toBe(2);
    await clearJobs();
  });

  it("force (bật cả gian) bỏ qua công tắc riêng", async () => {
    await setChannel(false);
    await setVariant(skuA, false);
    await setVariant(skuB, false);
    const r = await enqueueStockPush([productA, productB], { source: "test force", force: true, channelIds: [fx.channelId] });
    expect(r.queued).toBe(2);
    await clearJobs();
  });

  it("dropPendingStockPushJobs: rút mọi job đang chờ (cả forced) của ĐÚNG phân loại bị tắt riêng, không đụng phân loại khác", async () => {
    await setChannel(true);
    await setVariant(skuA, null);
    await setVariant(skuB, null);
    await enqueueStockPush([productA], { source: "forced A", force: true, channelIds: [fx.channelId] });
    await enqueueStockPush([productB], { source: "auto B" });
    expect(await jobSkus()).toEqual([skuA, skuB].sort());
    // Tắt riêng A (job forced của lượt bật cả gian) → rút; B không bị tắt → giữ.
    const dropped = await dropPendingStockPushJobs([{ channelId: fx.channelId, channelSku: skuA }]);
    expect(dropped).toBe(1);
    expect(await jobSkus()).toEqual([skuB]);
    // Job worker đang cầm (RUNNING) không bị giật khỏi tay worker — worker tự hủy ở cửa gác.
    await prisma.stockPushJob.updateMany({ where: { channelId: fx.channelId }, data: { status: StockPushStatus.RUNNING } });
    expect(await dropPendingStockPushJobs([{ channelId: fx.channelId, channelSku: skuB }])).toBe(0);
    await clearJobs();
  });

  it("describeReconcile: đẩy hết / không đẩy / đẩy một phần", () => {
    expect(describeReconcile("Shop A", 3, 10, 3)).toContain("đã tự đẩy lại số đúng");
    expect(describeReconcile("Shop A", 3, 10, 0)).toContain("đang TẮT đồng bộ nên không đẩy lại");
    const mixed = describeReconcile("Shop A", 3, 10, 2);
    expect(mixed).toContain("đẩy lại 2 SKU");
    expect(mixed).toContain("1 SKU đang tắt");
  });
});

// ---------- 3. Trừ kho đơn Lazada ----------

/** Đơn Lazada tối giản đủ cho upsertLazadaOrderTx. */
function lazadaOrder(orderNumber: string, status: string): LazadaOrder {
  return {
    order_id: Number(orderNumber.replace(/\D/g, "")) || 999,
    order_number: orderNumber,
    price: "200000",
    statuses: [status],
  } as LazadaOrder;
}

describe("upsertLazadaOrderTx — hold/trừ/hoàn kho theo trạng thái", () => {
  const SELLER_SKU = `TEST-LZDSTOCK-${Date.now()}`;
  let userId: string;
  let channelId: string;
  let productId: string;
  let items: LazadaOrderItem[];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-lzdstock-${Date.now()}@hubsell.test`,
        passwordHash: "x",
        fullName: "TEST lzd stock",
        role: "ADMIN",
      },
    });
    userId = user.id;
    const channel = await prisma.channel.create({
      data: {
        userId,
        channelName: ChannelName.LAZADA,
        shopName: `TEST-LZDSTOCK`,
        externalShopId: `8${Date.now()}`,
        refreshToken: "test-refresh-token",
        status: "ACTIVE",
      },
    });
    channelId = channel.id;
    const product = await prisma.product.create({
      data: {
        userId,
        skuCode: SELLER_SKU,
        productName: "SP test Lazada stock",
        quantityInStock: 10,
      },
    });
    productId = product.id;
    await prisma.channelProduct.create({
      data: {
        channelId,
        channelSku: SELLER_SKU,
        productName: "SP sàn Lazada test",
        productId,
        externalId: "111-222",
      },
    });
    // Khách mua 2 đơn vị = 2 dòng lặp cùng SellerSku (đặc thù Lazada).
    items = [
      { order_id: 1, sku: SELLER_SKU, paid_price: "100000", name: "SP" },
      { order_id: 1, sku: SELLER_SKU, paid_price: "100000", name: "SP" },
    ] as LazadaOrderItem[];
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  async function upsert(orderNumber: string, status: string) {
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
    });
    return prisma.$transaction((tx) =>
      upsertLazadaOrderTx(tx, channel, lazadaOrder(orderNumber, status), items)
    );
  }

  async function stockNow() {
    return prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { quantityInStock: true, holdQuantity: true },
    });
  }

  it("unpaid → HOLD (chưa trừ thật); chốt pending → nhả hold + trừ thật; đẩy lại không trừ trùng", async () => {
    const r1 = await upsert("TESTLZD100", "unpaid");
    expect(r1.created).toBe(true);
    expect(r1.stockSync?.productIds).toEqual([productId]);
    expect(await stockNow()).toEqual({ quantityInStock: 10, holdQuantity: 2 });

    const r2 = await upsert("TESTLZD100", "pending");
    expect(r2.stockSync?.productIds).toEqual([productId]);
    expect(await stockNow()).toEqual({ quantityInStock: 8, holdQuantity: 0 });

    // Vòng quét 10' đẩy lại y nguyên — mốc stockDeductedAt chặn trừ lần hai.
    const r3 = await upsert("TESTLZD100", "pending");
    expect(r3.stockSync).toBeUndefined();
    expect(await stockNow()).toEqual({ quantityInStock: 8, holdQuantity: 0 });
  });

  it("canceled → hoàn kho đúng một lần", async () => {
    const r1 = await upsert("TESTLZD100", "canceled");
    expect(r1.stockSync?.productIds).toEqual([productId]);
    expect(await stockNow()).toEqual({ quantityInStock: 10, holdQuantity: 0 });

    const r2 = await upsert("TESTLZD100", "canceled");
    expect(r2.stockSync).toBeUndefined();
    expect(await stockNow()).toEqual({ quantityInStock: 10, holdQuantity: 0 });
  });

  it("đơn giao thẳng (delivered) trừ ngay không cần qua hold", async () => {
    const r = await upsert("TESTLZD200", "delivered");
    expect(r.created).toBe(true);
    expect(await stockNow()).toEqual({ quantityInStock: 8, holdQuantity: 0 });
  });
});
