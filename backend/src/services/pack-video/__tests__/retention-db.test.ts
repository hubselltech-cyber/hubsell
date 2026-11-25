// ============================================================
// VIDEO ĐÓNG HÀNG — luật giữ / tự xóa chạy trên Postgres thật (lát W5, 18/11/2026).
// Rào kiểm: gán hạn đúng luật theo đơn thật (Shopee / Lazada, giao, hủy ngang, có hoàn, chưa khớp) ·
// hạn ghi MỘT lần · CHẠY BÓNG không gọi lệnh xóa nào trên kho, video vẫn STORED · đơn mới có dấu hiệu hoàn
// lúc tới hạn thì gỡ hạn, chặn xóa · bật xóa thật thì xóa tệp rồi mới đánh dấu DELETED · giờ đã quay không
// tụt khi dòng sổ video cũ biến mất (bảng gộp theo ngày) · xóa tài khoản: sau cờ chỉ đếm, bật cờ mới xóa.
// Mọi hàm gọi với phạm vi MỘT chủ shop thử — không chạm video thật của database local.
// Tự tạo dữ liệu rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { buildPackVideoKey } from "../../../lib/pack-video-key";
import { prisma } from "../../../lib/prisma";
import { listDeletedVideos, listVideos, summarizeVideos } from "../library";
import { purgeOwnerPackVideos } from "../owner-purge";
import { assignRetention, processDueVideos, sweepStalePending } from "../retention";
import { USAGE_JOB_KEY, rollUpUsageDaily, usedSecondsOf, usageWatermark } from "../usage-daily";
import { createFakeStorage } from "./fake-storage";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    await prisma.$queryRaw`SELECT 1 FROM "pack_usage_daily" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvr-${Date.now()}`;
// Lúc xét: 18/11/2026 10:00 VN. Video quay 10/11.
const NOW = new Date("2026-11-18T03:00:00.000Z");
const REC_DATE = "2026-11-10";

