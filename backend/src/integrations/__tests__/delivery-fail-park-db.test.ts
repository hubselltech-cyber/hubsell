// ============================================================
// VÉ CỨU ĐƠN ĐÃ AN BÀI THÌ ĐỖ, KHÔNG XÓA (12/10/2026 — lát C băng thông worker)
//
// Lỗi cũ: vé DETECT gặp tracking "đã giao" bị XÓA, nhưng Order vẫn SHIPPING
// (Shopee để TO_CONFIRM_RECEIVE nhiều ngày) → nhịp 10' sau bước phát vé tạo
// lại vé → gọi tracking → xóa… vô hạn (prod ~50 nghìn call + 50 nghìn DELETE
// mỗi ngày). Kiểm trên DB dev, tầng gọi sàn mock:
//   · nhịp 1: phát vé + hỏi tracking (1 call) → vé còn, hẹn lại ~24h;
//   · nhịp 2: vé chưa tới hạn → KHÔNG phát vé mới, KHÔNG gọi sàn;
//   · đồng bộ đơn đổi DELIVERED → nhịp 3 bước dọn xóa vé, không gọi sàn.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName, DeliveryTrackingTaskKind, ShippingStatus } from "@prisma/client";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, getTrackingInfo: vi.fn() };
});

import { prisma } from "../../lib/prisma";
import { getTrackingInfo } from "../shopee/client";
import { DETECT_SETTLED_PARK_MS, processShopeeDeliveryTracking } from "../shopee/delivery-fail";

const tracking = vi.mocked(getTrackingInfo);

describe("processShopeeDeliveryTracking — vé 'đã giao' đỗ lại thay vì xóa-tạo lặp", () => {
  const stamp = Date.now();
  let userId: string;
  let channelId: string;
  let orderId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-df-park-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST df park", role: "ADMIN" },
    });
    userId = user.id;
    const ch = await prisma.channel.create({
      data: {
        userId,
        channelName: ChannelName.SHOPEE,
        shopName: "TEST-DF-PARK",
        externalShopId: `7${stamp}`,
        apiToken: "test-access-token",
        refreshToken: "test-refresh-token",
        accessTokenExpireAt: new Date(Date.now() + 6 * 3600_000),
        status: "ACTIVE",
      },
    });
    channelId = ch.id;
    const order = await prisma.order.create({
      data: {
        channelId,
        orderCode: `TEST-DF-PARK-${stamp}`,
        customerName: "Khách test",
        totalAmount: 100000,
        paymentStatus: "PAID",
        shippingStatus: ShippingStatus.SHIPPING,
        trackingCode: `SPX${stamp}`,
        itemCount: 1,
      },
      select: { id: true },
    });
    orderId = order.id;
    tracking.mockReset();
    tracking.mockResolvedValue({
      response: {
        logistics_status: "LOGISTICS_DELIVERY_DONE",
        tracking_info: [
          { logistics_status: "PICKED_UP", update_time: Math.floor(stamp / 1000) - 7200, description: "Đang giao hàng" },
          { logistics_status: "DELIVERED", update_time: Math.floor(stamp / 1000) - 3600, description: "Giao hàng thành công" },
        ],
      },
    } as Awaited<ReturnType<typeof getTrackingInfo>>);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });

  async function channel() {
    return prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  }
  async function task() {
    return prisma.deliveryTrackingTask.findUnique({ where: { orderId } });
  }

  it("nhịp 1 phát vé + 1 call; vé đỗ ~24h, không bị xóa", async () => {
    const before = Date.now();
    const r1 = await processShopeeDeliveryTracking(await channel());
    expect(r1.enqueued).toBe(1);
    expect(r1.ran).toBe(1);
    expect(tracking).toHaveBeenCalledTimes(1);
    const t = await task();
    expect(t).not.toBeNull();
    expect(t!.kind).toBe(DeliveryTrackingTaskKind.DETECT);
    expect(t!.nextRunAt.getTime()).toBeGreaterThanOrEqual(before + DETECT_SETTLED_PARK_MS - 5_000);
  });

  it("nhịp 2: vé chưa tới hạn → không phát vé mới, không gọi sàn", async () => {
    const r2 = await processShopeeDeliveryTracking(await channel());
    expect(r2.enqueued).toBe(0);
    expect(r2.ran).toBe(0);
    expect(tracking).toHaveBeenCalledTimes(1);
    expect(await task()).not.toBeNull();
  });

  it("đồng bộ đơn đổi DELIVERED → nhịp 3 bước dọn xóa vé, vẫn không gọi sàn", async () => {
    await prisma.order.update({ where: { id: orderId }, data: { shippingStatus: ShippingStatus.DELIVERED } });
    const r3 = await processShopeeDeliveryTracking(await channel());
    expect(r3.cleaned).toBe(1);
    expect(r3.enqueued).toBe(0);
    expect(r3.ran).toBe(0);
    expect(tracking).toHaveBeenCalledTimes(1);
    expect(await task()).toBeNull();
  });
});
