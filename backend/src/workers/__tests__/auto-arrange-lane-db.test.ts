// Lượt tự chuẩn bị hàng trên DB dev thật, MẺ GỌI SÀN được thay bằng giả lập
// (không gọi sàn). Kiểm: cờ thử/chặn ghi đúng từng nhóm lỗi, lỗi cả gian không
// đánh dấu đơn, công tắc tắt thì tự xóa dòng làn, luồng bóng không gọi mẻ.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName, ShippingStatus } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { AUTO_ARRANGE, LEASE } from "../../config/marketplace-read";
import { AUTO_ARRANGE_LANE, AUTO_ARRANGE_SHADOW_STREAM, AUTO_ARRANGE_STREAM } from "../../lib/auto-arrange";
import type { BatchSnapshot, BatchStartParams } from "../../services/fulfillment/batch-runner";

const runBatch = vi.fn<(p: BatchStartParams) => Promise<BatchSnapshot>>();
const liveBatches = vi.fn(async () => [] as { id: string; total: number; orderIds: string[] }[]);
const notify = vi.fn<(ownerId: string, input: { type: string; title: string; body?: string; link?: string }) => Promise<{ id: string }>>(
  async () => ({ id: "n" })
);

vi.mock("../../services/fulfillment/batch-runner", () => ({
  runFulfillmentBatchNow: (p: BatchStartParams) => runBatch(p),
  findLiveRunningBatches: () => liveBatches(),
}));
// Hỏi lại tên hãng Shopee (09/11/2026) — giả lập, không gọi sàn, không ghi DB.
type RefreshResult = { asked: number; names: Map<string, string>; fromCarrier: number; fromCheckout: number; samples: string[] };
const noNames = (asked: number): RefreshResult => ({ asked, names: new Map(), fromCarrier: 0, fromCheckout: 0, samples: [] });
const refreshCarriers = vi.fn<(channel: unknown, orders: readonly { id: string; orderCode: string }[]) => Promise<RefreshResult>>();
vi.mock("../../integrations/shopee/carrier-names", () => ({
  refreshShopeeCarrierNames: (channel: unknown, orders: readonly { id: string; orderCode: string }[]) => refreshCarriers(channel, orders),
}));
vi.mock("../../services/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/notifications")>()),
  notify: (ownerId: string, input: { type: string; title: string; body?: string; link?: string }) => notify(ownerId, input),
}));

import { handleAutoArrangeItem } from "../auto-arrange-lane";

const stamp = Date.now().toString(36);
const AUTH_ERR = "Gian mất kết nối với sàn — vào Kênh bán để kết nối lại";
const NOT_READY = "Sàn báo đơn chưa sẵn sàng giao — thường do khách chưa thanh toán hoặc đơn đã được sắp xếp vận chuyển trên Seller Center rồi";

let userId = "";
let channelId = "";
const item = { channelId: "", stream: AUTO_ARRANGE_STREAM, lane: AUTO_ARRANGE_LANE };
const signal = new AbortController().signal;

const snapshot = (params: BatchStartParams, failed: { orderCode: string; reason: string }[]): BatchSnapshot => {
  const all = [...params.groups.values()].flat();
  const failedCodes = new Set(failed.map((f) => f.orderCode));
  const confirmedIds = all.filter((o) => !failedCodes.has(o.orderCode)).map((o) => o.id);
  return {
    batchId: `b-${stamp}`,
    status: "DONE",
    total: all.length,
    done: all.length,
    confirmed: confirmedIds.length,
    confirmedIds,
    skipped: [],
    failed,
    notes: [],
    error: null,
  };
};

async function mkOrder(code: string, over: Record<string, unknown> = {}) {
  return prisma.order.create({
    data: {
      channelId,
      orderCode: `${code}-${stamp}`,
      customerName: "TEST",
      totalAmount: 1,
      paymentStatus: "PAID",
      shippingStatus: ShippingStatus.PENDING,
      // Gian test là Shopee: máy chỉ đụng đơn ĐÃ RÕ hãng (09/11/2026).
      shippingCarrierName: "SPX Express",
      createdAt: new Date(Date.now() - 60 * 60_000),
      ...over,
    },
    select: { id: true, orderCode: true },
  });
}

