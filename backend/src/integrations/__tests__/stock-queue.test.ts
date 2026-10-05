// ============================================================
// ĐẨY TỒN — ĐƯỜNG HÀNG ĐỢI BỀN (giai đoạn 2 bước 4 — docs/HANG-DOI-BEN.md mục 4.5)
//
// Tầng gọi sàn (đẩy tồn, đọc tồn, lấy token) của
// CẢ BA sàn được mock — database dev có token thật, test không được chạm sàn.
// Bảng stock_push_jobs, hàng đợi stock.channel / stock.verify, bộ chạy theo gian
// là đồ thật (cần migration queue_foundation trên DB dev). Lưới quét được gọi tay
// (sweepStockChannels) thay cho bộ hẹn giờ.
//
//   1. Biến động kho → dòng chờ đẩy + tín hiệu → bộ chạy đẩy, xóa dòng, ghi nhật ký.
//   2. Ghi trong giao dịch: rollback mất cả dòng lẫn tín hiệu; commit có cả hai; ghi lần hai gộp.
//   3. Giao dịch gốc không bị kéo hỏng: gửi tín hiệu lỗi SQL → dòng vẫn giữ; ghi dòng lỗi SQL → ghi lại sau commit.
//   4. Sàn từ chối: dòng tự hẹn giờ thử lại; biến động mới vẫn đẩy ngay; lưới quét chạy lượt thử lại; hết 3 lượt → cảnh báo.
//   5. Lưới quét: dòng tới hạn không có tín hiệu, dòng kẹt RUNNING quá hạn thuê → được đẩy.
//   6. Gian đang có tiến trình khác đẩy (còn dòng RUNNING chưa quá hạn) → nhường, không đẩy chồng;
//      nhiều tiến trình cùng lúc xin nhận lô của một gian → đúng một bên được.
//   7. Hai gian chạy song song: gian chậm không chặn gian khác.
//   8. Dừng êm: xong dòng đang đẩy, dòng chưa đụng tới trả về hàng chờ.
//   9. Đơn sàn về: dòng chờ đẩy + tín hiệu đi chung giao dịch đơn.
//  10. Đối soát Shopee đi stock.verify: nhiều lượt đẩy gộp MỘT việc hẹn giờ; lệch thì
//      đẩy lại + hẹn lượt kế; hết 3 lượt → cảnh báo.
// (Bước 6b, 05/10/2026: đường lui STOCK_PUSH_MODE=legacy đã gỡ.)
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName, StockPushStatus, StockSyncStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import * as queue from "../../lib/queue";
import { createStockFixture, type StockFixture } from "./fixtures";

vi.mock("../lazada/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lazada/client")>();
  return {
    ...mod,
    updateLazadaSellableStock: vi.fn().mockResolvedValue(undefined),
    getOrder: vi.fn(),
    getMultipleOrderItems: vi.fn(),
  };
});
vi.mock("../lazada/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lazada/service")>();
  return { ...mod, getValidLazadaAccessToken: vi.fn().mockResolvedValue("test-token") };
});
vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return {
    ...mod,
    updateShopeeStock: vi.fn().mockResolvedValue(undefined),
    getItemBaseInfo: vi.fn().mockResolvedValue([]),
    getModelList: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("../shopee/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/service")>();
  return { ...mod, getValidShopeeAccessToken: vi.fn().mockResolvedValue({ accessToken: "test-token", shopId: "999" }) };
});
vi.mock("../tiktok/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/client")>();
  return { ...mod, updateTiktokInventory: vi.fn().mockResolvedValue(undefined), getWarehouses: vi.fn().mockResolvedValue([]) };
});
vi.mock("../tiktok/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/service")>();
  return { ...mod, getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: "test-token", shopCipher: "cipher" }) };
});

import { enqueueStockPush, finishStockPush, stageStockPush } from "../inventory-push";
import { getMultipleOrderItems, getOrder, updateLazadaSellableStock } from "../lazada/client";
import { processLazadaOrderPush } from "../lazada/webhook";
import { getItemBaseInfo, updateShopeeStock } from "../shopee/client";
import { runStockVerifyJob } from "../shopee/inventory-sync";
import { claimChannelBatch } from "../stock-push-worker";
import {
  registerStockQueueWorkers,
  resumeStockRunners,
  stopStockRunners,
  sweepStockChannels,
  whenStockRunnersIdle,
} from "../../workers/stock-queue";

