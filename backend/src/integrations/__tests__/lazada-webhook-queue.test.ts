// ============================================================
// WEBHOOK LAZADA QUA HÀNG ĐỢI BỀN (giai đoạn 2 bước 1 — docs/HANG-DOI-BEN.md)
//
// Dựng app THẬT trên cổng ngẫu nhiên, bắn payload có CHỮ KÝ THẬT vào
// /api/webhooks/lazada. Tầng gọi sàn (getOrder / getMultipleOrderItems) được
// mock; route, hộp thư đến webhook_events, hàng đợi pg-boss, worker, upsert
// đơn, trừ kho đều chạy thật trên DB dev (cần migration queue_foundation).
//
//   1. Chữ ký sai → 401, không ghi gì.
//   2. Message không phải đơn → 200 ignored, không ghi gì.
//   3. Đơn pending: ack nhanh, dòng sự kiện SUCCESS, Order tạo, kho trừ đúng.
//   4. Gửi lại Y NGUYÊN → duplicate, vẫn một dòng, kho không trừ đôi.
//   5. Ba sự kiện dồn dập của một đơn → mọi dòng SUCCESS, số lượt kéo đơn ít hơn số sự kiện.
//   6. Sàn lỗi: dòng giữ PENDING + ghi lỗi, việc chờ thử lại; hết lượt → FAILED + cảnh báo.
//   7. LAZADA_WEBHOOK_MODE=inline hoặc hàng đợi chưa sẵn sàng → đường cũ, không ghi hộp thư đến.
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
import { getMultipleOrderItems, getOrder } from "../lazada/client";

vi.mock("../lazada/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lazada/client")>();
  return { ...mod, getOrder: vi.fn(), getMultipleOrderItems: vi.fn() };
});

process.env.LAZADA_APP_KEY ??= "test-app-key";
process.env.LAZADA_APP_SECRET ??= "test-app-secret";

let server: Server;
let baseUrl: string;
let fx: StockFixture;
let channelId: string;
let productId: string;
const SELLER_ID = `66${Date.now()}`;
const SKU = `TEST-LZDQ-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sign(raw: string): string {
  return crypto
    .createHmac("sha256", process.env.LAZADA_APP_SECRET!)
    .update(`${process.env.LAZADA_APP_KEY}${raw}`)
    .digest("hex");
}

async function postWebhook(body: unknown, opts: { badSignature?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/webhooks/lazada`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: opts.badSignature ? "deadbeef" : sign(raw) },
    body: raw,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, elapsedMs: Date.now() - started };
}

function orderEvent(orderId: string, status: string, ts = Date.now()) {
  return {
    seller_id: SELLER_ID,
    message_type: 0,
    data: { order_status: status, status_update_time: ts, trade_order_id: orderId, trade_order_line_id: `${orderId}1` },
    timestamp: ts,
    site: "lazada_vn",
  };
}

/** Giả lập sàn trả đơn 2 đơn vị (2 dòng lặp cùng SellerSku — đặc thù Lazada). */
function mockOrder(orderId: string, status: string, delayMs = 0) {
  vi.mocked(getOrder).mockImplementation(async () => {
    if (delayMs) await sleep(delayMs);
    return { order_id: Number(orderId), order_number: orderId, price: "200000", statuses: [status] } as never;
  });
  vi.mocked(getMultipleOrderItems).mockResolvedValue(
    new Map([
      [
        orderId,
        [
          { order_id: Number(orderId), sku: SKU, paid_price: "100000", name: "SP" },
          { order_id: Number(orderId), sku: SKU, paid_price: "100000", name: "SP" },
        ],
      ],
    ]) as never
  );
}

const eventsOf = (orderId: string) =>
  prisma.webhookEvent.findMany({ where: { source: "LAZADA", shopId: SELLER_ID, entityId: orderId }, orderBy: { createdAt: "asc" } });