async function enroll(stream = AUTO_ARRANGE_STREAM) {
  await prisma.syncCursor.upsert({
    where: { channelId_stream: { channelId, stream } },
    update: {},
    create: { channelId, stream, lane: AUTO_ARRANGE_LANE, cursorAt: new Date(), windowMs: 0 },
  });
}

describe("handleAutoArrangeItem (DB dev + mẻ giả lập)", () => {
  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `test-auto-arrange-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
      select: { id: true },
    });
    userId = u.id;
    const c = await prisma.channel.create({
      data: {
        userId,
        channelName: ChannelName.SHOPEE,
        shopName: `TEST-auto-${stamp}`,
        externalShopId: `91${stamp}`,
        status: "ACTIVE",
        refreshToken: "x",
        autoArrangeEnabledAt: new Date(),
      },
      select: { id: true },
    });
    channelId = c.id;
    item.channelId = channelId;
  });

  beforeEach(async () => {
    runBatch.mockReset();
    liveBatches.mockReset().mockResolvedValue([]);
    notify.mockReset();
    refreshCarriers.mockReset().mockImplementation(async (_c, orders) => noNames(orders.length));
    await prisma.order.deleteMany({ where: { channelId } });
    await prisma.syncCursor.deleteMany({ where: { channelId } });
    await prisma.channel.update({ where: { id: channelId }, data: { autoArrangeEnabledAt: new Date() } });
    await enroll();
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { channelId } });
    await prisma.syncCursor.deleteMany({ where: { channelId } });
    await prisma.channel.deleteMany({ where: { id: channelId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("không có đơn đủ điều kiện → không gọi mẻ, hẹn ~30′", async () => {
    await mkOrder("U", { paymentStatus: "UNPAID" });
    const next = await handleAutoArrangeItem(item, signal);
    expect(runBatch).not.toHaveBeenCalled();
    expect(next).toBeGreaterThanOrEqual(AUTO_ARRANGE.INTERVAL_MS - AUTO_ARRANGE.JITTER_MS);
    expect(next).toBeLessThanOrEqual(AUTO_ARRANGE.INTERVAL_MS + AUTO_ARRANGE.JITTER_MS);
  });

  it("sàn nhận hết → đơn được đánh dấu đã thử, mẻ mang source AUTO, không chuông", async () => {
    const a = await mkOrder("A");
    const b = await mkOrder("B");
    runBatch.mockImplementation(async (p) => snapshot(p, []));
    const next = await handleAutoArrangeItem(item, signal);
    expect(runBatch).toHaveBeenCalledTimes(1);
    const params = runBatch.mock.calls[0][0];
    expect(params.source).toBe("AUTO");
    expect(params.ownerId).toBe(userId);
    expect([...params.groups.values()].flat().map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    const rows = await prisma.order.findMany({ where: { channelId }, select: { autoArrangeTriedAt: true, autoArrangeAttempts: true } });
    expect(rows.every((r) => r.autoArrangeTriedAt !== null && r.autoArrangeAttempts === 0)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(next).toBeGreaterThan(0);
  });

  it("chưa sẵn sàng → cộng lần thử; lỗi cứng → chặn + chuông một lần; đơn đã thử không vào lại lượt kế", async () => {
    const r = await mkOrder("R");
    const d = await mkOrder("D");
    const ok = await mkOrder("OK");
    runBatch.mockImplementation(async (p) =>
      snapshot(p, [
        { orderCode: r.orderCode, reason: NOT_READY },
        { orderCode: d.orderCode, reason: "Package 1 not eligible for rescheduling" },
      ])
    );
    await handleAutoArrangeItem(item, signal);
    const byId = new Map((await prisma.order.findMany({ where: { channelId } })).map((o) => [o.id, o]));
    expect(byId.get(r.id)).toMatchObject({ autoArrangeAttempts: 1, autoArrangeBlockedAt: null });
    expect(byId.get(d.id)?.autoArrangeBlockedAt).not.toBeNull();
    expect(byId.get(d.id)?.autoArrangeBlockedReason).toContain("not eligible");
    expect(byId.get(ok.id)).toMatchObject({ autoArrangeAttempts: 0, autoArrangeBlockedAt: null });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toMatchObject({ type: "auto-arrange", link: "/orders?tab=pending" });

    // Lượt kế ngay sau: R vừa thử (< 30′), D đã chặn, OK đã thử → không gọi mẻ.
    runBatch.mockClear();
    await handleAutoArrangeItem(item, signal);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("chưa sẵn sàng lần thứ 6 → chặn với lý do nêu số lần", async () => {
    const r = await mkOrder("R6", { autoArrangeAttempts: AUTO_ARRANGE.MAX_ATTEMPTS - 1 });
    runBatch.mockImplementation(async (p) => snapshot(p, [{ orderCode: r.orderCode, reason: NOT_READY }]));
    await handleAutoArrangeItem(item, signal);
    const row = await prisma.order.findUnique({ where: { id: r.id } });
    expect(row?.autoArrangeBlockedAt).not.toBeNull();
    expect(row?.autoArrangeBlockedReason).toContain(`${AUTO_ARRANGE.MAX_ATTEMPTS} lần`);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("lỗi cả gian (mất kết nối) → không đánh dấu đơn, không chuông, hẹn lại 60′", async () => {
    await mkOrder("E1");
    await mkOrder("E2");
    runBatch.mockImplementation(async (p) =>
      snapshot(p, [...p.groups.values()].flat().map((o) => ({ orderCode: o.orderCode, reason: AUTH_ERR })))
    );
    const next = await handleAutoArrangeItem(item, signal);
    const rows = await prisma.order.findMany({ where: { channelId } });
    expect(rows.every((o) => o.autoArrangeTriedAt === null && o.autoArrangeAttempts === 0 && o.autoArrangeBlockedAt === null)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(next).toBe(AUTO_ARRANGE.AUTH_RETRY_MS);
  });

  it("lỗi cả gian tạm (429) → hẹn lại 5′", async () => {
    await mkOrder("T1");
    runBatch.mockImplementation(async (p) =>
      snapshot(p, [...p.groups.values()].flat().map((o) => ({ orderCode: o.orderCode, reason: "HTTP 429 Too Many Requests" })))
    );
    expect(await handleAutoArrangeItem(item, signal)).toBe(LEASE.ERROR_RETRY_MS);
  });

  it("đơn đang trong mẻ người bấm → bỏ qua, không gọi mẻ cho đơn đó", async () => {
    const held = await mkOrder("H");
    const free = await mkOrder("F");
    liveBatches.mockResolvedValue([{ id: "manual", total: 1, orderIds: [held.id] }]);
    runBatch.mockImplementation(async (p) => snapshot(p, []));
    await handleAutoArrangeItem(item, signal);
    const sent = [...runBatch.mock.calls[0][0].groups.values()].flat().map((o) => o.id);
    expect(sent).toEqual([free.id]);
  });

  it("công tắc đã tắt mà còn dòng làn → tự xóa dòng, không gọi sàn", async () => {
    await mkOrder("X");
    await prisma.channel.update({ where: { id: channelId }, data: { autoArrangeEnabledAt: null } });
    await handleAutoArrangeItem(item, signal);
    expect(runBatch).not.toHaveBeenCalled();
    expect(await prisma.syncCursor.count({ where: { channelId, stream: AUTO_ARRANGE_STREAM } })).toBe(0);
  });

  it("luồng bóng: không gọi mẻ, không đụng đơn", async () => {
    const o = await mkOrder("S");
    await enroll(AUTO_ARRANGE_SHADOW_STREAM);
    await handleAutoArrangeItem({ ...item, stream: AUTO_ARRANGE_SHADOW_STREAM }, signal);
    expect(runBatch).not.toHaveBeenCalled();
    expect((await prisma.order.findUnique({ where: { id: o.id } }))?.autoArrangeTriedAt).toBeNull();
  });

  // ---- Sự cố 09/11/2026: đơn Shopee vừa về chưa kèm tên hãng bị máy chuẩn bị, sau mới lộ là SPX Instant ----

  it("đơn chưa rõ hãng: hỏi sàn, sàn chưa trả tên → KHÔNG đem đi, không đánh dấu, đơn rõ hãng vẫn đi", async () => {
    const unknown = await mkOrder("NONAME", { shippingCarrierName: null });
    const placeholder = await mkOrder("ALLOC", { shippingCarrierName: "Đang Điều Phối ĐVVC" });
    const normal = await mkOrder("NORMAL");
    runBatch.mockImplementation(async (p) => snapshot(p, []));
    await handleAutoArrangeItem(item, signal);
    expect(refreshCarriers).toHaveBeenCalledTimes(1);
    expect(refreshCarriers.mock.calls[0][1].map((o) => o.id).sort()).toEqual([unknown.id, placeholder.id].sort());
    const sent = [...runBatch.mock.calls[0][0].groups.values()].flat().map((o) => o.id);
    expect(sent).toEqual([normal.id]);
    const rows = await prisma.order.findMany({ where: { id: { in: [unknown.id, placeholder.id] } } });
    expect(rows.every((o) => o.autoArrangeTriedAt === null && o.autoArrangeAttempts === 0 && o.autoArrangeBlockedAt === null)).toBe(true);
  });

  it("đơn chưa rõ hãng: sàn trả tên hỏa tốc → để người làm; trả tên thường → đem đi", async () => {
    const instant = await mkOrder("INSTANT", { shippingCarrierName: null });
    const viaCheckout = await mkOrder("HOATOC", { shippingCarrierName: null });
    const normal = await mkOrder("NHANH", { shippingCarrierName: null });
    refreshCarriers.mockImplementation(async (_c, orders) => ({
      asked: orders.length,
      names: new Map([
        [instant.id, "SPX Instant"],
        [viaCheckout.id, "Hỏa Tốc"],
        [normal.id, "Nhanh"],
      ]),
      fromCarrier: 1,
      fromCheckout: 2,
      samples: [],
    }));
    runBatch.mockImplementation(async (p) => snapshot(p, []));
    await handleAutoArrangeItem(item, signal);
    const sent = [...runBatch.mock.calls[0][0].groups.values()].flat().map((o) => o.id);
    expect(sent).toEqual([normal.id]);
  });

  it("hỏi tên hãng lỗi (sàn 429) → đơn chưa rõ hãng chờ, lượt vẫn chạy cho đơn rõ hãng", async () => {
    await mkOrder("NONAME2", { shippingCarrierName: null });
    const normal = await mkOrder("NORMAL2");
    refreshCarriers.mockRejectedValue(new Error("HTTP 429 Too Many Requests"));
    runBatch.mockImplementation(async (p) => snapshot(p, []));
    await handleAutoArrangeItem(item, signal);
    const sent = [...runBatch.mock.calls[0][0].groups.values()].flat().map((o) => o.id);
    expect(sent).toEqual([normal.id]);
  });

  it("không có đơn chưa rõ hãng, hoặc đơn chưa rõ hãng còn chưa thanh toán / xin hủy → không hỏi sàn", async () => {
    await mkOrder("OKAY");
    await mkOrder("UNPAIDNONAME", { shippingCarrierName: null, paymentStatus: "UNPAID" });
    await mkOrder("CANCELNONAME", { shippingCarrierName: null, cancelRequestedAt: new Date() });
    runBatch.mockImplementation(async (p) => snapshot(p, []));
    await handleAutoArrangeItem(item, signal);
    expect(refreshCarriers).not.toHaveBeenCalled();
  });

  it("luồng bóng: đơn chưa rõ hãng cũng không hỏi sàn", async () => {
    await mkOrder("SHADOWNONAME", { shippingCarrierName: null });
    await enroll(AUTO_ARRANGE_SHADOW_STREAM);
    await handleAutoArrangeItem({ ...item, stream: AUTO_ARRANGE_SHADOW_STREAM }, signal);
    expect(refreshCarriers).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("quá trần lượt → vẫn chỉ gửi tối đa trần và hẹn lại ngay (0)", async () => {
    for (let i = 0; i < AUTO_ARRANGE.MAX_PER_RUN + 3; i++) await mkOrder(`M${i}`);
    runBatch.mockImplementation(async (p) => snapshot(p, []));
    const next = await handleAutoArrangeItem(item, signal);
    expect([...runBatch.mock.calls[0][0].groups.values()].flat()).toHaveLength(AUTO_ARRANGE.MAX_PER_RUN);
    expect(next).toBe(0);
  });
});
