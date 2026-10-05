// ============================================================
// WEBHOOK SHOPEE QUA HÀNG ĐỢI BỀN pg-boss (giai đoạn 2 bước 3 — docs/HANG-DOI-BEN.md)
//
// Dựng app THẬT trên cổng ngẫu nhiên, bắn payload có CHỮ KÝ THẬT vào
// /api/webhook/shopee. Tầng gọi sàn (getOrderDetail, getTrackingNumber) và phần
// kéo phí tạm tính được mock; route, hộp thư đến, hàng đợi, worker, upsert đơn,
// trừ kho chạy thật trên DB dev (cần migration queue_foundation).
//
//   1. Đơn READY_TO_SHIP: dòng sự kiện SUCCESS, Order tạo, kho trừ đúng; gửi lại y nguyên không trừ đôi.
//   2. Sự kiện ủy quyền của shop chưa nối → evt.auth xử lý, dòng SUCCESS kèm ghi chú.
//   3. Sàn lỗi: dòng giữ PENDING + ghi lỗi; hết lượt → FAILED + cảnh báo chủ shop.
//   4. Mã vận đơn của push code 4 bị gộp vào việc đang chờ vẫn tới được handler.
//   5. Hàng đợi bền chưa sẵn sàng → 503 (Shopee gửi lại), không ghi gì.
// (Bước 6b, 05/10/2026: đường cũ trên bảng shopee_webhook_logs đã gỡ.)
// ============================================================
import "./load-env";
import crypto from "crypto";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { startQueue, stopQueue } from "../../lib/queue";
import { registerEventQueueWorkers, runDeadEventJob } from "../../workers/event-queue";
import { createStockFixture, type StockFixture } from "./fixtures";
import { getOrderDetail, getTrackingNumber } from "../shopee/client";
import { getShopeePushPartnerKey, getShopeeWebhookUrl } from "../shopee/webhook";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, getOrderDetail: vi.fn().mockResolvedValue([]), getTrackingNumber: vi.fn().mockResolvedValue(null) };
});
vi.mock("../shopee/settlements", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/settlements")>();
  return { ...mod, syncShopeeEscrowEstimateForOrder: vi.fn().mockResolvedValue(false) };
});

process.env.SHOPEE_PARTNER_ID ??= "1234567";
process.env.SHOPEE_PARTNER_KEY ??= "test-partner-key";

let server: Server;
let baseUrl: string;
let fx: StockFixture;
let channelId: string;
let productId: string;
let SHOP_ID: string;
const UNKNOWN_SHOP_ID = `97${Date.now()}`;
const SKU = `TEST-SPEQ-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sign(raw: string): string {
  return crypto.createHmac("sha256", getShopeePushPartnerKey()).update(`${getShopeeWebhookUrl()}|${raw}`).digest("hex");
}

async function postWebhook(body: unknown) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${baseUrl}/api/webhook/shopee`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: sign(raw) },
    body: raw,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const orderEvent = (orderSn: string, status: string, ts: number, shopId = SHOP_ID) => ({
  code: 3,
  shop_id: Number(shopId),
  timestamp: ts,
  data: { ordersn: orderSn, status, update_time: ts },
});

const trackingEvent = (orderSn: string, trackingNo: string, ts: number) => ({
  code: 4,
  shop_id: Number(SHOP_ID),
  timestamp: ts,
  data: { ordersn: orderSn, trackingno: trackingNo },
});

function mockOrder(orderSn: string, status: string, qty: number) {
  vi.mocked(getOrderDetail).mockResolvedValue([
    {
      order_sn: orderSn,
      order_status: status,
      create_time: Math.floor(Date.now() / 1000),
      total_amount: 150000 * qty,
      buyer_username: "khach_test",
      recipient_address: { name: "Khách test", phone: "0900000000" },
      item_list: [{ item_id: 1, item_name: "SP test Shopee", item_sku: SKU, model_quantity_purchased: qty, model_discounted_price: 150000 }],
    },
  ] as never);
}

