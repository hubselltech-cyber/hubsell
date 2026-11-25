// ============================================================
// VIDEO ĐÓNG HÀNG — chuông báo trước khi xóa, trên Postgres thật (26/11/2026, lỗ hổng G7).
// Rào kiểm: chỉ video ĐANG GIỮ làm bằng chứng chạm trần 60 ngày mới được đếm (kho báo hỏng, đơn hoàn còn mở,
// video khui chưa khớp đơn) — video chạm trần vì đơn treo / vì hạn thường rơi quá trần thì KHÔNG ·
// CHẠY BÓNG chỉ đếm, không phát chuông · bật xóa thật: MỘT chuông cho một chủ shop, đúng số video, đúng ngày ·
// mỗi video chỉ báo một lần (mốc ở maintenance_jobs) · tiêu đề ≤ 70 ký tự.
// Tự tạo dữ liệu rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { buildPackVideoKey } from "../../../lib/pack-video-key";
import { prisma } from "../../../lib/prisma";
import type { NotifyInput } from "../../notifications";
import { categoryOf } from "../../notification-categories";
import { CAP_NOTICE_JOB_KEY, CAP_NOTICE_LINK, CAP_NOTICE_TYPE, capNoticeText, notifyCapExpiring } from "../cap-notice";
import { assignRetention } from "../retention";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvc-${Date.now()}`;
// Lúc xét: 26/11/2026 10:00 VN. Video quay 29/09 → trần 60 ngày = 28/11 (còn 2 ngày).
const NOW = new Date("2026-11-26T03:00:00.000Z");
const REC_DATE = "2026-09-29";
const CAP_DATE = "2026-11-28";

describe("câu chữ chuông chạm trần", () => {
  it("tiêu đề ≤ 70 ký tự kể cả số video lớn; nói rõ số video và ngày", () => {
    for (const n of [1, 12, 99_999]) {
      const t = capNoticeText(n, CAP_DATE);
      expect(t.title.length, t.title).toBeLessThanOrEqual(70);
      expect(t.title).toContain(`${n} video`);
      expect(t.title).toContain("28/11");
      expect(t.body).toContain("60 ngày");
    }
  });

  it("loại chuông xếp vào mục pack_video", () => {
    expect(categoryOf(CAP_NOTICE_TYPE)).toBe("pack_video");
  });
});

describe.skipIf(!dbReady)("Video đóng hàng — chuông báo video đang giữ sắp chạm trần", () => {
  let owner = "";
  let channel = "";
  const orderIds: Record<string, string> = {};
  let seq = 0;
  let savedJob: { cursor: string | null; processed: number } | null = null;

  async function addOrder(key: string, data: Record<string, unknown>) {
    const o = await prisma.order.create({
      data: { channelId: channel, orderCode: `${TAG}-${key}`, customerName: "Khách thử", trackingCode: `${TAG}-VD-${key}`, ...data },
      select: { id: true },
    });
    orderIds[key] = o.id;
  }

  async function addVideo(opts: { orderKey?: string; kind?: "PACK" | "UNBOX" }) {
    seq += 1;
    const id = `${TAG.replace(/-/g, "")}v${seq}`;
    const orderId = opts.orderKey ? orderIds[opts.orderKey] : null;
    await prisma.packVideo.create({
      data: {
        id,
        recordedDate: new Date(`${REC_DATE}T00:00:00.000Z`),
        ownerId: owner,
        clientId: `${TAG}-c${seq}`,
        channelId: orderId ? channel : null,
        orderId,
        trackingCode: `${TAG}-T${seq}`,
        kind: opts.kind ?? "PACK",
        recordedById: owner,
        recordedAt: new Date(`${REC_DATE}T03:00:00.000Z`),
        durationSec: 60,
        sizeBytes: BigInt(6_000_000),
        objectKey: buildPackVideoKey({ ownerId: owner, recordedDate: REC_DATE, id }),
        status: "STORED",
        uploadedAt: new Date(`${REC_DATE}T03:05:00.000Z`),
      },
    });
  }

  function spy() {
    const calls: { ownerId: string; input: NotifyInput }[] = [];
    return {
      calls,
      notifyOwner: async (ownerId: string, input: NotifyInput) => {
        calls.push({ ownerId, input });
        return { id: "x" };
      },
    };
  }

  beforeAll(async () => {
    savedJob = await prisma.maintenanceJob.findUnique({
      where: { key: CAP_NOTICE_JOB_KEY },
      select: { cursor: true, processed: true },
    });
    owner = (
      await prisma.user.create({
        data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
        select: { id: true },
      })
    ).id;
    channel = (
      await prisma.channel.create({ data: { userId: owner, channelName: ChannelName.SHOPEE, shopName: `${TAG}-sp` } })
    ).id;
    const delivered = new Date("2026-10-05T05:00:00.000Z");
    // Ba video ĐANG GIỮ làm bằng chứng:
    await addOrder("hong", { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: delivered, returnStatus: ReturnStatus.DAMAGED });
    await addOrder("mo", { shippingStatus: ShippingStatus.DELIVERED, deliveredAt: delivered, returnStatus: ReturnStatus.AWAITING });
    // Hai video chạm trần nhưng KHÔNG phải đang giữ: đơn treo "đang giao"; đơn giao muộn (hạn thường rơi quá trần).
    await addOrder("treo", { shippingStatus: ShippingStatus.SHIPPING });
    await addOrder("giao-muon", {
      shippingStatus: ShippingStatus.DELIVERED,
      deliveredAt: new Date("2026-11-16T05:00:00.000Z"), // + 15 + 3 = 04/12 > trần 28/11
      stockShippedAt: delivered,
    });
    await addVideo({ orderKey: "hong" });
    await addVideo({ orderKey: "mo" });
    await addVideo({ kind: "UNBOX" });
    await addVideo({ orderKey: "treo" });
    await addVideo({ orderKey: "giao-muon" });
    await assignRetention({ now: () => NOW, onlyOwnerId: owner });
  });

  afterAll(async () => {
    if (savedJob) {
      await prisma.maintenanceJob.update({ where: { key: CAP_NOTICE_JOB_KEY }, data: savedJob });
    } else {
      await prisma.maintenanceJob.deleteMany({ where: { key: CAP_NOTICE_JOB_KEY } });
    }
    if (!owner) return;
    await prisma.packVideo.deleteMany({ where: { ownerId: owner } });
    await prisma.order.deleteMany({ where: { channelId: channel } });
    await prisma.channel.deleteMany({ where: { id: channel } });
    await prisma.user.deleteMany({ where: { id: owner } });
  });

  it("cả năm video đều được ghi hạn = trần (luật L6) từ trước trần 3 ngày", async () => {
    const rows = await prisma.packVideo.findMany({
      where: { ownerId: owner },
      select: { deleteRule: true, deleteAfter: true },
    });
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.deleteRule).toBe("L6");
      expect(r.deleteAfter?.toISOString().slice(0, 10)).toBe(CAP_DATE);
    }
  });

  it("CHẠY BÓNG: đếm đúng 3 video đang giữ, không phát chuông", async () => {
    const s = spy();
    const r = await notifyCapExpiring({ now: () => NOW, deleteEnabled: false, onlyOwnerId: owner, notifyOwner: s.notifyOwner });
    expect(r).toMatchObject({ scanned: 5, held: 3, owners: 1, notified: 0, shadow: true });
    expect(s.calls).toHaveLength(0);
  });

  it("bật xóa thật: MỘT chuông cho chủ shop, đúng số video + ngày + đường dẫn", async () => {
    const s = spy();
    const r = await notifyCapExpiring({ now: () => NOW, deleteEnabled: true, onlyOwnerId: owner, notifyOwner: s.notifyOwner });
    expect(r).toMatchObject({ scanned: 5, held: 3, owners: 1, notified: 1, shadow: false });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].ownerId).toBe(owner);
    expect(s.calls[0].input).toMatchObject({ type: CAP_NOTICE_TYPE, link: CAP_NOTICE_LINK, dedupe: false });
    expect(s.calls[0].input.title).toBe("3 video đơn hoàn chưa xong sắp tự xóa — tải về trước 28/11");
  });

  it("đọc theo lô nhỏ vẫn ra cùng kết quả (con trỏ trong lượt)", async () => {
    const s = spy();
    const r = await notifyCapExpiring({
      now: () => NOW,
      deleteEnabled: true,
      onlyOwnerId: owner,
      notifyOwner: s.notifyOwner,
      batchSize: 2,
    });
    expect(r).toMatchObject({ scanned: 5, held: 3, notified: 1 });
  });

  it("video đã tới hạn (hạn ≤ hôm nay) không báo nữa — pha tới hạn xử lý", async () => {
    const s = spy();
    const r = await notifyCapExpiring({
      now: () => new Date("2026-11-28T03:00:00.000Z"),
      deleteEnabled: true,
      onlyOwnerId: owner,
      notifyOwner: s.notifyOwner,
    });
    expect(r.scanned).toBe(0);
    expect(s.calls).toHaveLength(0);
  });

  it("mỗi video chỉ báo MỘT lần: lượt chạy thật thứ hai trong ngày không phát gì", async () => {
    await prisma.maintenanceJob.deleteMany({ where: { key: CAP_NOTICE_JOB_KEY } });
    const first = spy();
    await notifyCapExpiring({ now: () => NOW, deleteEnabled: true, notifyOwner: first.notifyOwner });
    expect(first.calls.filter((c) => c.ownerId === owner)).toHaveLength(1);
    const job = await prisma.maintenanceJob.findUnique({ where: { key: CAP_NOTICE_JOB_KEY }, select: { cursor: true } });
    expect(job?.cursor).toBe("2026-11-29"); // hôm nay + 3

    const second = spy();
    const r = await notifyCapExpiring({ now: () => NOW, deleteEnabled: true, notifyOwner: second.notifyOwner });
    expect(r.scanned).toBe(0);
    expect(second.calls).toHaveLength(0);

    // Chạy bóng không dời mốc.
    await prisma.maintenanceJob.deleteMany({ where: { key: CAP_NOTICE_JOB_KEY } });
    await notifyCapExpiring({ now: () => NOW, deleteEnabled: false, notifyOwner: spy().notifyOwner });
    expect(await prisma.maintenanceJob.findUnique({ where: { key: CAP_NOTICE_JOB_KEY } })).toBeNull();
  });
});
