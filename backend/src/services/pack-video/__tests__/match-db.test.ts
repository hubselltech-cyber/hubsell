// ============================================================
// VIDEO ĐÓNG HÀNG — matchTem(): màn quay hỏi "tem này khớp đơn nào" lúc đang quay.
// Rào kiểm: chính chủ thấy đúng đơn + gian · shop khác hỏi cùng mã thì KHÔNG thấy (S1) · mã lạ → không khớp ·
// hai đơn cùng mã vận đơn → không khớp (D5, cùng luật với bước tải lên) · nhân viên bị giới hạn gian
// không thấy đơn của gian khác (S7).
// Postgres thật. Tự tạo hai chủ shop rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { matchTem } from "../library";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvm-${Date.now()}`;

describe.skipIf(!dbReady)("Video đóng hàng — tra đơn theo tem lúc đang quay", () => {
  let ownerA = "";
  let ownerB = "";
  let channelA = "";
  let channelA2 = "";
  let channelB = "";

  beforeAll(async () => {
    const [a, b] = await Promise.all(
      ["a", "b"].map((s) =>
        prisma.user.create({
          data: { email: `${TAG}-${s}@test.local`, passwordHash: "x", fullName: `${TAG}-${s}` },
          select: { id: true },
        })
      )
    );
    ownerA = a.id;
    ownerB = b.id;
    channelA = (
      await prisma.channel.create({
        data: { userId: ownerA, channelName: ChannelName.SHOPEE, shopName: `${TAG} gian A` },
        select: { id: true },
      })
    ).id;
    channelA2 = (
      await prisma.channel.create({
        data: { userId: ownerA, channelName: ChannelName.TIKTOK, shopName: `${TAG} gian A2` },
        select: { id: true },
      })
    ).id;
    channelB = (
      await prisma.channel.create({
        data: { userId: ownerB, channelName: ChannelName.LAZADA, shopName: `${TAG} gian B` },
        select: { id: true },
      })
    ).id;
    await prisma.order.createMany({
      data: [
        { channelId: channelA, orderCode: `${TAG}-D1`, customerName: "Khách thử", trackingCode: `${TAG}VD1` },
        // Hai đơn CÙNG mã vận đơn → không được khớp đơn nào.
        { channelId: channelA, orderCode: `${TAG}-D2`, customerName: "Khách thử", trackingCode: `${TAG}TRUNG` },
        { channelId: channelA2, orderCode: `${TAG}-D3`, customerName: "Khách thử", trackingCode: `${TAG}TRUNG` },
        { channelId: channelB, orderCode: `${TAG}-B1`, customerName: "Khách thử", trackingCode: `${TAG}VDB` },
      ],
    });
  });

  afterAll(async () => {
    const channels = [channelA, channelA2, channelB].filter(Boolean);
    if (channels.length) {
      await prisma.order.deleteMany({ where: { channelId: { in: channels } } });
      await prisma.channel.deleteMany({ where: { id: { in: channels } } });
    }
    const owners = [ownerA, ownerB].filter(Boolean);
    if (owners.length) await prisma.user.deleteMany({ where: { id: { in: owners } } });
  });

  it("chính chủ: ra đúng đơn, đúng sàn và tên gian", async () => {
    const { order } = await matchTem({ ownerId: ownerA, allowedChannelIds: null }, `${TAG}VD1`);
    expect(order).not.toBeNull();
    expect(order?.orderCode).toBe(`${TAG}-D1`);
    expect(order?.channelPlatform).toBe(ChannelName.SHOPEE);
    expect(order?.shopName).toBe(`${TAG} gian A`);
    expect(Array.isArray(order?.items)).toBe(true);
  });

  it("shop khác hỏi đúng mã đó: không thấy gì; và ngược lại", async () => {
    expect((await matchTem({ ownerId: ownerB, allowedChannelIds: null }, `${TAG}VD1`)).order).toBeNull();
    expect((await matchTem({ ownerId: ownerA, allowedChannelIds: null }, `${TAG}VDB`)).order).toBeNull();
  });

  it("mã không có đơn nào → không khớp", async () => {
    expect((await matchTem({ ownerId: ownerA, allowedChannelIds: null }, `${TAG}KHONGCO`)).order).toBeNull();
  });

  it("hai đơn cùng mã vận đơn → không khớp đơn nào (không đoán)", async () => {
    expect((await matchTem({ ownerId: ownerA, allowedChannelIds: null }, `${TAG}TRUNG`)).order).toBeNull();
  });

  it("nhân viên bị giới hạn gian: chỉ thấy đơn của gian mình", async () => {
    expect((await matchTem({ ownerId: ownerA, allowedChannelIds: [channelA2] }, `${TAG}VD1`)).order).toBeNull();
    expect((await matchTem({ ownerId: ownerA, allowedChannelIds: [channelA] }, `${TAG}VD1`)).order?.orderCode).toBe(`${TAG}-D1`);
  });
});
