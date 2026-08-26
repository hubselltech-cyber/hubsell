// ============================================================
// KỊCH BẢN 2 — IDEMPOTENCY: Shopee gửi TRÙNG webhook cùng order_sn
//
// Hệ thống chống trùng 2 tầng, test cả hai:
//
//   TẦNG 1 — HÀNG ĐỢI BỀN (route thật + chữ ký thật): mạng lag làm Shopee
//   bắn lại Y NGUYÊN một sự kiện → bản sau đụng unique bodyHash trong
//   shopee_webhook_logs, bị nhận diện duplicate ngay tại route nhưng VẪN
//   ACK 200 (trả lỗi là Shopee retry mãi / block push). Hàng đợi chỉ có
//   đúng 1 bản ghi và worker chỉ xử lý đúng 1 lần.
//
//   TẦNG 2 — MỐC KHO (webhook bắn lại với body KHÁC nhưng cùng order_sn,
//   vd kèm timestamp mới): lọt qua dedup hash nhưng các mốc stockHeldAt /
//   stockDeductedAt / stockRestoredAt trên Order chặn mọi tác động kho lần
//   thứ hai — hold/trừ/hoàn đều "already-*", số liệu bất biến.
// ============================================================
import "./load-env";
import crypto from "crypto";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createApp } from "../../app";
import { getShopeeWebhookUrl } from "../shopee/webhook";
import {
  deductStockTx,
  holdStockTx,
  restoreStockTx,
} from "../order-stock";
import { createStockFixture, type StockFixture } from "./fixtures";

const ORDER_SN_PREFIX = "TEST-IDEMP-";

let server: Server;
let baseUrl: string;
let fx: StockFixture;

beforeAll(async () => {
  fx = await createStockFixture("idemp");
  // Dựng app THẬT (route + verify chữ ký + hàng đợi + worker) trên cổng ngẫu nhiên.
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("Không lấy được cổng test");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.shopeeWebhookLog.deleteMany({
    where: { orderSn: { startsWith: ORDER_SN_PREFIX } },
  });
  await fx.cleanup();
});

/** Ký body y hệt Shopee: HMAC-SHA256(partner_key, webhook_url + "|" + raw body). */
function signBody(body: string): string {
  const key = process.env.SHOPEE_PARTNER_KEY;
  if (!key) throw new Error("Thiếu SHOPEE_PARTNER_KEY trong backend/.env");
  return crypto.createHmac("sha256", key).update(`${getShopeeWebhookUrl()}|${body}`).digest("hex");
}

function postWebhook(body: string) {
  return fetch(`${baseUrl}/api/webhook/shopee`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: signBody(body) },
    body,
  });
}

/** Chờ điều kiện thành sự thật (worker chạy nền) — tối đa timeoutMs. */
async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 8000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got !== null) return got;
    if (Date.now() > deadline) throw new Error("Hết giờ chờ điều kiện test");
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe("Idempotency — Shopee gửi trùng webhook cùng order_sn", () => {
  it("bắn lại Y NGUYÊN body 2 lần → cả 2 đều ACK 200, hàng đợi chỉ nhận 1 bản ghi, worker xử lý đúng 1 lần", async () => {
    const orderSn = `${ORDER_SN_PREFIX}${Date.now()}`;
    // shop_id không tồn tại trong DB → worker xử lý kiểu no-op an toàn,
    // không gọi API Shopee thật nào trong test.
    const body = JSON.stringify({
      code: 4,
      shop_id: 999999998,
      timestamp: Math.floor(Date.now() / 1000),
      data: { ordersn: orderSn, status: "READY_TO_SHIP" },
    });

    // Lần 1: nhận vào hàng đợi.
    const res1 = await postWebhook(body);
    expect(res1.status).toBe(200); // ACK 200 trong hạn 3s của Shopee
    const json1 = (await res1.json()) as { queued: boolean; duplicate: boolean };
    expect(json1.queued).toBe(true);
    expect(json1.duplicate).toBe(false);

    // Lần 2 (mạng lag, Shopee bắn lại y nguyên): nhận diện trùng NHƯNG vẫn 200.
    const res2 = await postWebhook(body);
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as { queued: boolean; duplicate: boolean };
    expect(json2.queued).toBe(false);
    expect(json2.duplicate).toBe(true);

    // Hàng đợi bền chỉ có ĐÚNG MỘT bản ghi cho sự kiện này.
    const rows = await prisma.shopeeWebhookLog.findMany({ where: { orderSn } });
    expect(rows).toHaveLength(1);

    // Worker nền xử lý xong đúng 1 lần (attempts = 1, không lỗi).
    const done = await waitFor(async () => {
      const row = await prisma.shopeeWebhookLog.findFirst({
        where: { orderSn, status: WebhookJobStatus.SUCCESS },
      });
      return row ?? null;
    });
    expect(done.attempts).toBe(1);
    expect(done.lastError).toBeNull();
  });

  it("webhook bắn lại với BODY KHÁC nhưng cùng order_sn → mốc kho chặn hold/trừ/hoàn lần 2, số liệu bất biến", async () => {
    const productId = await fx.createProduct(5);
    const orderId = await fx.createOrder(productId, 2);

    const hold = () => prisma.$transaction((tx) => holdStockTx(tx, orderId));
    const deduct = () =>
      prisma.$transaction((tx) => deductStockTx(tx, orderId, "test idempotency"));
    const restore = () =>
      prisma.$transaction((tx) => restoreStockTx(tx, orderId, "test idempotency"));

    // Đơn UNPAID về → giữ 2; webhook lặp → không giữ thêm.
    expect((await hold()).outcome).toBe("held");
    expect((await hold()).outcome).toBe("already-held");
    let p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.holdQuantity).toBe(2);
    expect(p.quantityInStock).toBe(5);

    // Đơn chốt → nhả hold + trừ thật 2; webhook lặp → không trừ thêm.
    expect((await deduct()).outcome).toBe("deducted");
    expect((await deduct()).outcome).toBe("already-deducted");
    p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.quantityInStock).toBe(3);
    expect(p.holdQuantity).toBe(0);
    expect(
      await prisma.inventoryLog.count({ where: { productId, changeQuantity: { lt: 0 } } })
    ).toBe(1); // đúng một bút toán trừ

    // Đơn hủy → hoàn 2; webhook lặp → không hoàn thêm (kho không phình ảo).
    expect((await restore()).outcome).toBe("restored");
    expect((await restore()).outcome).toBe("already-restored");
    p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.quantityInStock).toBe(5);
  });
});
