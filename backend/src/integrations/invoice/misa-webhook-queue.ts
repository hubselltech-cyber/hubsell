/**
 * HÀNG ĐỢI BỀN CHO WEBHOOK MISA meInvoice (bảng misa_webhook_logs) + WORKER NỀN.
 *
 * Cùng kiến trúc với hàng đợi webhook Shopee (shopee/webhook-queue.ts) — hàng
 * đợi nằm TRONG Postgres thay vì Redis/BullMQ: không thêm hạ tầng mới, job
 * sống sót qua restart, và trang Nhật ký Webhook đọc thẳng bảng để tra soát.
 *
 * Phân vai:
 *   · Route (routes/webhooks.ts) — validate sơ bộ + enqueue (MỘT insert) + ack
 *     200 ngay. MISA yêu cầu phản hồi < 3 giây nên tuyệt đối không xử lý
 *     nghiệp vụ trên luồng nhận.
 *   · Worker (file này) — xử lý TUẦN TỰ (FIFO) từng job: gọi
 *     processMisaWebhookEvent; lỗi thì thử lại tối đa MAX_ATTEMPTS lần, mỗi lần
 *     CÁCH ĐỀU RETRY_DELAY_MS (5 phút) qua cột nextRetryAt; hết lượt → FAILED.
 *   · Chống trùng: unique bodyHash — MISA gửi lại y nguyên một sự kiện thì
 *     insert bị chặn ngay; sự kiện khác hash nhưng cùng nội dung vẫn an toàn
 *     nhờ service idempotent (trạng thái đã đúng thì không ghi gì).
 *   · Restart giữa chừng: job PROCESSING mồ côi được trả về PENDING lúc boot.
 */

import crypto from "crypto";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import type { MisaWebhookPayload } from "./misa-webhook";
import { processMisaWebhookEvent } from "./misa-webhook-service";

/** Tổng số lần thử một job (1 lần đầu + 2 lần retry). */
const MAX_ATTEMPTS = 3;
/** Giãn cách CỐ ĐỊNH giữa các lần thử lại — theo spec MISA: 5 phút. */
const RETRY_DELAY_MS = 5 * 60 * 1000;
/** Nhịp worker tự quét job đến hạn retry / job tồn sau restart. */
const POLL_INTERVAL_MS = 30 * 1000;

/**
 * Ghi một sự kiện ĐÃ QUA validate sơ bộ vào hàng đợi bền. Chỉ một INSERT — đủ
 * nhanh để route ack 200 trong hạn 3 giây của MISA. `duplicate=true` = bản
 * retry y nguyên đã nhận trước đó (đụng unique bodyHash), bỏ qua êm.
 */
export async function enqueueMisaWebhook(
  rawBody: Buffer | string,
  payload: MisaWebhookPayload
): Promise<{ queued: boolean; duplicate: boolean }> {
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  try {
    await prisma.misaWebhookLog.create({
      data: {
        eventType: payload.EventType,
        transactionId: payload.Data.TransactionID ?? null,
        invoiceNo: payload.Data.InvNo ?? null,
        orderCode: payload.Data.RefID ?? null,
        bodyHash,
        payload: JSON.stringify(payload),
      },
    });
  } catch (err) {
    // P2002 = đụng unique bodyHash → MISA retry y nguyên, đã có trong hàng đợi.
    if ((err as { code?: string }).code === "P2002") {
      return { queued: false, duplicate: true };
    }
    throw err; // lỗi DB thật — để route trả 500 cho MISA gửi lại sau
  }
  void drain(); // đánh thức worker, không chờ (route phải ack ngay)
  return { queued: true, duplicate: false };
}

// ---------- Worker ----------

let draining = false;
let started = false;

/**
 * Khởi động worker (gọi 1 lần lúc nạp module route). Trả job PROCESSING mồ côi
 * (backend chết giữa chừng ở lần chạy trước) về PENDING rồi quét theo nhịp.
 */
