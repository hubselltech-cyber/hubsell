// ============================================================
// WORKER HÀNG ĐỢI BỀN — SỰ KIỆN TỪ SÀN (giai đoạn 2, docs/HANG-DOI-BEN.md)
//
// Đăng ký hàm xử lý cho ba hàng đợi pg-boss:
//   · evt.order — "kéo lại đơn X của shop Y": gọi handler của đúng sàn, xong thì
//     đánh dấu mọi dòng webhook_events đang chờ của đơn đó là SUCCESS. Handler
//     ném lỗi → ghi lỗi vào dòng, ném tiếp cho pg-boss tự thử lại theo cấu hình
//     hàng đợi (không tự hẹn giờ ở đây).
//   · evt.auth  — sự kiện ủy quyền / thu hồi ủy quyền: mỗi sự kiện một việc,
//     đánh dấu đúng dòng của nó.
//   · evt.dead  — việc của hai hàng đợi trên đã hết lượt thử: dòng còn chờ →
//     FAILED + cảnh báo cho chủ shop.
//
// Không có trạng thái nào trong RAM: nhận việc, hạn giữ, không chạy chồng một
// đơn trên nhiều tiến trình đều do pg-boss lo (evt.order là hàng đợi "gộp theo khóa").
//
// Sàn chuyển sang đường này lần lượt: Lazada (bước 1) → TikTok (bước 2) →
// Shopee. Thêm một sàn = thêm một dòng vào mỗi bảng dưới đây.
// MỖI HÀNG ĐỢI CHỈ ĐĂNG KÝ MỘT LẦN, ở tệp này: hai hàm xử lý cùng nhận một
// hàng đợi thì việc rơi vào hàm nào cũng được.
// ============================================================

import { WebhookJobStatus } from "@prisma/client";

import { alertLazadaOrderJobFailed, handleLazadaOrderJob } from "../integrations/lazada/webhook";
import {
  alertTiktokJobFailed,
  handleTiktokAuthJob,
  handleTiktokOrderJob,
} from "../integrations/tiktok/webhook-queue";
import { QUEUES, registerWorker } from "../lib/queue";
import { EVT_ORDER_MAX_ATTEMPTS, evtOrderConcurrency } from "../lib/queue-config";
import { prisma } from "../lib/prisma";
import {
  markEventById,
  markOrderEventsDone,
  markOrderEventsError,
  markOrderEventsFailed,
  type AuthEventJob,
  type OrderEventJob,
  type OrderEventSource,
} from "../services/webhook-inbox";

/** Trả ghi chú khi không có gì để làm (lưu vào dòng sự kiện để tra soát), null khi xử lý trọn vẹn. */
type OrderHandler = (job: OrderEventJob) => Promise<string | null>;
type AuthHandler = (job: AuthEventJob) => Promise<string | null>;
/** `orderId` null = sự kiện ủy quyền (không gắn đơn). */
type FailureAlert = (shopId: string, orderId: string | null, attempts: number, message: string) => Promise<void>;

const ORDER_HANDLERS: Partial<Record<OrderEventSource, OrderHandler>> = {
  LAZADA: (job) => handleLazadaOrderJob(job.shopId, job.orderId),
  TIKTOK: (job) => handleTiktokOrderJob(job.shopId, job.orderId),
};

const AUTH_HANDLERS: Partial<Record<OrderEventSource, AuthHandler>> = {
  TIKTOK: (job) => handleTiktokAuthJob(job.shopId),
};

const FAILURE_ALERTS: Partial<Record<OrderEventSource, FailureAlert>> = {
  // Lazada chỉ có sự kiện đơn đi qua hàng đợi.
  LAZADA: (shopId, orderId, attempts, message) =>
    orderId ? alertLazadaOrderJobFailed(shopId, orderId, attempts, message) : Promise.resolve(),
  TIKTOK: alertTiktokJobFailed,
};

const errorMessage = (err: unknown): string => String((err as Error)?.message ?? err);