describe.skipIf(!dbReady)("Video đóng hàng — luật giữ / tự xóa trên sổ thật", () => {
  let owner = "";
  let chShopee = "";
  let chLazada = "";
  const orderIds: Record<string, string> = {};
  const videoIds: Record<string, string> = {};
  let seq = 0;

  async function addOrder(key: string, channelId: string, data: Record<string, unknown>) {
    const o = await prisma.order.create({
      data: { channelId, orderCode: `${TAG}-${key}`, customerName: "Khách thử", trackingCode: `${TAG}-VD-${key}`, ...data },
      select: { id: true },
    });
    orderIds[key] = o.id;
  }

  async function addVideo(
    key: string,
    opts: { orderKey?: string; kind?: "PACK" | "UNBOX"; durationSec?: number; trackingCode?: string }
  ) {
    seq += 1;
    const id = `${TAG.replace(/-/g, "")}v${seq}`;
    const orderId = opts.orderKey ? orderIds[opts.orderKey] : null;
    await prisma.packVideo.create({
      data: {
        id,
        recordedDate: new Date(`${REC_DATE}T00:00:00.000Z`),
        ownerId: owner,
        clientId: `${TAG}-c${seq}`,
        channelId: orderId ? (opts.orderKey === "lazada" ? chLazada : chShopee) : null,
        orderId,
        trackingCode: opts.trackingCode ?? `${TAG}-T${seq}`,
        kind: opts.kind ?? "PACK",
        recordedById: owner,
        recordedAt: new Date(`${REC_DATE}T03:00:00.000Z`),
        durationSec: opts.durationSec ?? 60,
        sizeBytes: BigInt(6_000_000),
        objectKey: buildPackVideoKey({ ownerId: owner, recordedDate: REC_DATE, id }),
        status: "STORED",
        uploadedAt: new Date(`${REC_DATE}T03:05:00.000Z`),
      },
    });
    videoIds[key] = id;
  }

  const row = (key: string) =>
    prisma.packVideo.findFirstOrThrow({
      where: { ownerId: owner, id: videoIds[key] },
      select: { deleteAfter: true, deleteRule: true, holdReason: true, status: true, deletedAt: true, objectKey: true },
    });
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  // Mốc gộp giờ là của CẢ database: test dời nó sang ngày giả lập thì phải trả lại y như cũ.
  let savedUsageJob: { cursor: string | null; processed: number } | null = null;

  beforeAll(async () => {
    savedUsageJob = await prisma.maintenanceJob.findUnique({
      where: { key: USAGE_JOB_KEY },
      select: { cursor: true, processed: true },
    });
    // Mốc thật của database local trôi theo ngày (worker dọn chạy mỗi 6 giờ): khi nó đã vượt REC_DATE thì video
    // thử (quay 10/11) rơi vào vùng "đã gộp" mà chưa có dòng gộp → ca "giờ đã quay không tụt" đọc ra 0 và kéo đỏ
    // ca sau (đỏ sẵn từ ~18/11, tìm ra gốc 25/11/2026). Lùi mốc về trước REC_DATE trong lúc test; afterAll trả lại.
    if (savedUsageJob?.cursor && savedUsageJob.cursor >= REC_DATE) {
      await prisma.maintenanceJob.update({ where: { key: USAGE_JOB_KEY }, data: { cursor: "2026-11-09" } });
    }
    owner = (
      await prisma.user.create({
        data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
        select: { id: true },
      })
    ).id;
    chShopee = (
      await prisma.channel.create({ data: { userId: owner, channelName: ChannelName.SHOPEE, shopName: `${TAG}-sp` } })
    ).id;
    chLazada = (
      await prisma.channel.create({ data: { userId: owner, channelName: ChannelName.LAZADA, shopName: `${TAG}-lz` } })
    ).id;
    const delivered = new Date("2026-11-13T05:00:00.000Z");
    await addOrder("giao", chShopee, { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: delivered, stockShippedAt: delivered });
    await addOrder("lazada", chLazada, { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: delivered, stockShippedAt: delivered });
    await addOrder("hoan", chShopee, {
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: delivered,
      returnStatus: ReturnStatus.AWAITING,
    });
    await addOrder("huy-ngang", chShopee, { shippingStatus: ShippingStatus.CANCELLED });
    await addOrder("dang-giao", chShopee, { shippingStatus: ShippingStatus.SHIPPING });
    // Giao xong không hoàn lúc gán hạn — tới hạn thì khách mới xin hoàn (dấu hiệu đến muộn).
    await addOrder("hoan-muon", chShopee, { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: delivered });

    await addVideo("giao", { orderKey: "giao" });
    await addVideo("lazada", { orderKey: "lazada" });
    await addVideo("hoan", { orderKey: "hoan" });
    await addVideo("huy-ngang", { orderKey: "huy-ngang" });
    await addVideo("dang-giao", { orderKey: "dang-giao" });
    await addVideo("hoan-muon", { orderKey: "hoan-muon" });
    await addVideo("khong-khop", {});
    await addVideo("khui-khong-khop", { kind: "UNBOX" });
  });

  afterAll(async () => {
    if (savedUsageJob) {
      await prisma.maintenanceJob.update({ where: { key: USAGE_JOB_KEY }, data: savedUsageJob });
    } else {
      await prisma.maintenanceJob.deleteMany({ where: { key: USAGE_JOB_KEY } });
    }
    if (!owner) return;
    await prisma.packVideo.deleteMany({ where: { ownerId: owner } });
    await prisma.packUsageDaily.deleteMany({ where: { ownerId: owner } });
    await prisma.order.deleteMany({ where: { channelId: { in: [chShopee, chLazada] } } });
    await prisma.channel.deleteMany({ where: { id: { in: [chShopee, chLazada] } } });
    await prisma.user.deleteMany({ where: { id: owner } });
  });

  it("gán hạn đúng luật theo đơn thật", async () => {
    const r = await assignRetention({ now: () => NOW, onlyOwnerId: owner });
    expect(r.scanned).toBe(8);
    expect(r.waiting).toBe(1); // đang giao

    expect(await row("giao")).toMatchObject({ deleteRule: "L4", holdReason: null });
    expect(day((await row("giao")).deleteAfter)).toBe("2026-12-01"); // giao 13/11 + 15 + 3
    expect(day((await row("lazada")).deleteAfter)).toBe("2026-12-16"); // Lazada + 30 + 3
    expect(await row("hoan")).toMatchObject({ deleteAfter: null, holdReason: "RETURN_OPEN" });
    expect(await row("huy-ngang")).toMatchObject({ deleteRule: "L2" });
    expect(day((await row("huy-ngang")).deleteAfter)).toBe("2026-11-19");
    expect(await row("dang-giao")).toMatchObject({ deleteAfter: null, holdReason: null });
    expect(await row("khong-khop")).toMatchObject({ deleteRule: "L1" });
    expect(day((await row("khong-khop")).deleteAfter)).toBe("2026-11-17"); // ngày quay + 7
    expect(await row("khui-khong-khop")).toMatchObject({ deleteAfter: null, holdReason: "UNBOX_UNMATCHED" });
  });

  it("trang danh sách trả hạn giữ + lý do giữ; chip 'Sắp tự xóa' đếm hạn trong 3 ngày tới (kể cả đã qua)", async () => {
    const scope = { ownerId: owner, allowedChannelIds: null };
    const sum = await summarizeVideos(scope, {});
    // Hôm nay thật (giờ máy) ≥ 25/11/2026 → L1 (17/11) và L2 (19/11) nằm trong "3 ngày tới" (kể cả đã qua).
    expect(sum.expiring).toBeGreaterThanOrEqual(2);
    const page = await listVideos(scope, {}, { chip: "expiring" });
    expect(page.items.every((v) => v.deleteAfter !== null)).toBe(true);
    const all = await listVideos(scope, {}, {});
    expect(all.items.find((v) => v.id === videoIds.hoan)).toMatchObject({ deleteAfter: null, holdReason: "RETURN_OPEN" });
    expect(all.items.find((v) => v.id === videoIds.giao)).toMatchObject({ deleteAfter: "2026-12-01" });
  });

  it("hạn ghi MỘT lần: đơn đổi mốc giao sau đó, lượt sau không ghi đè", async () => {
    await prisma.order.update({ where: { id: orderIds.giao }, data: { deliveredAt: new Date("2026-11-15T05:00:00Z") } });
    await assignRetention({ now: () => NOW, onlyOwnerId: owner });
    expect(day((await row("giao")).deleteAfter)).toBe("2026-12-01");
  });

  it("CHẠY BÓNG: tới hạn chỉ đếm 'sẽ xóa', không gọi lệnh xóa nào, video vẫn STORED", async () => {
    // Khách xin hoàn đơn "hoan-muon" sau khi đã gán hạn L4.
    await prisma.order.update({ where: { id: orderIds["hoan-muon"] }, data: { returnRequestedAt: NOW } });
    const storage = createFakeStorage();
    const later = new Date("2026-12-20T03:00:00.000Z"); // sau mọi hạn L1 / L2 / L4 (Lazada 16/12 cũng đã qua)
    const r = await processDueVideos({
      now: () => later,
      deleteEnabled: false,
      storage: () => storage,
      onlyOwnerId: owner,
    });
    expect(r.shadow).toBe(true);
    expect(r.blockedAtDue).toBe(1); // hoan-muon
    expect(r.wouldDelete).toBe(4); // giao, lazada, huy-ngang, khong-khop
    expect(r.deleted).toBe(0);
    expect(storage.calls).not.toContain("remove");
    for (const k of ["giao", "lazada", "huy-ngang", "khong-khop"]) expect((await row(k)).status).toBe("STORED");
    expect(await row("hoan-muon")).toMatchObject({ deleteAfter: null, deleteRule: null, holdReason: "RETURN_OPEN" });
  });

  it("BẬT xóa thật: xóa tệp trên kho rồi mới đánh dấu DELETED; video đang giữ không đụng", async () => {
    const storage = createFakeStorage();
    const g = await row("giao");
    storage.put(g.objectKey, 6_000_000);
    const r = await processDueVideos({
      now: () => new Date("2026-12-05T03:00:00.000Z"), // chỉ L1, L2, L4 Shopee tới hạn
      deleteEnabled: true,
      storage: () => storage,
      onlyOwnerId: owner,
    });
    expect(r.deleted).toBe(3);
    expect(storage.objects.has(g.objectKey)).toBe(false);
    expect((await row("giao")).status).toBe("DELETED");
    expect((await row("lazada")).status).toBe("STORED"); // hạn 16/12 chưa tới
    expect((await row("hoan")).status).toBe("STORED");
    expect((await row("khui-khong-khop")).status).toBe("STORED");
  });

  it("giờ đã quay KHÔNG tụt khi dòng sổ video của ngày đã gộp biến mất (mô phỏng bỏ mảnh tháng)", async () => {
    const before = await usedSecondsOf(owner);
    expect(before).toBe(8 * 60); // STORED + DELETED đều tính
    const rolled = await rollUpUsageDaily(new Date("2026-11-25T03:00:00.000Z"));
    expect(rolled.watermark >= REC_DATE).toBe(true);
    expect(await usageWatermark()).toBe(rolled.watermark);
    await prisma.packVideo.deleteMany({ where: { ownerId: owner } }); // "bỏ mảnh"
    expect(await usedSecondsOf(owner)).toBe(before);
    // Gộp lại lần nữa khi sổ không còn dòng nào của ngày đó: số gộp giữ nguyên, không bị ghi thành 0.
    await rollUpUsageDaily(new Date("2026-11-26T03:00:00.000Z"));
    expect(await usedSecondsOf(owner)).toBe(before);
  });

  it("xóa tài khoản: SAU CỜ chỉ đếm; bật cờ thì xóa tệp + đánh dấu DELETED", async () => {
    await addVideo("purge-1", { orderKey: "giao" });
    await addVideo("purge-2", {});
    const storage = createFakeStorage();
    const off = await purgeOwnerPackVideos(owner, { enabled: false, storage: () => storage });
    expect(off).toMatchObject({ enabled: false, found: 2, deleted: 0 });
    expect(storage.calls).toHaveLength(0);
    expect((await row("purge-1")).status).toBe("STORED");

    const on = await purgeOwnerPackVideos(owner, { enabled: true, storage: () => storage });
    expect(on).toMatchObject({ enabled: true, found: 2, deleted: 2, errors: 0 });
    expect(storage.calls.filter((c) => c === "remove")).toHaveLength(2);
    expect(await row("purge-1")).toMatchObject({ status: "DELETED", deleteRule: "ACCOUNT" });
  });

  it("tới hạn mà KHỚP LẠI được tem (mã vận đơn cấp muộn) → gắn đơn, gỡ hạn, KHÔNG xóa", async () => {
    await addOrder("cap-muon", chShopee, { shippingStatus: ShippingStatus.SHIPPING });
    // Lúc quay đơn chưa về sổ → video không khớp; tem mang đúng mã vận đơn của đơn về sau.
    await addVideo("muon", { trackingCode: `${TAG}-VD-cap-muon` });
    await assignRetention({ now: () => NOW, onlyOwnerId: owner });
    expect(await row("muon")).toMatchObject({ deleteRule: "L1" });
    const storage = createFakeStorage();
    const r = await processDueVideos({
      now: () => new Date("2026-11-20T03:00:00.000Z"),
      deleteEnabled: true,
      storage: () => storage,
      onlyOwnerId: owner,
    });
    expect(r).toMatchObject({ rematched: 1, deleted: 0 });
    expect(storage.calls).not.toContain("remove");
    expect(await row("muon")).toMatchObject({ status: "STORED", deleteAfter: null, deleteRule: null });
    const linked = await prisma.packVideo.findFirstOrThrow({ where: { ownerId: owner, id: videoIds.muon }, select: { orderId: true } });
    expect(linked.orderId).toBe(orderIds["cap-muon"]);
  });

  it("đơn hoàn: xóa sau HẠN KHIẾU NẠI 3 ngày; sàn dời hạn muộn hơn thì ghi hạn mới, chưa xóa", async () => {
    const delivered = new Date("2026-11-13T05:00:00.000Z");
    await addOrder("hoan-han", chShopee, {
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: delivered,
      returnStatus: ReturnStatus.AWAITING,
      returnComplaintDueAt: new Date("2026-11-19T07:00:00.000Z"), // 19/11 14:00 VN
    });
    await addVideo("hoan-han", { orderKey: "hoan-han" });
    await assignRetention({ now: () => NOW, onlyOwnerId: owner });
    expect(await row("hoan-han")).toMatchObject({ deleteRule: "L7", holdReason: null });
    expect(day((await row("hoan-han")).deleteAfter)).toBe("2026-11-22"); // hạn 19/11 + 3

    // Sàn đặt lại hạn (kiện về muộn hơn dự kiến) → 25/11.
    await prisma.order.update({
      where: { id: orderIds["hoan-han"] },
      data: { returnComplaintDueAt: new Date("2026-11-25T07:00:00.000Z") },
    });
    const storage = createFakeStorage();
    const first = await processDueVideos({
      now: () => new Date("2026-11-23T03:00:00.000Z"),
      deleteEnabled: true,
      storage: () => storage,
      onlyOwnerId: owner,
    });
    expect(first).toMatchObject({ postponed: 1, deleted: 0 });
    expect(day((await row("hoan-han")).deleteAfter)).toBe("2026-11-28");
    expect((await row("hoan-han")).status).toBe("STORED");

    const second = await processDueVideos({
      now: () => new Date("2026-11-29T03:00:00.000Z"),
      deleteEnabled: true,
      storage: () => storage,
      onlyOwnerId: owner,
    });
    expect(second.deleted).toBe(1);
    expect(await row("hoan-han")).toMatchObject({ status: "DELETED", deleteRule: "L7" });

    // Tab Lịch sử xóa: thấy đúng video vừa xóa kèm mã luật; ô tìm theo đầu mã vận đơn (gõ chữ thường cũng ra).
    const scope = { ownerId: owner, allowedChannelIds: null };
    const history = await listDeletedVideos(scope, {});
    expect(history.items.find((v) => v.id === videoIds["hoan-han"])).toMatchObject({ deleteRule: "L7", kind: "PACK" });
    expect(history.items.every((v) => v.deletedAt !== null)).toBe(true);
    const code = (await prisma.packVideo.findFirstOrThrow({ where: { ownerId: owner, id: videoIds["hoan-han"] }, select: { trackingCode: true } })).trackingCode;
    expect((await listDeletedVideos(scope, { q: code.slice(0, code.length - 1) })).items.map((v) => v.id)).toContain(videoIds["hoan-han"]);
    expect((await listDeletedVideos(scope, { q: "khong-co-ma-nay" })).items).toEqual([]);
    // Video còn lưu không lọt vào lịch sử xóa.
    expect(history.items.some((v) => v.id === videoIds.muon)).toBe(false);
  });

  it("lượt tải lên dở dang quá 7 ngày: chạy bóng chỉ đếm; bật thì hủy lượt tải + xóa mảnh + đánh dấu LOST", async () => {
    const mk = async (suffix: string, createdAt: Date) => {
      const id = `${TAG.replace(/-/g, "")}p${suffix}`;
      await prisma.packVideo.create({
        data: {
          id,
          recordedDate: new Date(`${REC_DATE}T00:00:00.000Z`),
          ownerId: owner,
          clientId: `${TAG}-p${suffix}`,
          trackingCode: `${TAG}-P${suffix}`,
          kind: "PACK",
          recordedById: owner,
          recordedAt: new Date(`${REC_DATE}T03:00:00.000Z`),
          durationSec: 60,
          sizeBytes: BigInt(40_000_000),
          objectKey: buildPackVideoKey({ ownerId: owner, recordedDate: REC_DATE, id }),
          uploadId: `up-${suffix}`,
          status: "PENDING",
          createdAt,
        },
      });
      return id;
    };
    const stale = await mk("cu", new Date("2026-11-10T03:00:00.000Z")); // 8 ngày trước NOW
    const fresh = await mk("moi", new Date("2026-11-15T03:00:00.000Z")); // 3 ngày trước NOW
    const statusOf = async (id: string) =>
      (await prisma.packVideo.findFirstOrThrow({ where: { ownerId: owner, id }, select: { status: true } })).status;

    const storage = createFakeStorage();
    const shadow = await sweepStalePending({ now: () => NOW, deleteEnabled: false, storage: () => storage, onlyOwnerId: owner });
    expect(shadow).toMatchObject({ shadow: true, found: 1, cleared: 0 });
    expect(storage.calls).toHaveLength(0);
    expect(await statusOf(stale)).toBe("PENDING");

    const real = await sweepStalePending({ now: () => NOW, deleteEnabled: true, storage: () => storage, onlyOwnerId: owner });
    expect(real).toMatchObject({ shadow: false, found: 1, cleared: 1, errors: 0 });
    expect(storage.calls).toEqual(expect.arrayContaining(["abortMultipart", "remove"]));
    expect(await statusOf(stale)).toBe("LOST");
    expect(await statusOf(fresh)).toBe("PENDING");
  });
});