export function startMisaWebhookWorker(): void {
  if (started) return;
  started = true;

  void (async () => {
    const orphaned = await prisma.misaWebhookLog.updateMany({
      where: { status: WebhookJobStatus.PROCESSING },
      data: { status: WebhookJobStatus.PENDING },
    });
    if (orphaned.count > 0) {
      console.log(`[Webhook MISA] Khôi phục ${orphaned.count} job dở dang sau restart`);
    }
    void drain();
  })().catch((err) => console.error("[Webhook MISA] Lỗi khởi động worker:", err));

  // unref: timer không giữ process sống khi server tắt.
  setInterval(() => void drain(), POLL_INTERVAL_MS).unref();
}

/**
 * Xử lý TUẦN TỰ từng job đến hạn theo thứ tự nhận (FIFO). Tuần tự là chủ đích:
 * các sự kiện của CÙNG một hóa đơn (phát hành → hủy → thay thế) phải vào sổ
 * đúng thứ tự, audit log mới phản ánh đúng dòng đời chứng từ.
 */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = await prisma.misaWebhookLog.findFirst({
        where: {
          status: WebhookJobStatus.PENDING,
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
      });
      if (!job) break;

      // Nhận job bằng UPDATE có điều kiện — nếu tiến trình khác đã cầm thì thôi.
      const claimed = await prisma.misaWebhookLog.updateMany({
        where: { id: job.id, status: WebhookJobStatus.PENDING },
        data: { status: WebhookJobStatus.PROCESSING, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      const attempt = job.attempts + 1;

      try {
        const payload = JSON.parse(job.payload) as MisaWebhookPayload;
        const result = await processMisaWebhookEvent(payload);

        await prisma.misaWebhookLog.update({
          where: { id: job.id },
          data: {
            status: WebhookJobStatus.SUCCESS,
            processedAt: new Date(),
            lastError: null,
          },
        });
        console.log(
          `[Webhook MISA] ${job.eventType} → ${result.status}` +
            `${result.changed ? "" : " (đã đúng từ trước, bỏ qua)"} — ` +
            `hóa đơn ${result.invoiceLogId}, đơn ${job.orderCode ?? "?"}` +
            (result.taxNote ? ` | ${result.taxNote}` : "")
        );
      } catch (err) {
        const message = (err as Error).message;
        console.error(
          `[Webhook MISA] Job ${job.id} (${job.eventType}, đơn ${job.orderCode ?? "?"}) lỗi lần ${attempt}/${MAX_ATTEMPTS}:`,
          message
        );

        if (attempt < MAX_ATTEMPTS) {
          // Còn lượt: quay về PENDING chờ đến hạn (5 phút), KHÔNG chặn job khác.
          await prisma.misaWebhookLog.update({
            where: { id: job.id },
            data: {
              status: WebhookJobStatus.PENDING,
              lastError: message,
              nextRetryAt: new Date(Date.now() + RETRY_DELAY_MS),
            },
          });
        } else {
          await prisma.misaWebhookLog.update({
            where: { id: job.id },
            data: { status: WebhookJobStatus.FAILED, lastError: message },
          });
        }
      }
    }
  } catch (err) {
    console.error("[Webhook MISA] Lỗi vòng xử lý hàng đợi:", err);
  } finally {
    draining = false;
  }
}

/** Cho test/giám sát: số job đang chờ xử lý trong hàng đợi bền. */
export async function misaWebhookQueueSize(): Promise<number> {
  return prisma.misaWebhookLog.count({
    where: {
      status: { in: [WebhookJobStatus.PENDING, WebhookJobStatus.PROCESSING] },
    },
  });
}

/**
 * Cho integration test: chạy MỘT lượt drain và đợi nó xong (worker thật chạy
 * nền qua timer nên test không await được). Không dùng trong luồng chạy thật.
 */
export async function drainMisaWebhookQueueOnce(): Promise<void> {
  await drain();
}
