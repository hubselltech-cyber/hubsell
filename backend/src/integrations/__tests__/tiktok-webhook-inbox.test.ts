// ============================================================
// WEBHOOK TIKTOK QUA HÀNG ĐỢI BỀN pg-boss (giai đoạn 2 bước 2 — docs/HANG-DOI-BEN.md)
//
// Cùng cách dựng với tiktok-webhook-queue.test.ts (test đó giữ nguyên, kiểm
// đường CŨ — chạy khi hàng đợi bền chưa khởi động). Ở đây hàng đợi bền được bật
// nên route đi đường MỚI: webhook_events + evt.order / evt.auth. Tầng gọi sàn
// (getOrderDetail) được mock, mọi thứ còn lại chạy thật trên DB dev.
//
//   1. Đơn AWAITING_SHIPMENT: ack 200, dòng sự kiện SUCCESS, Order tạo, kho trừ đúng.
//   2. Gửi lại Y NGUYÊN → duplicate, kho không trừ đôi.
//   3. Sự kiện ủy quyền của shop chưa nối → evt.auth xử lý, dòng SUCCESS kèm ghi chú.
//   4. Sàn lỗi: dòng giữ PENDING + ghi lỗi; hết lượt → FAILED + cảnh báo chủ shop.
//   5. Việc ủy quyền hết lượt → dòng FAILED + cảnh báo cấp gian.
//   6. TIKTOK_WEBHOOK_MODE=legacy → về hàng đợi cũ (tiktok_webhook_logs).
// ============================================================
import "./load-env";
import crypto from "crypto";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName, WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { startQueue, stopQueue } from "../../lib/queue";
import { registerEventQueueWorkers, runDeadEventJob } from "../../workers/event-queue";
import { createStockFixture, type StockFixture } from "./fixtures";
import { getOrderDetail } from "../tiktok/client";

vi.mock("../tiktok/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/client")>();
  return { ...mod, getOrderDetail: vi.fn().mockResolvedValue([]) };
});

process.env.TIKTOK_APP_KEY ??= "test-app-key";
process.env.TIKTOK_APP_SECRET ??= "test-app-secret";
process.env.TIKTOK_SERVICE_ID ??= "test-service";

let server: Server;
let baseUrl: string;
let fx: StockFixture;
let channelId: string;
let productId: string;
const SHOP_ID = `78${Date.now()}`;
const UNKNOWN_SHOP_ID = `79${Date.now()}`;
const SKU = `TEST-TTKQ-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sign(raw: string): string {
  return crypto
    .createHmac("sha256", process.env.TIKTOK_APP_SECRET!)
    .update(`${process.env.TIKTOK_APP_KEY}${raw}`)
    .digest("hex");
}

async function postWebhook(body: unknown) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${baseUrl}/api/webhooks/tiktok`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: sign(raw) },
    body: raw,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function orderEvent(orderId: string, status: string, ts: number) {
  return {
    type: 1,
    tts_notification_id: `ntf-${orderId}-${ts}`,
    shop_id: SHOP_ID,
    timestamp: Math.floor(ts / 1000),
    data: { order_id: orderId, order_status: status, is_on_hold_order: false, update_time: ts },
  };
}

function mockOrder(orderId: string, status: string, qty: number) {
  vi.mocked(getOrderDetail).mockResolvedValue([
    {
      id: orderId,
      status,
      create_time: Math.floor(Date.now() / 1000),
      payment: { total_amount: String(150000 * qty), currency: "VND" },
      recipient_address: { name: "Khách test", phone_number: "0900000000" },
      line_items: Array.from({ length: qty }, (_, i) => ({
        id: `li-${orderId}-${i}`,
        seller_sku: SKU,
        product_name: "SP test TikTok",
        sale_price: "150000",
      })),
    },
  ] as never);
}

const eventsOf = (where: { shopId: string; entityId?: string | null }) =>
  prisma.webhookEvent.findMany({ where: { source: "TIKTOK", ...where }, orderBy: { createdAt: "asc" } });