const eventsOf = (where: { shopId: string; entityId?: string | null }) =>
  prisma.webhookEvent.findMany({ where: { source: "SHOPEE", ...where }, orderBy: { createdAt: "asc" } });

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
  fx = await createStockFixture("speq");
  channelId = fx.channelId;
  // Gian Shopee của fixture: thêm token còn hạn dài → không refresh, không gọi sàn.
  const ch = await prisma.channel.update({
    where: { id: channelId },
    data: { apiToken: "test-access-token", accessTokenExpireAt: new Date(Date.now() + 24 * 3600 * 1000) },
  });
  SHOP_ID = ch.externalShopId!;
  productId = await fx.createProduct(10);
  await prisma.channelProduct.create({
    data: { channelId, productId, channelSku: SKU, productName: "SP test Shopee", status: "ACTIVE" },
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
  await prisma.webhookEvent.deleteMany({ where: { source: "SHOPEE", shopId: { in: [SHOP_ID, UNKNOWN_SHOP_ID] } } });
  await prisma.$executeRawUnsafe(
    `DELETE FROM pgboss.job WHERE name IN ('evt.order', 'evt.auth', 'evt.dead') AND data->>'shopId' IN ($1, $2)`,
    SHOP_ID,
    UNKNOWN_SHOP_ID
  );
  await fx.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Webhook Shopee — hộp thư đến + hàng đợi bền pg-boss", () => {
  it("đơn READY_TO_SHIP: sự kiện SUCCESS, Order tạo mới, kho trừ đúng; gửi lại y nguyên không trừ đôi", async () => {
    const orderSn = "SPEQ-1001";
    mockOrder(orderSn, "READY_TO_SHIP", 2);
    const body = orderEvent(orderSn, "READY_TO_SHIP", 1_700_000_100);
    const res = await postWebhook(body);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, code: 3, queued: true, duplicate: false });

    const [row] = await waitForEvents({ shopId: SHOP_ID, entityId: orderSn }, (rows) => rows.length === 1 && rows[0].status === WebhookJobStatus.SUCCESS);
    expect(row.eventType).toBe("3");
    expect(row.attempts).toBe(1);
    expect(await prisma.order.findFirst({ where: { channelId, orderCode: orderSn } })).not.toBeNull();
    expect(await stockNow()).toBe(8);

    const again = await postWebhook(body);
    expect(again.json).toMatchObject({ queued: false, duplicate: true });
    await sleep(800);
    expect(await eventsOf({ shopId: SHOP_ID, entityId: orderSn })).toHaveLength(1);
    expect(await stockNow()).toBe(8);
  });

  it("sự kiện ủy quyền của shop chưa nối: evt.auth xử lý, dòng SUCCESS kèm ghi chú", async () => {
    const res = await postWebhook({ code: 2, shop_id: Number(UNKNOWN_SHOP_ID), timestamp: 1_700_000_200, data: {} });
    expect(res.json).toMatchObject({ ok: true, code: 2, queued: true, duplicate: false });
    const [row] = await waitForEvents({ shopId: UNKNOWN_SHOP_ID }, (rows) => rows.length === 1 && rows[0].status === WebhookJobStatus.SUCCESS);
    expect(row.entityId).toBeNull();
    expect(row.lastError).toBe("shop chưa kết nối Hubsell");
  });

  it("sàn lỗi: dòng giữ PENDING + ghi lỗi; hết lượt thử → FAILED + cảnh báo cho chủ shop", async () => {
    const orderSn = "SPEQ-1002";
    vi.mocked(getOrderDetail).mockRejectedValue(new Error("Shopee 5xx giả lập"));
    await postWebhook(orderEvent(orderSn, "READY_TO_SHIP", 1_700_000_300));
    const [row] = await waitForEvents({ shopId: SHOP_ID, entityId: orderSn }, (rows) => rows.length === 1 && rows[0].attempts === 1);
    expect(row.status).toBe(WebhookJobStatus.PENDING);
    expect(row.lastError).toContain("Shopee 5xx giả lập");

    await prisma.$executeRawUnsafe(
      `DELETE FROM pgboss.job WHERE name = 'evt.order' AND singleton_key = $1`,
      `SHOPEE:${SHOP_ID}:${orderSn}`
    );
    await runDeadEventJob({ source: "SHOPEE", shopId: SHOP_ID, orderId: orderSn });
    expect((await eventsOf({ shopId: SHOP_ID, entityId: orderSn }))[0].status).toBe(WebhookJobStatus.FAILED);
    const alert = await prisma.inventorySyncAlert.findFirst({ where: { channelId, orderSn } });
    expect(alert?.message).toContain(`sự kiện Shopee đơn ${orderSn} xử lý thất bại sau 3 lần`);
  });

  it("mã vận đơn của push code 4 bị gộp vào việc đang chờ vẫn tới được handler", async () => {
    const orderSn = "SPEQ-1003";
    const key = `SHOPEE:${SHOP_ID}:${orderSn}`;
    // Vai web: chỉ gửi, không worker nào nhận — hai sự kiện chắc chắn gộp vào MỘT việc đang chờ.
    await stopQueue(5000);
    expect(await startQueue("web")).toBe(true);
    const first = await postWebhook(orderEvent(orderSn, "PROCESSED", 1_700_000_400));
    const second = await postWebhook(trackingEvent(orderSn, "SPXVN0123456789", 1_700_000_401));
    expect(first.json).toMatchObject({ queued: true, duplicate: false });
    expect(second.json).toMatchObject({ queued: false, duplicate: false });
    const jobs = await prisma.$queryRawUnsafe<{ state: string; data: { trackingNo?: string } }[]>(
      `SELECT state::text AS state, data FROM pgboss.job WHERE name = 'evt.order' AND singleton_key = $1`,
      key
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.trackingNo).toBe("SPXVN0123456789");

    // Bật lại worker: việc chạy, mã vận đơn được lưu mà không phải hỏi sàn.
    await stopQueue(5000);
    mockOrder(orderSn, "PROCESSED", 1);
    vi.mocked(getTrackingNumber).mockClear();
    expect(await startQueue("all")).toBe(true);
    await registerEventQueueWorkers();
    await waitForEvents({ shopId: SHOP_ID, entityId: orderSn }, (rows) => rows.length === 2 && rows.every((r) => r.status === WebhookJobStatus.SUCCESS));
    const order = await prisma.order.findFirstOrThrow({ where: { channelId, orderCode: orderSn }, select: { trackingCode: true } });
    expect(order.trackingCode).toBe("SPXVN0123456789");
    expect(vi.mocked(getTrackingNumber)).not.toHaveBeenCalled();
  });

  it("hàng đợi bền chưa sẵn sàng → 503 để Shopee gửi lại, không ghi sự kiện; ping code 0 vẫn 200", async () => {
    // Ca cuối của tệp: tắt hẳn hàng đợi (như vài giây đầu lúc tiến trình khởi động).
    await stopQueue(5000);
    const orderSn = "SPEQ-NOTREADY";
    const res = await postWebhook(orderEvent(orderSn, "UNPAID", 1_700_009_000));
    expect(res.status).toBe(503);
    expect(await eventsOf({ shopId: SHOP_ID, entityId: orderSn })).toHaveLength(0);
    const ping = await fetch(`${baseUrl}/api/webhook/shopee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: 0, data: { verify_info: "x" } }),
    });
    expect(ping.status).toBe(200);
  });
});
