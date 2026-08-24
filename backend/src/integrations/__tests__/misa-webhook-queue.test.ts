// ============================================================
// WEBHOOK MISA meInvoice — TEST LUỒNG ĐẨY VÀO HÀNG ĐỢI + WORKER
//
// Dựng app THẬT (route + hàng đợi bền + worker) trên cổng ngẫu nhiên, bắn
// payload giả lập (misa-webhook-mock.ts) vào /v1/webhooks/misa-meinvoice và
// kiểm 4 nhóm hành vi:
//
//   1. NON-BLOCKING: route ack 200 { success: true } trong hạn 3 giây của
//      MISA, sự kiện nằm trong bảng misa_webhook_logs chờ worker.
//   2. CHỐNG TRÙNG: MISA bắn lại Y NGUYÊN body → duplicate, hàng đợi vẫn 1 dòng.
//   3. WORKER + ĐỐI SOÁT THUẾ: phát hành → InvoiceLog ISSUED + điều chỉnh thuế
//      trong biên độ theo số MISA; lệch VƯỢT biên độ → TAX_MISMATCH: hóa đơn
//      FAILED, giữ số Hubsell, cảnh báo trong audit; hủy → CANCELLED;
//      Order.einvoiceStatus cập nhật theo; InvoiceStatusHistory đủ dòng đúng thứ tự.
//   4. RETRY: mã đơn không tồn tại → job lỗi, quay về PENDING với lịch hẹn
//      ~5 phút (không FAILED ngay).
// ============================================================
import "./load-env";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvoiceLogStatus, WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { createApp } from "../../app";
import { misaEventStatus } from "../invoice/misa-webhook";
import {
  buildCancelledPayload,
  buildPublishedPayload,
} from "../invoice/misa-webhook-mock";
import { createStockFixture, type StockFixture } from "./fixtures";

let server: Server;
let baseUrl: string;
let fx: StockFixture;

/** POST JSON vào endpoint webhook MISA, trả kèm thời gian phản hồi (ms). */
async function postWebhook(body: unknown) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/v1/webhooks/misa-meinvoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, elapsedMs: Date.now() - started };
}

/**
 * Worker chạy nền (không await được từ test) — poll bảng hàng đợi đến khi job
 * rời PENDING/PROCESSING hoặc thỏa điều kiện tuỳ ý, tối đa 10 giây.
 */
