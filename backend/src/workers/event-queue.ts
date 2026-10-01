// ============================================================
// WORKER HÀNG ĐỢI BỀN — SỰ KIỆN ĐƠN TỪ SÀN (giai đoạn 2, docs/HANG-DOI-BEN.md)
//
// Đăng ký hàm xử lý cho hai hàng đợi pg-boss:
//   · evt.order — "kéo lại đơn X của shop Y": gọi handler của đúng sàn, xong thì
//     đánh dấu mọi dòng webhook_events đang chờ của đơn đó là SUCCESS. Handler
//     ném lỗi → ghi lỗi vào dòng, ném tiếp cho pg-boss tự thử lại theo cấu hình
//     hàng đợi (không tự hẹn giờ ở đây).
//   · evt.dead — việc đã hết lượt thử: dòng còn chờ → FAILED + cảnh báo cho chủ shop.
//
// Không có trạng thái nào trong RAM: nhận việc, hạn giữ, không chạy chồng một
// đơn trên nhiều tiến trình đều do pg-boss lo (hàng đợi "gộp theo khóa").
//
// Sàn chuyển sang đường này lần lượt: Lazada (bước 1) → TikTok → Shopee. Thêm
// một sàn = thêm một dòng vào ORDER_HANDLERS + FAILURE_ALERTS.
// ============================================================

import { alertLazadaOrderJobFailed, handleLazadaOrderJob } from "../integrations/lazada/webhook";
import { QUEUES, registerWorker } from "../lib/queue";
import { EVT_ORDER_MAX_ATTEMPTS, evtOrderConcurrency } from "../lib/queue-config";
import {
  markOrderEventsDone,
  markOrderEventsError,
  markOrderEventsFailed,
  type OrderEventJob,
  type OrderEventSource,
} from "../services/webhook-inbox";

/** Trả ghi chú khi không có gì để làm (lưu vào dòng sự kiện để tra soát), null khi xử lý trọn vẹn. */
type OrderHandler = (job: OrderEventJob) => Promise<string | null>;
type FailureAlert = (job: OrderEventJob, attempts: number, message: string) => Promise<void>;

const ORDER_HANDLERS: Partial<Record<OrderEventSource, OrderHandler>> = {
  LAZADA: (job) => handleLazadaOrderJob(job.shopId, job.orderId),
};

const FAILURE_ALERTS: Partial<Record<OrderEventSource, FailureAlert>> = {
  LAZADA: (job, attempts, message) => alertLazadaOrderJobFailed(job.shopId, job.orderId, attempts, message),
};

/** Xử lý một việc evt.order. Tách khỏi phần đăng ký để test gọi thẳng. */
export async function runOrderEventJob(job: OrderEventJob, retryCount: number): Promise<void> {
  const handler = ORDER_HANDLERS[job.source];
  if (!handler) throw new Error(`Chưa có hàm xử lý sự kiện đơn cho sàn ${job.source}`);
  const attempt = retryCount + 1;
  try {
    const note = await handler(job);
    await markOrderEventsDone(job, attempt, note);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    // Ghi lỗi vào dòng sự kiện là phụ; không được che lỗi gốc.
    await markOrderEventsError(job, attempt, message).catch((e) =>
      console.error("[Event-queue] Không ghi được lỗi vào webhook_events:", (e as Error).message)
    );
    throw err;
  }
}

/** Xử lý một việc evt.dead (bản sao của việc evt.order đã hết lượt thử). */
export async function runDeadOrderEventJob(job: OrderEventJob): Promise<void> {
  const { failed, lastError } = await markOrderEventsFailed(job);
  // Không còn dòng nào chờ = một việc khác của cùng đơn đã xử lý xong sau đó → không báo.
  if (failed === 0) return;
  const message = lastError ?? "không rõ lỗi";
  console.error(
    `[Event-queue] ${job.source} đơn ${job.orderId} (shop ${job.shopId}) hỏng sau ${EVT_ORDER_MAX_ATTEMPTS} lần: ${message}`
  );
  await FAILURE_ALERTS[job.source]?.(job, EVT_ORDER_MAX_ATTEMPTS, message);
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
  await registerWorker<OrderEventJob>(QUEUES.evtDead, { concurrency: 2, pollSeconds: 2 }, (job) =>
    runDeadOrderEventJob(job.data)
  );
}
