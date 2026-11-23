// ============================================================
// VIDEO ĐÓNG HÀNG — rào S1: shop này KHÔNG BAO GIỜ thấy / đụng được video shop khác, ở MỌI đường
// (4 đường đọc + đơn hoàn + thống kê + cờ đơn + 3 đường tải lên). Kèm kiểm đúng sai của các đường
// đọc với chính chủ: chip, ô tìm, con trỏ, lọc ngày, đơn hoàn, thống kê, giới hạn gian của nhân viên.
// Postgres thật, kho R2 giả. Tự tạo hai chủ shop rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { CANCELLED_AFTER_SHIP } from "../../../integrations/cancelled-after-ship";
import type { BeginInput } from "../../../lib/pack-video-rules";
import { prisma } from "../../../lib/prisma";
import {
  listReturnOrders,
  listVideos,
  ordersWithVideo,
  summarizeVideos,
  videoStats,
  videoUrl,
  videosByOrder,
  type PackVideoScope,
} from "../library";
import { grantHours } from "../hours";
import { PackVideoError, beginUpload, completeUpload, signUploadParts } from "../upload";
import { createFakeStorage } from "./fake-storage";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvi-${Date.now()}`;
const storage = createFakeStorage();

async function codeOf(p: Promise<unknown>): Promise<[number, string] | null> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  );
  if (!(err instanceof PackVideoError)) return null;
  return [err.status, err.code];
}

describe.skipIf(!dbReady)("Video đóng hàng — cô lập giữa hai chủ shop + các đường đọc", () => {
  let a = "";
  let b = "";
  let chA1 = "";
  let chA2 = "";
  let chB = "";
  const orders: Record<string, string> = {};
  const videos: Record<string, string> = {};

  const scopeA = (): PackVideoScope => ({ ownerId: a, allowedChannelIds: null });
  const scopeB = (): PackVideoScope => ({ ownerId: b, allowedChannelIds: null });

  async function record(
    owner: string,
    name: string,
    patch: Partial<BeginInput> & { minutesAgo: number; store?: boolean }
  ): Promise<string> {
    const { minutesAgo, store = true, ...rest } = patch;
    const base = new Date("2026-11-16T03:00:00.000Z").getTime();
    const input: BeginInput = {
      clientId: `${TAG}-${name}`,
      trackingCode: `${TAG}-${name}`,
      kind: "PACK",
      recordedAt: new Date(base - minutesAgo * 60_000),
      durationSec: 60,
      sizeBytes: 6_500_000,
      width: 768,
      height: 1024,
      deviceName: "Máy thử",
      ...rest,
    };
    const deps = { storage, now: () => new Date(base) };
    const begun = await beginUpload({ ownerId: owner, userId: owner }, input, deps);
    if (store) {
      const row = await prisma.packVideo.findFirstOrThrow({ where: { ownerId: owner, id: begun.video.id } });
      storage.put(row.objectKey, input.sizeBytes);
      await completeUpload({ ownerId: owner, userId: owner }, begun.video.id, undefined, deps);
    }
    return begun.video.id;
  }

  beforeAll(async () => {
    const mk = async (suffix: string) =>
      (
        await prisma.user.create({
          data: { email: `${TAG}-${suffix}@test.local`, passwordHash: "x", fullName: `Chủ ${suffix}` },
          select: { id: true },
        })
      ).id;
    a = await mk("a");
    b = await mk("b");
    for (const owner of [a, b]) await grantHours({ ownerId: owner, seconds: 100 * 3600, kind: "GRANT", note: TAG });
    const ch = async (userId: string, shopName: string, channelName: ChannelName) =>
      (await prisma.channel.create({ data: { userId, channelName, shopName }, select: { id: true } })).id;
    chA1 = await ch(a, `${TAG} gian 1`, ChannelName.SHOPEE);
    chA2 = await ch(a, `${TAG} gian 2`, ChannelName.TIKTOK);
    chB = await ch(b, `${TAG} gian B`, ChannelName.SHOPEE);

    const T = new Date("2026-11-10T00:00:00.000Z");
    const defs: {
      key: string;
      channelId: string;
      returnStatus?: ReturnStatus;
      platformReturnStatus?: string;
      returnRequestedAt?: Date;
      shippingStatus?: ShippingStatus;
    }[] = [
      { key: "thuong", channelId: chA1, shippingStatus: ShippingStatus.SHIPPING },
      { key: "gian2", channelId: chA2, shippingStatus: ShippingStatus.DELIVERED },
      {
        key: "hoan-hong",
        channelId: chA1,
        returnStatus: ReturnStatus.DAMAGED,
        platformReturnStatus: "ACCEPTED",
        returnRequestedAt: new Date(T.getTime() + 2 * 86_400_000),
      },
      {
        key: "hoan-cho",
        channelId: chA1,
        returnStatus: ReturnStatus.AWAITING,
        platformReturnStatus: CANCELLED_AFTER_SHIP,
        returnRequestedAt: new Date(T.getTime() + 86_400_000),
      },
      { key: "hoan-khong-video", channelId: chA2, returnStatus: ReturnStatus.DAMAGED, returnRequestedAt: T },
      { key: "cua-b", channelId: chB },
    ];
    for (const d of defs) {
      const o = await prisma.order.create({
        data: {
          channelId: d.channelId,
          orderCode: `${TAG}-D-${d.key}`,
          customerName: "Khách thử",
          trackingCode: `${TAG}-${d.key}`,
          shippingStatus: d.shippingStatus ?? ShippingStatus.PROCESSED,
          returnStatus: d.returnStatus ?? ReturnStatus.NONE,
          platformReturnStatus: d.platformReturnStatus ?? null,
          returnRequestedAt: d.returnRequestedAt ?? null,
          items: {
            create: [{ channelSku: "SKU-1", productName: `Áo thử ${d.key}`, quantity: 2, price: 100000 }],
          },
        },
        select: { id: true },
      });
      orders[d.key] = o.id;
    }

    // Video của A (mới → cũ theo minutesAgo).
    videos.thuong = await record(a, "thuong", { minutesAgo: 1 });
    videos.gian2 = await record(a, "gian2", { minutesAgo: 2, durationSec: 300, sizeBytes: 30_900_000 });
    videos.hoanHong = await record(a, "hoan-hong", { minutesAgo: 3 });
    videos.hoanCho = await record(a, "hoan-cho", { minutesAgo: 4 });
    videos.hoanChoKhui = await record(a, "hoan-cho-khui", {
      minutesAgo: 5,
      trackingCode: `${TAG}-hoan-cho`,
      kind: "UNBOX",
    });
    videos.la = await record(a, "ma-la", { minutesAgo: 6 });
    videos.cho = await record(a, "cho-tai", { minutesAgo: 7, store: false });
    // Video cũ hẳn một ngày — để thử lọc ngày.
    videos.homQua = await record(a, "hom-qua", { minutesAgo: 60 * 30 });
    // Video của B.
    videos.b = await record(b, "cua-b", { minutesAgo: 1 });
  });

  afterAll(async () => {
    if (!a) return;
    await prisma.packVideo.deleteMany({ where: { ownerId: { in: [a, b] } } });
    await prisma.packHourGrant.deleteMany({ where: { ownerId: { in: [a, b] } } });
    await prisma.order.deleteMany({ where: { channelId: { in: [chA1, chA2, chB] } } });
    await prisma.channel.deleteMany({ where: { id: { in: [chA1, chA2, chB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a, b] } } });
  });

  // ───────── S1: B không thấy / không đụng được gì của A ─────────

  it("S1 đọc — danh sách, số trên chip, ô tìm, thống kê, đơn hoàn của B không chứa gì của A", async () => {
    const list = await listVideos(scopeB(), {}, {});
    expect(list.items.map((v) => v.id)).toEqual([videos.b]);
    expect(await summarizeVideos(scopeB(), {})).toEqual({ all: 1, returns: 0, unmatched: 0, pending: 0, expiring: 0 });

    // Gõ đúng mã vận đơn / mã đơn của A vào ô tìm của B.
    expect((await listVideos(scopeB(), { q: `${TAG}-thuong` }, {})).items).toEqual([]);
    expect((await listVideos(scopeB(), { q: `${TAG}-D-thuong` }, {})).items).toEqual([]);
    // Lọc theo gian / người quay của A.
    expect((await listVideos(scopeB(), { channelIds: [chA1] }, {})).items).toEqual([]);
    expect((await listVideos(scopeB(), { recordedById: a }, {})).items).toEqual([]);

    const stats = await videoStats(scopeB(), undefined);
    expect([stats.totalVideos, stats.byRecorder.length, stats.longest.length]).toEqual([1, 1, 1]);
    expect(stats.longest[0].id).toBe(videos.b);

    const returns = await listReturnOrders(scopeB(), {});
    expect(returns.cards).toEqual({ all: 0, has_pack: 0, damaged_no_unbox: 0, due_soon: 0, no_video: 0 });
    expect(returns.items).toEqual([]);
  });

  it("S1 đọc — hồ sơ đơn, đường dẫn xem / tải, cờ đơn của A: B nhận 404 / rỗng", async () => {
    expect(await codeOf(videosByOrder(scopeB(), orders.thuong))).toEqual([404, "NOT_FOUND"]);
    expect(await codeOf(videoUrl(scopeB(), videos.thuong, false, { storage }))).toEqual([404, "NOT_FOUND"]);
    expect(await codeOf(videoUrl(scopeB(), videos.thuong, true, { storage }))).toEqual([404, "NOT_FOUND"]);
    expect(await ordersWithVideo(scopeB(), [orders.thuong, orders["hoan-hong"]])).toEqual([]);
  });

  it("S1 ghi — B không ký lại mảnh / không chốt được video của A", async () => {
    const actorB = { ownerId: b, userId: b };
    expect(await codeOf(signUploadParts(actorB, videos.cho, [1], { storage }))).toEqual([404, "NOT_FOUND"]);
    expect(await codeOf(completeUpload(actorB, videos.cho, undefined, { storage }))).toEqual([404, "NOT_FOUND"]);
    // Dòng của A vẫn nguyên PENDING.
    expect((await prisma.packVideo.findFirstOrThrow({ where: { id: videos.cho } })).status).toBe("PENDING");
  });

  it("S1 ghi — B dùng lại clientId + mã vận đơn của A: ra dòng MỚI của B, không khớp đơn của A", async () => {
    const begun = await beginUpload(
      { ownerId: b, userId: b },
      {
        clientId: `${TAG}-thuong`,
        trackingCode: `${TAG}-thuong`,
        kind: "PACK",
        recordedAt: new Date("2026-11-16T02:00:00.000Z"),
        durationSec: 60,
        sizeBytes: 6_500_000,
        width: null,
        height: null,
        deviceName: null,
      },
      { storage }
    );
    expect(begun.video.id).not.toBe(videos.thuong);
    const row = await prisma.packVideo.findFirstOrThrow({ where: { id: begun.video.id } });
    expect([row.ownerId, row.orderId, row.status]).toEqual([b, null, "PENDING"]);
    expect(row.objectKey.startsWith(`${b}/`)).toBe(true);
    // Video của A không đổi gì.
    const mine = await prisma.packVideo.findFirstOrThrow({ where: { id: videos.thuong } });
    expect([mine.ownerId, mine.status]).toEqual([a, "STORED"]);
  });

  // ───────── Đúng sai với chính chủ ─────────

  it("danh sách của A: mới nhất trước, ghép đủ đơn / gian / người quay / dòng hàng", async () => {
    const list = await listVideos(scopeA(), {}, {});
    expect(list.items.map((v) => v.id)).toEqual([
      videos.thuong,
      videos.gian2,
      videos.hoanHong,
      videos.hoanCho,
      videos.hoanChoKhui,
      videos.la,
      videos.cho,
      videos.homQua,
    ]);
    const first = list.items[0];
    expect(first).toMatchObject({
      kind: "PACK",
      status: "STORED",
      trackingCode: `${TAG}-thuong`,
      orderId: orders.thuong,
      orderCode: `${TAG}-D-thuong`,
      channelId: chA1,
      channelPlatform: "SHOPEE",
      shopName: `${TAG} gian 1`,
      durationSec: 60,
      sizeBytes: 6_500_000,
      recordedById: a,
      recordedByName: "Chủ a",
      deviceName: "Máy thử",
      durationFlag: false,
    });
    expect(first.order).toMatchObject({ shippingStatus: "SHIPPING", returnStatus: "NONE", hasReturn: false });
    expect(first.order?.items).toEqual([
      { name: "Áo thử thuong", variantName: null, quantity: 2, imageUrl: null },
    ]);
    // Mã lạ: không đơn, không gian.
    const la = list.items.find((v) => v.id === videos.la)!;
    expect([la.orderId, la.channelPlatform, la.shopName, la.order]).toEqual([null, null, null, null]);
  });

  it("chip + số trên chip khớp nhau", async () => {
    expect(await summarizeVideos(scopeA(), {})).toEqual({ all: 8, returns: 3, unmatched: 3, pending: 1, expiring: 0 });
    const ids = async (chip: "returns" | "unmatched" | "pending") =>
      (await listVideos(scopeA(), {}, { chip })).items.map((v) => v.id);
    expect(await ids("returns")).toEqual([videos.hoanHong, videos.hoanCho, videos.hoanChoKhui]);
    expect(await ids("unmatched")).toEqual([videos.la, videos.cho, videos.homQua]);
    expect(await ids("pending")).toEqual([videos.cho]);
  });

  it("ô tìm: tiền tố mã vận đơn; không ra thì coi là mã đơn đúng tuyệt đối; ký tự % không lái được", async () => {
    const q = async (text: string) => (await listVideos(scopeA(), { q: text }, {})).items.map((v) => v.id);
    expect(await q(`${TAG}-hoan-c`)).toEqual([videos.hoanCho, videos.hoanChoKhui]);
    expect(await q(`${TAG}-D-gian2`)).toEqual([videos.gian2]);
    expect(await q(`${TAG}-D-gian`)).toEqual([]); // mã đơn không khớp theo tiền tố
    expect(await q("%")).toEqual([]);
    expect(await q("khong-co-ma-nay")).toEqual([]);
    expect((await summarizeVideos(scopeA(), { q: `${TAG}-hoan-c` })).all).toBe(2);
  });

  it("lọc loại, gian, người quay, khoảng ngày (theo giờ quay)", async () => {
    const ids = async (f: Parameters<typeof listVideos>[1]) =>
      (await listVideos(scopeA(), f, {})).items.map((v) => v.id);
    expect(await ids({ kind: "UNBOX" })).toEqual([videos.hoanChoKhui]);
    expect(await ids({ channelIds: [chA2] })).toEqual([videos.gian2]);
    expect(await ids({ recordedById: b })).toEqual([]);
    // Ngày 16/11 giờ VN = 15/11 17:00Z → 16/11 16:59:59.999Z. Video "hôm qua" quay 30 giờ trước 03:00Z ngày 16.
    const day16 = { gte: new Date("2026-11-15T17:00:00.000Z"), lte: new Date("2026-11-16T16:59:59.999Z") };
    expect(await ids({ range: day16 })).not.toContain(videos.homQua);
    expect((await ids({ range: day16 })).length).toBe(7);
    // 30 giờ trước 03:00Z ngày 16 = 21:00Z ngày 14 = 04:00 ngày 15 giờ VN.
    const day15 = { gte: new Date("2026-11-14T17:00:00.000Z"), lte: new Date("2026-11-15T16:59:59.999Z") };
    expect(await ids({ range: day15 })).toEqual([videos.homQua]);
    const day14 = { gte: new Date("2026-11-13T17:00:00.000Z"), lte: new Date("2026-11-14T16:59:59.999Z") };
    expect(await ids({ range: day14 })).toEqual([]);
  });

  it("con trỏ phân trang đi hết danh sách, không lặp, không sót", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await listVideos(scopeA(), {}, { limit: 3, cursor });
      seen.push(...page.items.map((v) => v.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });

  it("hồ sơ một đơn: đủ video đóng + khui theo thứ tự quay; đơn không có video vẫn mở được", async () => {
    const d = await videosByOrder(scopeA(), orders["hoan-cho"]);
    expect(d.order).toMatchObject({
      id: orders["hoan-cho"],
      orderCode: `${TAG}-D-hoan-cho`,
      trackingCode: `${TAG}-hoan-cho`,
      channelPlatform: "SHOPEE",
      shopName: `${TAG} gian 1`,
      returnStatus: "AWAITING",
    });
    expect(d.order.returnRequestedAt).toBe("2026-11-11T00:00:00.000Z");
    expect(d.order.items).toHaveLength(1);
    // Khui quay TRƯỚC đóng 1 phút trong dữ liệu thử (minutesAgo 5 so với 4).
    expect(d.videos.map((v) => [v.id, v.kind])).toEqual([
      [videos.hoanChoKhui, "UNBOX"],
      [videos.hoanCho, "PACK"],
    ]);
    const empty = await videosByOrder(scopeA(), orders["hoan-khong-video"]);
    expect(empty.videos).toEqual([]);
    expect(empty.order.items[0].name).toBe("Áo thử hoan-khong-video");
  });

  it("đường dẫn xem / tải về: chỉ video đã lên kho; tải về mang tên = mã vận đơn", async () => {
    const view = await videoUrl(scopeA(), videos.hoanChoKhui, false, { storage });
    expect(view.url).toContain(`${a}/`);
    expect(view.url).not.toContain("download=");
    const dl = await videoUrl(scopeA(), videos.hoanChoKhui, true, { storage });
    expect(dl.url).toContain(`download=${TAG}-hoan-cho-khui.mp4`);
    expect(await codeOf(videoUrl(scopeA(), videos.cho, false, { storage }))).toEqual([409, "NOT_STORED"]);
    expect(await codeOf(videoUrl(scopeA(), "khong-co", false, { storage }))).toEqual([404, "NOT_FOUND"]);
  });

  it("cờ đơn có video: chỉ tính video đã lên kho", async () => {
    const flagged = await ordersWithVideo(scopeA(), [
      orders.thuong,
      orders["hoan-khong-video"],
      orders["cua-b"],
      "khong-co",
    ]);
    expect(flagged).toEqual([orders.thuong]);
    expect(await ordersWithVideo(scopeA(), [])).toEqual([]);
  });

  it("đơn hoàn: một dòng một ĐƠN (kể cả đơn không có video), số trên thẻ khớp bộ lọc", async () => {
    const all = await listReturnOrders(scopeA(), {});
    expect(all.cards).toEqual({ all: 3, has_pack: 2, damaged_no_unbox: 2, due_soon: 0, no_video: 1 });
    // Mới báo hoàn trước.
    expect(all.items.map((r) => r.orderId)).toEqual([
      orders["hoan-hong"],
      orders["hoan-cho"],
      orders["hoan-khong-video"],
    ]);
    const cho = all.items[1];
    expect(cho).toMatchObject({
      orderCode: `${TAG}-D-hoan-cho`,
      trackingCode: `${TAG}-hoan-cho`,
      channelPlatform: "SHOPEE",
      shopName: `${TAG} gian 1`,
      returnType: "FAILED_DELIVERY",
      returnStatus: "AWAITING",
      packVideo: { id: videos.hoanCho, durationSec: 60 },
      unboxVideo: { id: videos.hoanChoKhui, durationSec: 60 },
    });
    expect(all.items[0]).toMatchObject({ returnType: "BUYER_RETURN", unboxVideo: null });
    expect(all.items[2]).toMatchObject({ packVideo: null, unboxVideo: null });

    const ids = async (card: "has_pack" | "damaged_no_unbox" | "no_video") =>
      (await listReturnOrders(scopeA(), { card })).items.map((r) => r.orderId);
    expect(await ids("has_pack")).toEqual([orders["hoan-hong"], orders["hoan-cho"]]);
    expect(await ids("damaged_no_unbox")).toEqual([orders["hoan-hong"], orders["hoan-khong-video"]]);
    expect(await ids("no_video")).toEqual([orders["hoan-khong-video"]]);

    const p1 = await listReturnOrders(scopeA(), { limit: 2 });
    expect([p1.items.length, p1.nextCursor]).toEqual([2, "2"]);
    const p2 = await listReturnOrders(scopeA(), { limit: 2, cursor: p1.nextCursor! });
    expect([p2.items.length, p2.nextCursor]).toEqual([1, null]);
  });

  it("đơn hoàn: hạn khiếu nại — thẻ Sắp hết hạn (≤ 24 giờ) + sắp theo hạn + ô hạn của dòng", async () => {
    const now = new Date("2026-11-25T13:00:00.000Z");
    const h = (n: number) => new Date(now.getTime() + n * 3_600_000);
    await prisma.order.update({ where: { id: orders["hoan-cho"] }, data: { returnComplaintDueAt: h(30) } });
    await prisma.order.update({ where: { id: orders["hoan-hong"] }, data: { returnComplaintDueAt: h(5) } });
    await prisma.order.update({ where: { id: orders["hoan-khong-video"] }, data: { returnComplaintDueAt: h(-3) } });
    try {
      const all = await listReturnOrders(scopeA(), { now });
      expect(all.cards.due_soon).toBe(1);
      expect(all.items.find((r) => r.orderId === orders["hoan-hong"])?.complaintDue).toEqual({
        state: "DUE",
        dueAt: h(5).toISOString(),
        source: "platform",
        failedDelivery: false,
        windowHours: null,
      });
      const soon = await listReturnOrders(scopeA(), { card: "due_soon", now });
      expect(soon.items.map((r) => r.orderId)).toEqual([orders["hoan-hong"]]);
      // Còn hạn gần nhất trước → còn hạn xa → đã quá hạn.
      const byDue = await listReturnOrders(scopeA(), { sort: "due", now });
      expect(byDue.items.map((r) => r.orderId)).toEqual([
        orders["hoan-hong"],
        orders["hoan-cho"],
        orders["hoan-khong-video"],
      ]);
    } finally {
      await prisma.order.updateMany({
        where: { id: { in: [orders["hoan-cho"], orders["hoan-hong"], orders["hoan-khong-video"]] } },
        data: { returnComplaintDueAt: null },
      });
    }
  });

  it("thống kê: chỉ video đã lên kho; cộng theo ngày giờ VN, người quay, gian; video dài nhất đứng đầu", async () => {
    const s = await videoStats(scopeA(), undefined);
    // 7 video STORED: 6 × 60 giây + 1 × 300 giây.
    expect([s.totalVideos, s.totalSeconds, s.avgSeconds]).toEqual([7, 660, 94]);
    expect(s.byDay).toEqual([
      { day: "2026-11-15", videos: 1, seconds: 60 },
      { day: "2026-11-16", videos: 6, seconds: 600 },
    ]);
    expect(s.byRecorder).toEqual([
      { recordedById: a, name: "Chủ a", videos: 7, seconds: 660, avgSeconds: 94, maxSeconds: 300 },
    ]);
    expect(s.byChannel).toEqual(
      expect.arrayContaining([
        { channelId: chA1, shopName: `${TAG} gian 1`, videos: 4, seconds: 240 },
        { channelId: chA2, shopName: `${TAG} gian 2`, videos: 1, seconds: 300 },
        { channelId: null, shopName: null, videos: 2, seconds: 120 },
      ])
    );
    expect(s.longest[0].id).toBe(videos.gian2);
    expect(s.longest).toHaveLength(7);

    const day16 = { gte: new Date("2026-11-15T17:00:00.000Z"), lte: new Date("2026-11-16T16:59:59.999Z") };
    expect((await videoStats(scopeA(), day16)).totalVideos).toBe(6);
  });

  it("nhân viên bị giới hạn gian: chỉ thấy video của gian mình, không thấy video chưa khớp đơn", async () => {
    const staff: PackVideoScope = { ownerId: a, allowedChannelIds: [chA2] };
    expect((await listVideos(staff, {}, {})).items.map((v) => v.id)).toEqual([videos.gian2]);
    expect((await summarizeVideos(staff, {})).all).toBe(1);
    expect(await codeOf(videosByOrder(staff, orders.thuong))).toEqual([404, "NOT_FOUND"]);
    expect(await codeOf(videoUrl(staff, videos.thuong, false, { storage }))).toEqual([404, "NOT_FOUND"]);
    expect((await listReturnOrders(staff, {})).items.map((r) => r.orderId)).toEqual([orders["hoan-khong-video"]]);
    const none: PackVideoScope = { ownerId: a, allowedChannelIds: [] };
    expect((await listVideos(none, {}, {})).items).toEqual([]);
    expect((await listReturnOrders(none, {})).cards.all).toBe(0);
  });
});