async function waitForJob(
  transactionId: string,
  done: (job: { status: WebhookJobStatus; attempts: number; nextRetryAt: Date | null }) => boolean
) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const job = await prisma.misaWebhookLog.findFirst({
      where: { transactionId },
      orderBy: { createdAt: "desc" },
    });
    if (job && done(job)) return job;
    if (Date.now() > deadline) {
      throw new Error(
        `Hết 10s chờ job ${transactionId} — trạng thái hiện tại: ${job?.status ?? "chưa có"}`
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  fx = await createStockFixture("misa");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  // Job hàng đợi không cascade theo user — dọn theo tiền tố mã giao dịch test.
  await prisma.misaWebhookLog.deleteMany({
    where: { transactionId: { startsWith: `TEST-MISA-${fx.suffix}` } },
  });
  await fx.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Webhook MISA meInvoice — luồng đẩy vào hàng đợi", () => {
  it("ack 200 { success: true } trong hạn 3 giây và ghi sự kiện vào hàng đợi", async () => {
    const productId = await fx.createProduct(10);
    // Thuế suất 10% trong cấu hình thuế độc lập của Hubsell (Product.vatRate).
    await prisma.product.update({ where: { id: productId }, data: { vatRate: 10 } });
    const orderId = await fx.createOrder(productId, 2); // 2 × 100.000đ
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    const txnId = `TEST-MISA-${fx.suffix}-1`;
    // Giá bán ĐÃ GỒM thuế (quy ước bóc ngược 24/08): gross 2 × 100.000 =
    // 200.000đ → thuế Hubsell = 200.000 − round(200.000×100/110) = 18.182đ;
    // MISA gửi 18.400đ — lệch 218đ do làm tròn, NẰM TRONG biên độ 500đ.
    const payload = buildPublishedPayload({
      transactionId: txnId,
      orderCode: order.orderCode,
      totalAmount: 200000,
      totalVatAmount: 18400,
    });

    const res = await postWebhook(payload);
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.queued).toBe(true);
    expect(res.elapsedMs).toBeLessThan(3000); // hạn ack của MISA

    const jobs = await prisma.misaWebhookLog.findMany({
      where: { transactionId: txnId },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].eventType).toBe("InvoicePublished");
    expect(jobs[0].orderCode).toBe(order.orderCode);
  });

  it("MISA bắn lại y nguyên body → duplicate, hàng đợi vẫn đúng 1 dòng", async () => {
    const txnId = `TEST-MISA-${fx.suffix}-1`;
    const job = await prisma.misaWebhookLog.findFirstOrThrow({
      where: { transactionId: txnId },
    });
    const res = await postWebhook(JSON.parse(job.payload));
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.duplicate).toBe(true);

    const count = await prisma.misaWebhookLog.count({
      where: { transactionId: txnId },
    });
    expect(count).toBe(1);
  });

  it("payload thiếu TransactionID → 400, không ghi hàng đợi", async () => {
    const res = await postWebhook({ EventType: "InvoicePublished", Data: {} });
    expect(res.status).toBe(400);
    expect(res.json.success).toBe(false);
  });

  it("hỗ trợ cả hai kiểu tên sự kiện: PascalCase và topic chấm (invoice.signed…)", () => {
    // MISA đổi kiểu đặt tên giữa các bản tài liệu — map phải nhận cả hai.
    expect(misaEventStatus("invoice.signed")).toBe(InvoiceLogStatus.ISSUED);
    expect(misaEventStatus("Invoice.Signed")).toBe(InvoiceLogStatus.ISSUED); // lệch hoa thường vẫn nhận
    expect(misaEventStatus("invoice.canceled")).toBe(InvoiceLogStatus.CANCELLED);
    expect(misaEventStatus("InvoicePublished")).toBe(InvoiceLogStatus.ISSUED);
    expect(misaEventStatus("dinh.dang.la")).toBeNull();
  });

  it("sự kiện ngoài phạm vi (ping) → ack 200 ignored, không ghi hàng đợi", async () => {
    const res = await postWebhook({
      EventType: "Ping",
      Data: { TransactionID: `TEST-MISA-${fx.suffix}-ping` },
    });
    expect(res.status).toBe(200);
    expect(res.json.ignored).toBe(true);
    const count = await prisma.misaWebhookLog.count({
      where: { transactionId: `TEST-MISA-${fx.suffix}-ping` },
    });
    expect(count).toBe(0);
  });
});

