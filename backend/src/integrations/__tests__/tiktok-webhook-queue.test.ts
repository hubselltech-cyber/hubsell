// ============================================================
// WEBHOOK TIKTOK SHOP — TEST LUỒNG HÀNG ĐỢI BỀN + WORKER (16/09/2026)
//
// Dựng app THẬT trên cổng ngẫu nhiên, bắn payload webhook có CHỮ KÝ THẬT
// (HMAC app_secret trong backend/.env) vào /api/webhooks/tiktok. Tầng gọi sàn
// (getOrderDetail) được mock — mọi thứ còn lại (route, hàng đợi, worker,
// upsert đơn, trừ kho) chạy thật trên DB dev. Kiểm 5 hành vi:
//
//   1. Chữ ký sai → 401, không ghi gì.
//   2. Sự kiện ngoài phạm vi (type 4 sản phẩm) → 200 ignored, hàng đợi trống.
//   3. Đơn AWAITING_SHIPMENT: ack 200 nhanh, job SUCCESS, Order tạo mới,
//      tồn kho SKU đã liên kết bị trừ đúng số lượng.
//   4. Gửi lại Y NGUYÊN body → duplicate, hàng đợi vẫn 1 dòng, kho không trừ đôi.
//   5. Sàn lỗi tạm thời → job quay về PENDING hẹn retry ~30s (không FAILED ngay).
// ============================================================
import "./load-env";
import crypto from "crypto";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelName, WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { createStockFixture, type StockFixture } from "./fixtures";
import { getOrderDetail } from "../tiktok/client";
import { drainTiktokWebhookQueueOnce } from "../tiktok/webhook-queue";

vi.mock("../tiktok/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/client")>();
  return { ...mod, getOrderDetail: vi.fn().mockResolvedValue([]) };
});

// Test cần cấu hình TikTok để route không trả 503 — đặt giá trị giả nếu .env thiếu.
process.env.TIKTOK_APP_KEY ??= "test-app-key";
process.env.TIKTOK_APP_SECRET ??= "test-app-secret";
process.env.TIKTOK_SERVICE_ID ??= "test-service";

let server: Server;
let baseUrl: string;
let fx: StockFixture;
let tiktokChannelId: string;
let productId: string;
const SHOP_ID = `77${Date.now()}`;
const SKU = `TEST-TTK-${Date.now()}`;

function sign(raw: string): string {
  return crypto
    .createHmac("sha256", process.env.TIKTOK_APP_SECRET!)
    .update(`${process.env.TIKTOK_APP_KEY}${raw}`)
    .digest("hex");
}