/** Xử lý một việc evt.order. Tách khỏi phần đăng ký để test gọi thẳng. */
export async function runOrderEventJob(job: OrderEventJob, retryCount: number): Promise<void> {
  const handler = ORDER_HANDLERS[job.source];
  if (!handler) throw new Error(`Chưa có hàm xử lý sự kiện đơn cho sàn ${job.source}`);
  const attempt = retryCount + 1;
  try {
    const note = await handler(job);
    await markOrderEventsDone(job, attempt, note);
  } catch (err) {
    // Ghi lỗi vào dòng sự kiện là phụ; không được che lỗi gốc.
    await markOrderEventsError(job, attempt, errorMessage(err)).catch((e) =>
      console.error("[Event-queue] Không ghi được lỗi vào webhook_events:", errorMessage(e))
    );
    throw err;
  }
}

/** Xử lý một việc evt.auth. */
export async function runAuthEventJob(job: AuthEventJob, retryCount: number): Promise<void> {
  const handler = AUTH_HANDLERS[job.source];
  if (!handler) throw new Error(`Chưa có hàm xử lý sự kiện ủy quyền cho sàn ${job.source}`);
  const attempt = retryCount + 1;
  try {
    const note = await handler(job);
    await markEventById(job.eventId, WebhookJobStatus.SUCCESS, attempt, note);
  } catch (err) {
    await markEventById(job.eventId, WebhookJobStatus.PENDING, attempt, errorMessage(err)).catch((e) =>
      console.error("[Event-queue] Không ghi được lỗi vào webhook_events:", errorMessage(e))
    );
    throw err;
  }
}

/**
 * Xử lý một việc evt.dead — bản sao của một việc evt.order hoặc evt.auth đã hết
 * lượt thử (pg-boss chép nguyên dữ liệu việc sang). Phân biệt bằng trường có mặt:
 * việc ủy quyền mang `eventId`, việc đơn mang `orderId`.
 */
export async function runDeadEventJob(job: OrderEventJob | AuthEventJob): Promise<void> {
  if ("eventId" in job) {
    const row = await prisma.webhookEvent.findUnique({
      where: { id: job.eventId },
      select: { status: true, lastError: true },
    });
    if (!row || row.status !== WebhookJobStatus.PENDING) return;
    const message = row.lastError ?? "không rõ lỗi";
    await markEventById(job.eventId, WebhookJobStatus.FAILED, EVT_ORDER_MAX_ATTEMPTS, message);
    console.error(`[Event-queue] ${job.source} sự kiện ủy quyền shop ${job.shopId} hỏng sau ${EVT_ORDER_MAX_ATTEMPTS} lần: ${message}`);
    await FAILURE_ALERTS[job.source]?.(job.shopId, null, EVT_ORDER_MAX_ATTEMPTS, message);
    return;
  }
  const { failed, lastError } = await markOrderEventsFailed(job);
  // Không còn dòng nào chờ = một việc khác của cùng đơn đã xử lý xong sau đó → không báo.
  if (failed === 0) return;
  const message = lastError ?? "không rõ lỗi";
  console.error(
    `[Event-queue] ${job.source} đơn ${job.orderId} (shop ${job.shopId}) hỏng sau ${EVT_ORDER_MAX_ATTEMPTS} lần: ${message}`
  );
  await FAILURE_ALERTS[job.source]?.(job.shopId, job.orderId, EVT_ORDER_MAX_ATTEMPTS, message);
}

/**
 * Đăng ký worker cho các hàng đợi sự kiện. Gọi SAU khi startQueue() báo sẵn
 * sàng; ở vai web hàm đăng ký tự bỏ qua (web chỉ gửi việc).
 */
export async function registerEventQueueWorkers(): Promise<void> {
  await registerWorker<OrderEventJob>(
    QUEUES.evtOrder,
    { concurrency: evtOrderConcurrency(), pollSeconds: 0.5 },
    (job) => runOrderEventJob(job.data, job.retryCount)
  );
  // Sự kiện ủy quyền hiếm và không gấp tới từng giây: 1 việc một lúc, hỏi 2 giây một lần.
  await registerWorker<AuthEventJob>(QUEUES.evtAuth, { concurrency: 1, pollSeconds: 2 }, (job) =>
    runAuthEventJob(job.data, job.retryCount)
  );
  await registerWorker<OrderEventJob | AuthEventJob>(QUEUES.evtDead, { concurrency: 2, pollSeconds: 2 }, (job) =>
    runDeadEventJob(job.data)
  );
}