describe("Webhook MISA meInvoice — worker, đối soát thuế và audit log", () => {
  it("phát hành: InvoiceLog ISSUED, thuế điều chỉnh theo MISA (trong biên độ), đơn + audit cập nhật", async () => {
    const txnId = `TEST-MISA-${fx.suffix}-1`; // job đã enqueue ở describe trên
    await waitForJob(txnId, (j) => j.status === WebhookJobStatus.SUCCESS);

    const log = await prisma.invoiceLog.findFirstOrThrow({
      where: { transactionId: txnId },
      include: { statusHistory: true, order: true },
    });
    expect(log.status).toBe(InvoiceLogStatus.ISSUED);
    expect(log.invoiceNo).toBeTruthy();
    // Lệch 218đ ≤ biên độ 500đ → tự điều chỉnh theo số NCC (chứng từ pháp lý).
    expect(Number(log.vatAmount)).toBe(18400);
    expect(log.order?.einvoiceStatus).toBe(InvoiceLogStatus.ISSUED);

    expect(log.statusHistory).toHaveLength(1);
    expect(log.statusHistory[0].toStatus).toBe(InvoiceLogStatus.ISSUED);
    expect(log.statusHistory[0].source).toBe("MISA_WEBHOOK");
    expect(log.statusHistory[0].note).toContain("TỰ ĐIỀU CHỈNH");
  });

  it("lệch thuế VƯỢT biên độ → TAX_MISMATCH: hóa đơn FAILED, giữ số Hubsell, cảnh báo trong audit", async () => {
    const productId = await fx.createProduct(10);
    await prisma.product.update({ where: { id: productId }, data: { vatRate: 10 } });
    const orderId = await fx.createOrder(productId, 1); // gross 100.000đ → thuế Hubsell bóc ngược = 9.091đ
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    const txnId = `TEST-MISA-${fx.suffix}-2`;
    await postWebhook(
      buildPublishedPayload({
        transactionId: txnId,
        orderCode: order.orderCode,
        totalVatAmount: 50000, // lệch 40.000đ >> biên độ 500đ
      })
    );
    await waitForJob(txnId, (j) => j.status === WebhookJobStatus.SUCCESS);

    const log = await prisma.invoiceLog.findFirstOrThrow({
      where: { transactionId: txnId },
      include: { statusHistory: true, order: { select: { einvoiceStatus: true } } },
    });
    // Lệch bất thường → hóa đơn vào trạng thái LỖI, mã lỗi TAX_MISMATCH đứng đầu.
    expect(log.status).toBe(InvoiceLogStatus.FAILED);
    expect(log.errorMessage).toMatch(/^TAX_MISMATCH:/);
    expect(log.order?.einvoiceStatus).toBe(InvoiceLogStatus.FAILED);
    // KHÔNG tự sửa sổ: giữ số Hubsell (log mới tạo nên vatAmount = 0).
    expect(Number(log.vatAmount)).toBe(0);
    expect(log.statusHistory[0].note).toContain("CẢNH BÁO LỆCH THUẾ");
    expect(log.statusHistory[0].toStatus).toBe(InvoiceLogStatus.FAILED);
  });

  it("hủy hóa đơn: CANCELLED + audit đủ 2 dòng đúng thứ tự", async () => {
    const txnId = `TEST-MISA-${fx.suffix}-1`;
    const log = await prisma.invoiceLog.findFirstOrThrow({
      where: { transactionId: txnId },
    });
    await postWebhook(
      buildCancelledPayload({ transactionId: txnId, orderCode: log.orderCode })
    );
    await waitForJob(
      txnId,
      (j) => j.status === WebhookJobStatus.SUCCESS && j.attempts <= 1
    );
    // Chờ job HỦY (job thứ 2 cùng transactionId) xử lý xong.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const updated = await prisma.invoiceLog.findFirstOrThrow({
        where: { id: log.id },
      });
      if (updated.status === InvoiceLogStatus.CANCELLED) break;
      if (Date.now() > deadline) throw new Error("Hết 10s chờ hóa đơn chuyển CANCELLED");
      await new Promise((r) => setTimeout(r, 100));
    }

    const history = await prisma.invoiceStatusHistory.findMany({
      where: { invoiceLogId: log.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0].toStatus).toBe(InvoiceLogStatus.ISSUED);
    expect(history[1].toStatus).toBe(InvoiceLogStatus.CANCELLED);

    const order = await prisma.order.findFirstOrThrow({
      where: { id: (await prisma.invoiceLog.findFirstOrThrow({ where: { id: log.id } })).orderId! },
    });
    expect(order.einvoiceStatus).toBe(InvoiceLogStatus.CANCELLED);
  });

  it("mã đơn không tồn tại → job lỗi, hẹn retry ~5 phút thay vì FAILED ngay", async () => {
    const txnId = `TEST-MISA-${fx.suffix}-notfound`;
    await postWebhook(
      buildPublishedPayload({
        transactionId: txnId,
        orderCode: `KHONG-TON-TAI-${fx.suffix}`,
        totalVatAmount: 10000,
      })
    );

    const job = await waitForJob(
      txnId,
      (j) => j.status === WebhookJobStatus.PENDING && j.attempts === 1
    );
    expect(job.nextRetryAt).not.toBeNull();
    const delayMs = job.nextRetryAt!.getTime() - Date.now();
    // Lịch hẹn nằm quanh mốc 5 phút (trừ hao thời gian đã trôi trong test).
    expect(delayMs).toBeGreaterThan(4 * 60 * 1000);
    expect(delayMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});