async function waitForEvents(orderId: string, done: (rows: Awaited<ReturnType<typeof eventsOf>>) => boolean) {
  const deadline = Date.now() + 12_000;
  for (;;) {
    const rows = await eventsOf(orderId);
    if (done(rows)) return rows;
    if (Date.now() > deadline) {
      throw new Error(`Hết 12s chờ sự kiện đơn ${orderId}: ${rows.map((r) => `${r.status}/${r.attempts}`).join(", ") || "chưa có dòng"}`);
    }
    await sleep(100);
  }
}

const stockNow = () =>
  prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { quantityInStock: true, holdQuantity: true } });

beforeAll(async () => {
  fx = await createStockFixture("lzdq");
  const ch = await prisma.channel.create({
    data: {
      userId: fx.userId,
      channelName: ChannelName.LAZADA,
      shopName: `TEST-LZDQ-${fx.suffix}`,
      externalShopId: SELLER_ID,
      // Token còn hạn dài → không refresh, không gọi sàn.
      apiToken: "test-access-token",
      refreshToken: "test-refresh-token",
      accessTokenExpireAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: "ACTIVE",
    },
  });
  channelId = ch.id;
  const product = await prisma.product.create({
    data: { userId: fx.userId, skuCode: SKU, productName: "SP test Lazada queue", quantityInStock: 10 },
  });
  productId = product.id;
  await prisma.channelProduct.create({
    data: { channelId, channelSku: SKU, productName: "SP sàn Lazada test", productId, externalId: "111-222" },
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
  delete process.env.LAZADA_WEBHOOK_MODE;
  await prisma.webhookEvent.deleteMany({ where: { source: "LAZADA", shopId: SELLER_ID } });
  // Việc test để lại trong pg-boss (kể cả việc đang chờ thử lại) — dọn theo tiền tố khóa.
  await prisma.$executeRawUnsafe(
    `DELETE FROM pgboss.job WHERE name IN ('evt.order', 'evt.dead') AND (singleton_key LIKE $1 OR data->>'shopId' = $2)`,
    `LAZADA:${SELLER_ID}:%`,
    SELLER_ID
  );
  await fx.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Webhook Lazada — hộp thư đến + hàng đợi bền", () => {
  it("chữ ký sai → 401, không ghi gì", async () => {
    const res = await postWebhook(orderEvent("900001", "pending"), { badSignature: true });
    expect(res.status).toBe(401);
    expect(await eventsOf("900001")).toHaveLength(0);
  });

  it("message không phải đơn → 200 ignored, không ghi gì", async () => {
    const res = await postWebhook({ seller_id: SELLER_ID, message_type: 3, data: { trade_order_id: "900002" } });
    expect(res.status).toBe(200);
    expect(res.json.ignored).toBe(true);
    expect(await eventsOf("900002")).toHaveLength(0);
  });

  it("đơn pending: ack nhanh, sự kiện SUCCESS, Order tạo mới, kho trừ đúng 2", async () => {
    const orderId = "900003";
    mockOrder(orderId, "pending");
    const body = orderEvent(orderId, "pending", 1_700_000_000_000);
    const res = await postWebhook(body);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, orderId, queued: true, duplicate: false });
    expect(res.elapsedMs).toBeLessThan(500); // hạn ack của Lazada

    const [row] = await waitForEvents(orderId, (rows) => rows.length === 1 && rows[0].status === WebhookJobStatus.SUCCESS);
    expect(row.attempts).toBe(1);
    expect(row.processedAt).not.toBeNull();
    const order = await prisma.order.findFirst({ where: { channelId, orderCode: orderId } });
    expect(order).not.toBeNull();
    expect((await stockNow()).quantityInStock).toBe(8);

    // Gửi lại Y NGUYÊN → chặn ở khóa duy nhất (source, bodyHash).
    const again = await postWebhook(body);
    expect(again.json).toMatchObject({ ok: true, queued: false, duplicate: true });
    await sleep(800);
    expect(await eventsOf(orderId)).toHaveLength(1);
    expect((await stockNow()).quantityInStock).toBe(8);
  });

  it("ba sự kiện dồn dập của một đơn: mọi dòng SUCCESS, số lượt kéo đơn ít hơn số sự kiện", async () => {
    const orderId = "900004";
    mockOrder(orderId, "pending", 400); // sàn trả chậm 400 ms để các sự kiện chồng lên nhau
    vi.mocked(getOrder).mockClear();
    const t = 1_700_000_100_000;
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await postWebhook(orderEvent(orderId, "pending", t + i)));
    expect(results.every((r) => r.status === 200 && r.json.duplicate === false)).toBe(true);
    expect(results[0].json.queued).toBe(true);

    const rows = await waitForEvents(orderId, (r) => r.length === 3 && r.every((x) => x.status === WebhookJobStatus.SUCCESS));
    expect(rows).toHaveLength(3);
    await sleep(1200); // chờ việc thứ hai (nếu có) chạy xong
    const pulls = vi.mocked(getOrder).mock.calls.length;
    expect(pulls).toBeGreaterThanOrEqual(1);
    expect(pulls).toBeLessThan(3);
    expect((await stockNow()).quantityInStock).toBe(6); // một đơn, trừ một lần
  });

  it("sàn lỗi: dòng giữ PENDING + ghi lỗi; hết lượt thử → FAILED + cảnh báo cho chủ shop", async () => {
    const orderId = "900005";
    vi.mocked(getOrder).mockRejectedValue(new Error("Lazada 5xx giả lập"));
    const res = await postWebhook(orderEvent(orderId, "pending", 1_700_000_200_000));
    expect(res.json).toMatchObject({ queued: true });

    const [row] = await waitForEvents(orderId, (rows) => rows.length === 1 && rows[0].attempts === 1);
    expect(row.status).toBe(WebhookJobStatus.PENDING);
    expect(row.lastError).toContain("Lazada 5xx giả lập");
    const [job] = await prisma.$queryRawUnsafe<{ state: string }[]>(
      `SELECT state::text AS state FROM pgboss.job WHERE name = 'evt.order' AND singleton_key = $1`,
      `LAZADA:${SELLER_ID}:${orderId}`
    );
    expect(job.state).toBe("retry"); // pg-boss tự hẹn lượt thử lại, không FAILED ngay

    // Hết lượt thử: pg-boss chép việc sang evt.dead — gọi thẳng hàm xử lý của hàng đợi lỗi.
    await runDeadEventJob({ source: "LAZADA", shopId: SELLER_ID, orderId });
    const [failed] = await eventsOf(orderId);
    expect(failed.status).toBe(WebhookJobStatus.FAILED);
    const alert = await prisma.inventorySyncAlert.findFirst({ where: { channelId, orderSn: orderId } });
    expect(alert?.message).toContain(`sự kiện Lazada đơn ${orderId} xử lý thất bại sau 3 lần`);

    // Việc lỗi của một đơn đã được việc khác xử lý xong thì không báo nữa.
    await runDeadEventJob({ source: "LAZADA", shopId: SELLER_ID, orderId: "900003" });
    expect(await prisma.inventorySyncAlert.count({ where: { channelId, orderSn: "900003" } })).toBe(0);
  });

  it("LAZADA_WEBHOOK_MODE=inline hoặc hàng đợi chưa sẵn sàng → đường cũ, không ghi hộp thư đến", async () => {
    mockOrder("900006", "pending");
    process.env.LAZADA_WEBHOOK_MODE = "inline";
    const inline = await postWebhook(orderEvent("900006", "pending", 1_700_000_300_000));
    expect(inline.status).toBe(200);
    expect(inline.json).toEqual({ ok: true, orderId: "900006" });
    delete process.env.LAZADA_WEBHOOK_MODE;

    await stopQueue(5000);
    mockOrder("900007", "pending");
    const noQueue = await postWebhook(orderEvent("900007", "pending", 1_700_000_400_000));
    expect(noQueue.json).toEqual({ ok: true, orderId: "900007" });

    await sleep(800); // đường cũ xử lý nền sau khi ack
    expect(await eventsOf("900006")).toHaveLength(0);
    expect(await eventsOf("900007")).toHaveLength(0);
    expect(await prisma.order.count({ where: { channelId, orderCode: { in: ["900006", "900007"] } } })).toBe(2);
  });
});