const SHOPEE_ITEM_ID = 555002;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fx: StockFixture;
let lzdChannelId: string;
let shopeeChannelId: string;
let lzdProductId: string;
let lzdProductId2: string;
let shopeeProductId: string;
let lzdSku: string;
let lzdSku2: string;
let shopeeSku: string;

interface BossJob {
  state: string;
  key: string | null;
  data: { channelId?: string; attempt?: number; channelSku?: string };
  dueInS: number;
}

/** Việc pg-boss của một hàng đợi theo khóa (singleton_key). */
const jobsOf = (name: string, key: string) =>
  prisma.$queryRawUnsafe<BossJob[]>(
    `SELECT state::text AS state, singleton_key AS key, data,
            round(extract(epoch FROM (start_after - now())))::int AS "dueInS"
     FROM pgboss.job WHERE name = $1 AND singleton_key = $2 ORDER BY created_on`,
    name,
    key
  );

const rowsOf = (channelId: string) => prisma.stockPushJob.findMany({ where: { channelId }, orderBy: { channelSku: "asc" } });

async function waitFor<T>(what: string, read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 12_000;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > deadline) throw new Error(`Hết 12s chờ: ${what} — đang là ${JSON.stringify(v)}`);
    await sleep(100);
  }
}

async function restartQueue(role: "all" | "web"): Promise<void> {
  await queue.stopQueue(5000);
  expect(await queue.startQueue(role)).toBe(true);
  if (role === "all") await registerStockQueueWorkers();
}

/** Dòng chờ đẩy ghi thẳng vào bảng (không tín hiệu) — như dòng sót / dòng của đường cũ. */
const insertRow = (channelSku: string, productId: string, data: { status?: StockPushStatus; nextRetryAt?: Date; source?: string } = {}) =>
  prisma.stockPushJob.create({ data: { channelId: lzdChannelId, channelSku, productId, ...data } });

const lazadaCalls = () => vi.mocked(updateLazadaSellableStock).mock.calls.length;

beforeAll(async () => {
  fx = await createStockFixture("stockq");
  shopeeChannelId = fx.channelId;
  await prisma.channel.update({
    where: { id: shopeeChannelId },
    data: { stockSyncEnabled: true, stockSyncEnabledAt: new Date() },
  });
  const lzd = await prisma.channel.create({
    data: {
      userId: fx.userId,
      channelName: ChannelName.LAZADA,
      shopName: `TEST-LZD-${fx.suffix}`,
      externalShopId: `67${Date.now()}`,
      refreshToken: "test-refresh-token",
      status: "ACTIVE",
      stockSyncEnabled: true,
      stockSyncEnabledAt: new Date(),
    },
  });
  lzdChannelId = lzd.id;

  // Mỗi sản phẩm nối MỘT gian để từng mục kiểm đúng một gian.
  lzdProductId = await fx.createProduct(10);
  lzdSku = `TEST-${fx.suffix}-LZD-A`;
  await prisma.channelProduct.create({
    data: { channelId: lzdChannelId, channelSku: lzdSku, productName: "SP sàn Lazada test A", productId: lzdProductId, externalId: "111-222" },
  });
  lzdProductId2 = await fx.createProduct(20);
  lzdSku2 = `TEST-${fx.suffix}-LZD-B`;
  await prisma.channelProduct.create({
    data: { channelId: lzdChannelId, channelSku: lzdSku2, productName: "SP sàn Lazada test B", productId: lzdProductId2, externalId: "333-444" },
  });
  shopeeProductId = await fx.createProduct(5);
  shopeeSku = await fx.createMapping(shopeeProductId, String(SHOPEE_ITEM_ID));

  expect(await queue.startQueue("all"), "hàng đợi không khởi động — DB dev đã áp migration queue_foundation chưa?").toBe(true);
  await registerStockQueueWorkers();
});