async function waitForEvents(
  where: { shopId: string; entityId?: string | null },
  done: (rows: Awaited<ReturnType<typeof eventsOf>>) => boolean
) {
  const deadline = Date.now() + 12_000;
  for (;;) {
    const rows = await eventsOf(where);
    if (done(rows)) return rows;
    if (Date.now() > deadline) {
      throw new Error(`Hết 12s chờ sự kiện ${JSON.stringify(where)}: ${rows.map((r) => `${r.status}/${r.attempts}`).join(", ") || "chưa có dòng"}`);
    }
    await sleep(100);
  }
}

const stockNow = async () =>
  (await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { quantityInStock: true } })).quantityInStock;

beforeAll(async () => {
  fx = await createStockFixture("ttkq");
  const ch = await prisma.channel.create({
    data: {
      userId: fx.userId,
      channelName: ChannelName.TIKTOK,
      shopName: `TEST-TTKQ-${fx.suffix}`,
      externalShopId: SHOP_ID,
      apiToken: "test-access-token",
      refreshToken: "test-refresh-token",
      shopCipher: "test-cipher",
      accessTokenExpireAt: new Date(Date.now() + 24 * 3600 * 1000),
      refreshTokenExpireAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      status: "ACTIVE",
    },
  });
  channelId = ch.id;
  productId = await fx.createProduct(10);
  await prisma.channelProduct.create({
    data: { channelId, productId, channelSku: SKU, productName: "SP test TikTok", status: "ACTIVE" },
  });

  expect(await startQueue("all"), "hàng đợi không khởi động — DB dev đã áp migration queue_foundation chưa?").toBe(true);
  await registerEventQueueWorkers();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await stopQueue(5000);
  delete process.env.TIKTOK_WEBHOOK_MODE;
  await prisma.webhookEvent.deleteMany({ where: { source: "TIKTOK", shopId: { in: [SHOP_ID, UNKNOWN_SHOP_ID] } } });
  await prisma.tiktokWebhookLog.deleteMany({ where: { shopId: SHOP_ID } });
  await prisma.$executeRawUnsafe(
    `DELETE FROM pgboss.job WHERE name IN ('evt.order', 'evt.auth', 'evt.dead') AND data->>'shopId' IN ($1, $2)`,
    SHOP_ID,
    UNKNOWN_SHOP_ID
  );
  await fx.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Webhook TikTok — hộp thư đến + hàng đợi bền pg-boss", () => {
  it("đơn AWAITING_SHIPMENT: sự kiện SUCCESS, Order tạo mới, kho trừ đúng; gửi lại y nguyên không trừ đôi", async () => {
    const orderId = "TTKQ-1001";
    mockOrder(orderId, "AWAITING_SHIPMENT", 2);
    const body = orderEvent(orderId, "AWAITING_SHIPMENT", 1_700_000_000_000);
    const res = await postWebhook(body);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, type: 1, queued: true, duplicate: false });

    const [row] = await waitForEvents({ shopId: SHOP_ID, entityId: orderId }, (rows) => rows.length === 1 && rows[0].status === WebhookJobStatus.SUCCESS);
    expect(row.eventType).toBe("1");
    expect(row.attempts).toBe(1);
    expect(await prisma.order.findFirst({ where: { channelId, orderCode: orderId } })).not.toBeNull();
    expect(await stockNow()).toBe(8);
    // Đường mới không ghi gì vào bảng hàng đợi cũ.
    expect(await prisma.tiktokWebhookLog.count({ where: { shopId: SHOP_ID } })).toBe(0);

    const again = await postWebhook(body);
    expect(again.json).toMatchObject({ queued: false, duplicate: true });
    await sleep(800);
    expect(await eventsOf({ shopId: SHOP_ID, entityId: orderId })).toHaveLength(1);
    expect(await stockNow()).toBe(8);
  });

  it("sự kiện ủy quyền của shop chưa nối: evt.auth xử lý, dòng SUCCESS kèm ghi chú", async () => {
    const res = await postWebhook({ type: 6, shop_id: UNKNOWN_SHOP_ID, timestamp: 1_700_000_001, data: {} });
    expect(res.json).toMatchObject({ ok: true, type: 6, queued: true, duplicate: false });
    const [row] = await waitForEvents({ shopId: UNKNOWN_SHOP_ID }, (rows) => rows.length === 1 && rows[0].status === WebhookJobStatus.SUCCESS);
    expect(row.entityId).toBeNull();
    expect(row.lastError).toBe("shop chưa kết nối Hubsell");
  });

  it("sàn lỗi: dòng giữ PENDING + ghi lỗi; hết lượt thử → FAILED + cảnh báo cho chủ shop", async () => {
    const orderId = "TTKQ-1002";
    vi.mocked(getOrderDetail).mockRejectedValue(new Error("TikTok 5xx giả lập"));
    await postWebhook(orderEvent(orderId, "AWAITING_SHIPMENT", 1_700_000_100_000));
    const [row] = await waitForEvents({ shopId: SHOP_ID, entityId: orderId }, (rows) => rows.length === 1 && rows[0].attempts === 1);
    expect(row.status).toBe(WebhookJobStatus.PENDING);
    expect(row.lastError).toContain("TikTok 5xx giả lập");

    // Việc còn đang chờ thử lại → hàng đợi lỗi chưa được kết luận.
    await runDeadEventJob({ source: "TIKTOK", shopId: SHOP_ID, orderId });
    expect((await eventsOf({ shopId: SHOP_ID, entityId: orderId }))[0].status).toBe(WebhookJobStatus.PENDING);
    // Việc hết lượt (giả lập bằng cách gỡ khỏi hàng đợi) → FAILED + cảnh báo.
    await prisma.$executeRawUnsafe(
      `DELETE FROM pgboss.job WHERE name = 'evt.order' AND singleton_key = $1`,
      `TIKTOK:${SHOP_ID}:${orderId}`
    );
    await runDeadEventJob({ source: "TIKTOK", shopId: SHOP_ID, orderId });
    expect((await eventsOf({ shopId: SHOP_ID, entityId: orderId }))[0].status).toBe(WebhookJobStatus.FAILED);
    const alert = await prisma.inventorySyncAlert.findFirst({ where: { channelId, orderSn: orderId } });
    expect(alert?.message).toContain(`sự kiện TikTok đơn ${orderId} xử lý thất bại sau 3 lần`);
  });

  it("việc ủy quyền hết lượt thử → dòng FAILED + cảnh báo cấp gian (không gắn đơn)", async () => {
    const eventId = crypto.randomUUID();
    await prisma.webhookEvent.create({
      data: {
        id: eventId,
        source: "TIKTOK",
        eventType: "6",
        shopId: SHOP_ID,
        bodyHash: `test-auth-dead-${eventId}`,
        payload: "{}",
        attempts: 3,
        lastError: "lỗi giả lập khi xử lý ủy quyền",
      },
    });
    await runDeadEventJob({ source: "TIKTOK", shopId: SHOP_ID, eventId });
    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.status).toBe(WebhookJobStatus.FAILED);
    const alert = await prisma.inventorySyncAlert.findFirst({
      where: { channelId, orderSn: null, message: { contains: "lỗi giả lập khi xử lý ủy quyền" } },
    });
    expect(alert?.message).toContain("sự kiện TikTok xử lý thất bại sau 3 lần");

    // Gọi lại lần nữa: dòng đã FAILED thì không làm gì thêm.
    await runDeadEventJob({ source: "TIKTOK", shopId: SHOP_ID, eventId });
    expect(await prisma.inventorySyncAlert.count({ where: { channelId, orderSn: null } })).toBe(1);
  });

  it("TIKTOK_WEBHOOK_MODE=legacy → về hàng đợi cũ tiktok_webhook_logs, không ghi hộp thư đến", async () => {
    const orderId = "TTKQ-1003";
    process.env.TIKTOK_WEBHOOK_MODE = "legacy";
    const res = await postWebhook(orderEvent(orderId, "AWAITING_SHIPMENT", 1_700_000_200_000));
    delete process.env.TIKTOK_WEBHOOK_MODE;
    expect(res.json).toMatchObject({ ok: true, queued: true, duplicate: false });
    expect(await prisma.tiktokWebhookLog.count({ where: { shopId: SHOP_ID, orderId } })).toBe(1);
    expect(await eventsOf({ shopId: SHOP_ID, entityId: orderId })).toHaveLength(0);
  });
});