async function postWebhook(body: unknown, opts: { badSignature?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/webhooks/tiktok`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: opts.badSignature ? "deadbeef" : sign(raw),
    },
    body: raw,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, elapsedMs: Date.now() - started };
}

function orderEvent(orderId: string, status: string, ts = Date.now()) {
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
      status, // tên thật của trường trạng thái (đối chiếu payload 16/09)
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
  ]);
}

async function waitForJob(
  orderId: string,
  done: (job: {
    status: WebhookJobStatus;
    attempts: number;
    nextRetryAt: Date | null;
    eventType: number;
  }) => boolean
) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const job = await prisma.tiktokWebhookLog.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
    });
    if (job && done(job)) return job;
    if (Date.now() > deadline) {
      throw new Error(`Hết 10s chờ job đơn ${orderId} — trạng thái: ${job?.status ?? "chưa có"}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  fx = await createStockFixture("tiktok");
  // Gian TikTok đã ủy quyền thật: token còn hạn dài → không cần refresh (không gọi sàn).
  const ch = await prisma.channel.create({
    data: {
      userId: fx.userId,
      channelName: ChannelName.TIKTOK,
      shopName: `TEST-TTK-${fx.suffix}`,
      externalShopId: SHOP_ID,
      apiToken: "test-access-token",
      refreshToken: "test-refresh-token",
      shopCipher: "test-cipher",
      accessTokenExpireAt: new Date(Date.now() + 24 * 3600 * 1000),
      refreshTokenExpireAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      status: "ACTIVE",
    },
  });
  tiktokChannelId = ch.id;
  productId = await fx.createProduct(10);
  await prisma.channelProduct.create({
    data: {
      channelId: ch.id,
      productId,
      channelSku: SKU,
      productName: "SP test TikTok",
      status: "ACTIVE",
    },
  });

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await prisma.tiktokWebhookLog.deleteMany({ where: { shopId: SHOP_ID } });
  await fx.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Webhook TikTok Shop — hàng đợi bền", () => {
  it("chữ ký sai → 401 và không ghi gì vào hàng đợi", async () => {
    const res = await postWebhook(orderEvent("BAD-SIG", "AWAITING_SHIPMENT"), {
      badSignature: true,
    });
    expect(res.status).toBe(401);
    expect(await prisma.tiktokWebhookLog.count({ where: { orderId: "BAD-SIG" } })).toBe(0);
  });

  it("sự kiện ngoài phạm vi (type 4 sản phẩm) → ack 200 ignored, không vào hàng đợi", async () => {
    const res = await postWebhook({
      type: 4,
      shop_id: SHOP_ID,
      timestamp: 1,
      data: { product_id: "p1", status: "ACTIVATE" },
    });
    expect(res.status).toBe(200);
    expect(res.json.ignored).toBe(true);
    expect(await prisma.tiktokWebhookLog.count({ where: { shopId: SHOP_ID } })).toBe(0);
  });

  it("đơn AWAITING_SHIPMENT: ack nhanh, worker tạo Order + trừ kho SKU đã liên kết", async () => {
    const orderId = `TTK-${fx.suffix}-1`;
    mockOrder(orderId, "AWAITING_SHIPMENT", 2);

    const res = await postWebhook(orderEvent(orderId, "AWAITING_SHIPMENT"));
    expect(res.status).toBe(200);
    expect(res.json.queued).toBe(true);
    expect(res.elapsedMs).toBeLessThan(3000);

    const job = await waitForJob(orderId, (j) => j.status === WebhookJobStatus.SUCCESS);
    expect(job.attempts).toBe(1);

    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: tiktokChannelId, orderCode: orderId } },
      include: { items: true },
    });
    expect(order).not.toBeNull();
    expect(order!.shippingStatus).toBe("PENDING");
    expect(Number(order!.totalAmount)).toBe(300000);
    // 2 line_items cùng SKU gộp thành 1 dòng qty 2 (202309 tách theo đơn vị).
    expect(order!.items).toHaveLength(1);
    expect(order!.items[0].quantity).toBe(2);
    expect(order!.stockDeductedAt).not.toBeNull();

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.quantityInStock).toBe(8);
  });

  it("gửi lại Y NGUYÊN body → duplicate, hàng đợi vẫn 1 dòng, kho không trừ đôi", async () => {
    const orderId = `TTK-${fx.suffix}-1`;
    const ts = 1_700_000_000_000;
    const body = orderEvent(orderId, "AWAITING_SHIPMENT", ts);
    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    await waitForJob(orderId, (j) => j.status === WebhookJobStatus.SUCCESS);

    const second = await postWebhook(body);
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    await drainTiktokWebhookQueueOnce();

    const jobs = await prisma.tiktokWebhookLog.findMany({ where: { orderId } });
    // Job của test trước (ts khác) + job này = 2; bản gửi lại không thêm dòng.
    expect(jobs).toHaveLength(2);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.quantityInStock).toBe(8); // mốc stockDeductedAt chặn trừ lần 2
  });

  it("đơn CANCELLED → hoàn kho một lần, chạy lại vẫn idempotent", async () => {
    const orderId = `TTK-${fx.suffix}-1`;
    mockOrder(orderId, "CANCELLED", 2);
    const res = await postWebhook({
      type: 11,
      shop_id: SHOP_ID,
      timestamp: 2,
      data: { order_id: orderId, cancel_id: "c1", cancel_status: "CANCELLATION_REQUEST_SUCCESS" },
    });
    expect(res.status).toBe(200);
    // waitForJob nhìn job MỚI NHẤT của đơn = job type 11 vừa ghi.
    const latest = await waitForJob(orderId, (j) => j.status === WebhookJobStatus.SUCCESS);
    expect(latest.eventType).toBe(11);

    const order = await prisma.order.findUniqueOrThrow({
      where: { channelId_orderCode: { channelId: tiktokChannelId, orderCode: orderId } },
    });
    expect(order.shippingStatus).toBe("CANCELLED");
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.quantityInStock).toBe(10);
  });

  it("sàn lỗi tạm thời → job quay về PENDING hẹn retry, không FAILED ngay", async () => {
    const orderId = `TTK-${fx.suffix}-2`;
    vi.mocked(getOrderDetail).mockRejectedValueOnce(new Error("TikTok API lỗi (code 500): timeout"));

    const res = await postWebhook(orderEvent(orderId, "AWAITING_SHIPMENT"));
    expect(res.status).toBe(200);

    const job = await waitForJob(
      orderId,
      (j) => j.status === WebhookJobStatus.PENDING && j.attempts === 1 && j.nextRetryAt !== null
    );
    expect(job.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(job.nextRetryAt!.getTime()).toBeLessThan(Date.now() + 40_000);
    expect(await prisma.order.count({ where: { orderCode: orderId } })).toBe(0);
  });
});