afterAll(async () => {
  await stopStockRunners(5000);
  await queue.stopQueue(5000);
  await prisma.$executeRawUnsafe(
    `DELETE FROM pgboss.job WHERE name IN ('stock.channel', 'stock.verify', 'stock.dead') AND data->>'channelId' IN ($1, $2)`,
    lzdChannelId,
    shopeeChannelId
  );
  await fx.cleanup();
});

beforeEach(() => {
  vi.mocked(updateLazadaSellableStock).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(updateShopeeStock).mockReset().mockResolvedValue(undefined as never);
});

describe("Đẩy tồn — bộ chạy theo gian + tín hiệu stock.channel", () => {
  it("biến động kho → dòng chờ đẩy + tín hiệu → bộ chạy đẩy, xóa dòng, ghi nhật ký", async () => {
    const r = await enqueueStockPush([lzdProductId], { source: "test biến động" });
    expect(r.queued).toBe(1);

    await waitFor("dòng của gian Lazada được đẩy xong", () => rowsOf(lzdChannelId), (rows) => rows.length === 0);
    expect(lazadaCalls()).toBe(1);
    expect(vi.mocked(updateLazadaSellableStock)).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "111", skuId: "222", quantity: 10 })
    );
    const link = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: lzdChannelId, channelSku: lzdSku } });
    expect(link.channelStock).toBe(10);
    const log = await prisma.inventorySyncLog.findFirstOrThrow({ where: { channelId: lzdChannelId, channelSku: lzdSku } });
    expect(log.status).toBe(StockSyncStatus.SUCCESS);
    expect(log.message).toBe("test biến động");
    // Việc tín hiệu của gian đã xong (nó chỉ gọi bộ chạy rồi trả về).
    const jobs = await waitFor("việc tín hiệu xong", () => jobsOf("stock.channel", lzdChannelId), (j) => j.every((x) => x.state === "completed"));
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    await whenStockRunnersIdle();
  });

  it("ghi trong giao dịch: rollback mất cả dòng lẫn tín hiệu; commit có cả hai; ghi lần hai gộp vào tín hiệu đang chờ", async () => {
    // Vai web: chỉ gửi, không ai nhận — nhìn được dòng và việc đứng yên.
    await restartQueue("web");
    const created = async () => (await jobsOf("stock.channel", lzdChannelId)).filter((j) => j.state === "created");

    await prisma
      .$transaction(async (tx) => {
        const ticket = await stageStockPush(tx, [lzdProductId], { source: "giao dịch sẽ rollback" });
        expect(ticket.staged).toBe(true);
        expect(ticket.queued).toBe(1);
        throw new Error("ROLLBACK");
      })
      .catch((e: Error) => {
        if (e.message !== "ROLLBACK") throw e;
      });
    expect(await rowsOf(lzdChannelId)).toHaveLength(0);
    expect(await created()).toHaveLength(0);

    const ticket = await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: lzdProductId }, data: { quantityInStock: 8 } });
      return stageStockPush(tx, [lzdProductId], { source: "giao dịch commit", oldAvailable: { [lzdProductId]: 10 } });
    });
    expect(ticket.staged).toBe(true);
    expect(ticket.mergedChannelIds).toEqual([]); // tín hiệu do chính giao dịch tạo — không cần gửi lại
    expect(await finishStockPush(ticket)).toEqual({ queued: 1 });
    let rows = await rowsOf(lzdChannelId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: StockPushStatus.PENDING, attempts: 0, oldAvailable: 10, source: "giao dịch commit", forced: false });
    expect(Math.abs(rows[0].nextRetryAt.getTime() - Date.now())).toBeLessThan(60_000); // không lệch múi giờ
    expect(await created()).toHaveLength(1);

    // Biến động kế tiếp của cùng SKU: vẫn một dòng (giữ "số cũ" đầu chuỗi), vẫn một việc chờ.
    const second = await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: lzdProductId }, data: { quantityInStock: 7 } });
      return stageStockPush(tx, [lzdProductId], { source: "biến động 2", oldAvailable: { [lzdProductId]: 8 } });
    });
    rows = await rowsOf(lzdChannelId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ oldAvailable: 10, source: "biến động 2" });
    expect(await created()).toHaveLength(1);
    // Bị gộp vào tín hiệu có sẵn: tín hiệu ấy có thể đã được xử lý trước khi giao
    // dịch này commit, nên phần chốt sau commit gửi lại một tín hiệu (ngoài giao dịch).
    expect(second.mergedChannelIds).toEqual([lzdChannelId]);
    const sendSpy = vi.spyOn(queue, "enqueue");
    await finishStockPush(second);
    const resent = sendSpy.mock.calls.filter(([name, , opts]) => name === queue.QUEUES.stockChannel && !opts?.tx);
    sendSpy.mockRestore();
    expect(resent).toHaveLength(1);
    expect(await created()).toHaveLength(1);

    // Bật lại worker: tín hiệu đang chờ gọi bộ chạy, đẩy đúng số MỚI NHẤT.
    await restartQueue("all");
    await waitFor("dòng được đẩy sau khi worker lên", () => rowsOf(lzdChannelId), (r) => r.length === 0);
    expect(vi.mocked(updateLazadaSellableStock)).toHaveBeenCalledWith(expect.objectContaining({ quantity: 7 }));
    await whenStockRunnersIdle();
  });

  it("giao dịch gốc không bị kéo hỏng: gửi tín hiệu lỗi SQL → dòng vẫn giữ; ghi dòng lỗi SQL → ghi lại sau commit", async () => {
    await restartQueue("web");
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'stock.channel' AND data->>'channelId' = $1`, lzdChannelId);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // (a) Tín hiệu trong giao dịch chạy một câu SQL hỏng — giao dịch Postgres rơi vào
    //     trạng thái lỗi, chỉ ROLLBACK TO SAVEPOINT mới cứu được. Dòng đã ghi phải còn.
    const spy = vi.spyOn(queue, "enqueue").mockImplementationOnce(async (_name, _data, opts) => {
      await opts!.tx!.$executeRawUnsafe("SELECT 1/0");
      return { queued: true, id: null };
    });
    const ticket = await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: lzdProductId }, data: { quantityInStock: 6 } });
      const t = await stageStockPush(tx, [lzdProductId], { source: "tín hiệu lỗi trong giao dịch" });
      // Giao dịch còn dùng được sau khi lùi về savepoint.
      await tx.product.update({ where: { id: lzdProductId }, data: { holdQuantity: 1 } });
      return t;
    });
    spy.mockRestore();
    expect(ticket.staged).toBe(true);
    expect(ticket.mergedChannelIds).toEqual([lzdChannelId]); // sẽ gửi lại sau commit
    expect(await prisma.product.findUniqueOrThrow({ where: { id: lzdProductId } })).toMatchObject({ quantityInStock: 6, holdQuantity: 1 });
    expect(await rowsOf(lzdChannelId)).toHaveLength(1);
    expect(await jobsOf("stock.channel", lzdChannelId)).toHaveLength(0);
    await finishStockPush(ticket);
    expect((await jobsOf("stock.channel", lzdChannelId)).filter((j) => j.state === "created")).toHaveLength(1);

    // (b) Ghi dòng lỗi SQL (ký tự NUL không ghi được vào cột chữ): lùi savepoint,
    //     giao dịch gốc vẫn commit, phiếu ở trạng thái "chưa ghi".
    const broken = await prisma.$transaction(async (tx) => {
      const t = await stageStockPush(tx, [lzdProductId2], { source: "nguồn hỏng \u0000" });
      await tx.product.update({ where: { id: lzdProductId2 }, data: { quantityInStock: 19 } });
      return t;
    });
    expect(broken.staged).toBe(false);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: lzdProductId2 } })).quantityInStock).toBe(19);
    expect((await rowsOf(lzdChannelId)).map((r) => r.channelSku)).toEqual([lzdSku]);
    // Chốt sau commit ghi lại ngoài giao dịch (ở đây dùng nguồn lành để ghi được).
    expect(await finishStockPush({ ...broken, opts: { source: "ghi lại sau commit" } })).toEqual({ queued: 1 });
    errorLog.mockRestore();
    expect((await rowsOf(lzdChannelId)).map((r) => r.channelSku)).toEqual([lzdSku, lzdSku2]);

    await restartQueue("all");
    await waitFor("hai dòng được đẩy", () => rowsOf(lzdChannelId), (r) => r.length === 0);
    expect(vi.mocked(updateLazadaSellableStock)).toHaveBeenCalledWith(expect.objectContaining({ skuId: "222", quantity: 5 })); // 6 − 1 giữ
    expect(vi.mocked(updateLazadaSellableStock)).toHaveBeenCalledWith(expect.objectContaining({ skuId: "444", quantity: 19 }));
    await prisma.product.update({ where: { id: lzdProductId }, data: { holdQuantity: 0 } });
    await whenStockRunnersIdle();
  });

  it("sàn từ chối: dòng tự hẹn giờ thử lại; biến động mới vẫn đẩy ngay; lưới quét chạy lượt thử lại; hết 3 lượt → cảnh báo", async () => {
    vi.mocked(updateLazadaSellableStock).mockRejectedValue(new Error("Lazada 901 giả lập"));
    await enqueueStockPush([lzdProductId], { source: "test sàn lỗi" });

    const [row] = await waitFor("dòng hỏng lượt 1", () => rowsOf(lzdChannelId), (r) => r.length === 1 && r[0].attempts === 1 && r[0].status === StockPushStatus.PENDING);
    expect(row.lastError).toContain("Lazada 901 giả lập");
    expect(row.nextRetryAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await whenStockRunnersIdle();

    // Chưa tới giờ thử lại: lưới quét không đụng tới dòng.
    const before = lazadaCalls();
    await sweepStockChannels();
    await whenStockRunnersIdle();
    expect(lazadaCalls()).toBe(before);

    // Biến động mới trong lúc dòng chờ thử lại: đẩy ngay, không đợi giờ hẹn.
    await enqueueStockPush([lzdProductId], { source: "biến động mới giữa lúc chờ" });
    await waitFor("lượt đẩy ngay", async () => lazadaCalls(), (n) => n === before + 1);
    await waitFor("dòng hỏng lại lượt 1 (enqueue mới đặt lại số lượt)", () => rowsOf(lzdChannelId), (r) => r.length === 1 && r[0].attempts === 1 && r[0].status === StockPushStatus.PENDING);
    await whenStockRunnersIdle();

    // Hai lượt thử lại: tới giờ thì lưới quét gọi bộ chạy.
    const makeDue = () => prisma.stockPushJob.updateMany({ where: { channelId: lzdChannelId }, data: { nextRetryAt: new Date(Date.now() - 1000) } });
    await makeDue();
    expect(await sweepStockChannels()).toBeGreaterThanOrEqual(1);
    await whenStockRunnersIdle();
    expect((await rowsOf(lzdChannelId))[0].attempts).toBe(2);
    await makeDue();
    await sweepStockChannels();
    await whenStockRunnersIdle();

    expect(await rowsOf(lzdChannelId)).toHaveLength(0);
    const alert = await prisma.inventorySyncAlert.findFirst({ where: { channelId: lzdChannelId, channelSku: lzdSku, resolvedAt: null } });
    expect(alert).not.toBeNull();
    const failedLog = await prisma.inventorySyncLog.findFirst({ where: { channelId: lzdChannelId, status: StockSyncStatus.FAILED } });
    expect(failedLog?.message).toContain("sau 3 lần thử");
  });

  it("lưới quét: dòng tới hạn không có tín hiệu và dòng kẹt RUNNING quá hạn thuê đều được đẩy", async () => {
    await insertRow(lzdSku, lzdProductId, { source: "dòng sót", nextRetryAt: new Date(Date.now() - 60_000) });
    expect(await sweepStockChannels()).toBeGreaterThanOrEqual(1);
    await whenStockRunnersIdle();
    expect(await rowsOf(lzdChannelId)).toHaveLength(0);
    expect(lazadaCalls()).toBe(1);

    // Dòng bị một tiến trình đã chết cầm (RUNNING) lâu hơn hạn thuê.
    const stuck = await insertRow(lzdSku, lzdProductId, { source: "dòng kẹt", status: StockPushStatus.RUNNING });
    await prisma.$executeRawUnsafe(
      `UPDATE "stock_push_jobs" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes' WHERE "id" = $1`,
      stuck.id
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await sweepStockChannels()).toBeGreaterThanOrEqual(1);
    await whenStockRunnersIdle();
    warn.mockRestore();
    expect(await rowsOf(lzdChannelId)).toHaveLength(0);
    expect(lazadaCalls()).toBe(2);
  });

  it("gian đang có tiến trình khác đẩy (còn dòng RUNNING chưa quá hạn thuê) → nhường, không đẩy chồng", async () => {
    // Giả lập tiến trình khác đang giữa lô: một dòng RUNNING mới tinh + một dòng khác tới hạn.
    const held = await insertRow(lzdSku, lzdProductId, { source: "tiến trình khác đang đẩy", status: StockPushStatus.RUNNING });
    await insertRow(lzdSku2, lzdProductId2, { source: "dòng chờ", nextRetryAt: new Date(Date.now() - 1000) });
    await sweepStockChannels();
    await whenStockRunnersIdle();
    expect(lazadaCalls()).toBe(0);
    expect((await rowsOf(lzdChannelId)).map((r) => r.status)).toEqual([StockPushStatus.RUNNING, StockPushStatus.PENDING]);

    // Tiến trình kia xong lô (dòng của nó biến mất) → lượt kế nhận được dòng chờ.
    await prisma.stockPushJob.delete({ where: { id: held.id } });
    await sweepStockChannels();
    await whenStockRunnersIdle();
    expect(await rowsOf(lzdChannelId)).toHaveLength(0);
    expect(lazadaCalls()).toBe(1);
    expect(vi.mocked(updateLazadaSellableStock)).toHaveBeenCalledWith(expect.objectContaining({ skuId: "444" }));
  });

  it("hai tiến trình cùng lúc xin nhận lô của một gian: đúng một bên được, bên kia về tay không", async () => {
    await insertRow(lzdSku, lzdProductId, { nextRetryAt: new Date(Date.now() - 2000) });
    await insertRow(lzdSku2, lzdProductId2, { nextRetryAt: new Date(Date.now() - 1000) });
    const results = await Promise.all([1, 2, 3, 4].map(() => claimChannelBatch(lzdChannelId)));
    expect(results.map((r) => r.length).sort()).toEqual([0, 0, 0, 2]);
    expect((await rowsOf(lzdChannelId)).every((r) => r.status === StockPushStatus.RUNNING)).toBe(true);
    await prisma.stockPushJob.deleteMany({ where: { channelId: lzdChannelId } });
  });

  it("hai gian chạy song song: gian đang chờ sàn trả lời không chặn gian khác", async () => {
    let releaseLazada: () => void = () => undefined;
    const lazadaGate = new Promise<void>((resolve) => (releaseLazada = resolve));
    vi.mocked(updateLazadaSellableStock).mockImplementation(async () => {
      await lazadaGate; // sàn Lazada "treo" cho tới khi test mở cổng
    });
    await enqueueStockPush([lzdProductId], { source: "gian chậm" });
    await waitFor("gian Lazada đang giữa lệnh gọi sàn", async () => lazadaCalls(), (n) => n === 1);

    await enqueueStockPush([shopeeProductId], { source: "gian khác" });
    await waitFor("gian Shopee đẩy xong trong lúc Lazada còn treo", () => rowsOf(shopeeChannelId), (r) => r.length === 0);
    expect(vi.mocked(updateShopeeStock)).toHaveBeenCalledTimes(1);
    expect((await rowsOf(lzdChannelId))[0].status).toBe(StockPushStatus.RUNNING);

    releaseLazada();
    await waitFor("gian Lazada xong", () => rowsOf(lzdChannelId), (r) => r.length === 0);
    await whenStockRunnersIdle();
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'stock.verify' AND data->>'channelId' = $1`, shopeeChannelId);
  });

  it("dừng êm lúc deploy: xong dòng đang đẩy, dòng chưa đụng tới trả về hàng chờ", async () => {
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    vi.mocked(updateLazadaSellableStock).mockImplementationOnce(async () => {
      await gate;
    });
    await insertRow(lzdSku, lzdProductId, { source: "dòng 1", nextRetryAt: new Date(Date.now() - 2000) });
    await insertRow(lzdSku2, lzdProductId2, { source: "dòng 2", nextRetryAt: new Date(Date.now() - 1000) });
    await sweepStockChannels();
    await waitFor("dòng 1 đang giữa lệnh gọi sàn", async () => lazadaCalls(), (n) => n === 1);

    const stopped = stopStockRunners(5000);
    releaseFirst();
    await stopped;
    expect(lazadaCalls()).toBe(1); // dòng 2 không được đẩy
    const rows = await rowsOf(lzdChannelId);
    expect(rows.map((r) => [r.channelSku, r.status])).toEqual([[lzdSku2, StockPushStatus.PENDING]]);

    // Bản mới lên: lưới quét nhặt dòng còn lại.
    resumeStockRunners();
    await sweepStockChannels();
    await whenStockRunnersIdle();
    expect(await rowsOf(lzdChannelId)).toHaveLength(0);
    expect(lazadaCalls()).toBe(2);
  });

  it("đơn sàn về: trừ kho + dòng chờ đẩy chung giao dịch đơn → gian đã nối nhận số mới, nhật ký ghi đúng nguồn và số cũ", async () => {
    await prisma.product.update({ where: { id: lzdProductId }, data: { quantityInStock: 10, holdQuantity: 0 } });
    await prisma.inventorySyncLog.deleteMany({ where: { channelId: lzdChannelId } });
    const orderId = `77${Date.now()}`;
    vi.mocked(getOrder).mockResolvedValue({ order_id: Number(orderId), order_number: orderId, price: "200000", statuses: ["pending"] } as never);
    vi.mocked(getMultipleOrderItems).mockResolvedValue(
      new Map([
        [
          orderId,
          [
            { order_id: Number(orderId), sku: lzdSku, paid_price: "100000", name: "SP" },
            { order_id: Number(orderId), sku: lzdSku, paid_price: "100000", name: "SP" },
          ],
        ],
      ]) as never
    );
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: lzdChannelId } });
    const sendSpy = vi.spyOn(queue, "enqueue");
    await processLazadaOrderPush(channel, orderId);
    // Tín hiệu stock.channel được gửi QUA giao dịch đơn (có tx), không phải sau commit.
    const sentInTx = sendSpy.mock.calls.filter(([name, , opts]) => name === queue.QUEUES.stockChannel && opts?.tx);
    sendSpy.mockRestore();
    expect(sentInTx).toHaveLength(1);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: lzdProductId } })).quantityInStock).toBe(8);
    await waitFor("gian nhận số mới", () => rowsOf(lzdChannelId), (r) => r.length === 0);
    expect(vi.mocked(updateLazadaSellableStock)).toHaveBeenCalledWith(expect.objectContaining({ quantity: 8 }));
    const log = await prisma.inventorySyncLog.findFirstOrThrow({ where: { channelId: lzdChannelId, status: StockSyncStatus.SUCCESS } });
    expect(log).toMatchObject({ oldQuantity: 10, newQuantity: 8, message: `webhook Lazada đơn ${orderId}` });
    await whenStockRunnersIdle();
  });

  it("hàng đợi chưa sẵn sàng: dòng vẫn ghi trong giao dịch, lưới quét đẩy — không cần pg-boss", async () => {
    await queue.stopQueue(5000);
    const ticket = await prisma.$transaction((tx) => stageStockPush(tx, [lzdProductId], { source: "không có hàng đợi" }));
    expect(ticket.staged).toBe(true);
    expect(ticket.mergedChannelIds).toEqual([lzdChannelId]);
    await finishStockPush(ticket); // không gửi được tín hiệu, không ném
    expect(await rowsOf(lzdChannelId)).toHaveLength(1);
    await sweepStockChannels();
    await whenStockRunnersIdle();
    expect(await rowsOf(lzdChannelId)).toHaveLength(0);
    expect(lazadaCalls()).toBe(1);
    await restartQueue("all");
  });
});

describe("Đối soát tồn Shopee qua stock.verify", () => {
  const verifyKey = () => `${shopeeChannelId}:${shopeeSku}`;
  const marketplaceStockIs = (stock: number) =>
    vi.mocked(getItemBaseInfo).mockResolvedValue([{ item_id: SHOPEE_ITEM_ID, stock_info_v2: { seller_stock: [{ stock }] } }] as never);
  const payload = () => ({
    kind: "stock-verify" as const,
    channelId: shopeeChannelId,
    channelSku: shopeeSku,
    productId: shopeeProductId,
    itemId: SHOPEE_ITEM_ID,
  });

  it("đẩy Shopee xong → MỘT việc hẹn giờ ~3 phút; đẩy lại → vẫn một việc, giờ hẹn được dời", async () => {
    await enqueueStockPush([shopeeProductId], { source: "test đẩy Shopee" });
    await waitFor("dòng Shopee được đẩy", () => rowsOf(shopeeChannelId), (r) => r.length === 0);
    expect(vi.mocked(updateShopeeStock)).toHaveBeenCalledWith("test-token", "999", SHOPEE_ITEM_ID, 5, undefined, null);

    const [first] = await waitFor("việc đối soát", () => jobsOf("stock.verify", verifyKey()), (j) => j.length === 1);
    expect(first.state).toBe("created");
    expect(first.data).toMatchObject({ kind: "stock-verify", channelSku: shopeeSku, attempt: 1 });
    expect(first.dueInS).toBeGreaterThan(170);
    expect(first.dueInS).toBeLessThanOrEqual(180);
    await whenStockRunnersIdle();

    // Cho giờ hẹn cũ trôi bớt rồi đẩy lần hai: việc cũ được dời về đủ 3 phút, không sinh việc thứ hai.
    await prisma.$executeRawUnsafe(
      `UPDATE pgboss.job SET start_after = start_after - interval '100 seconds' WHERE name = 'stock.verify' AND singleton_key = $1`,
      verifyKey()
    );
    await enqueueStockPush([shopeeProductId], { source: "test đẩy Shopee lần 2" });
    await waitFor("dòng Shopee lần 2 được đẩy", () => rowsOf(shopeeChannelId), (r) => r.length === 0);
    const jobs = await waitFor("việc đối soát được dời", () => jobsOf("stock.verify", verifyKey()), (j) => j.length === 1 && j[0].dueInS > 170);
    expect(jobs).toHaveLength(1);
    await whenStockRunnersIdle();
  });

  it("khớp → xong, không đẩy lại, không hẹn thêm; lệch → đẩy lại số đúng + hẹn lượt kế", async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'stock.verify' AND singleton_key = $1`, verifyKey());
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    marketplaceStockIs(5);
    await runStockVerifyJob({ ...payload(), attempt: 1 });
    log.mockRestore();
    expect(vi.mocked(updateShopeeStock)).not.toHaveBeenCalled();
    expect(await jobsOf("stock.verify", verifyKey())).toHaveLength(0);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    marketplaceStockIs(3);
    await runStockVerifyJob({ ...payload(), attempt: 1 });
    warn.mockRestore();
    expect(vi.mocked(updateShopeeStock)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateShopeeStock)).toHaveBeenCalledWith("test-token", "999", SHOPEE_ITEM_ID, 5, undefined, null);
    const [next] = await jobsOf("stock.verify", verifyKey());
    expect(next.data.attempt).toBe(2);
    expect(next.dueInS).toBeGreaterThan(170);
  });

  it("hết 3 lượt vẫn lệch → cảnh báo cho chủ shop, không hẹn thêm", async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'stock.verify' AND singleton_key = $1`, verifyKey());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    marketplaceStockIs(3);
    await runStockVerifyJob({ ...payload(), attempt: 3 });
    warn.mockRestore();
    expect(await jobsOf("stock.verify", verifyKey())).toHaveLength(0);
    const alert = await prisma.inventorySyncAlert.findFirst({ where: { channelId: shopeeChannelId, channelSku: shopeeSku, resolvedAt: null } });
    expect(alert).not.toBeNull();
    const [plain, detail] = alert!.message.split("\n");
    expect(plain).toContain("Đẩy lại");
    expect(detail).toContain("đối soát 3 lượt vẫn chưa khớp");
  });
});
