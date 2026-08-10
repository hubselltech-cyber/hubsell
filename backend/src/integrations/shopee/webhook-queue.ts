// ============================================================
// HÀNG ĐỢI BỀN CHO WEBHOOK SHOPEE (bảng shopee_webhook_logs) + WORKER NỀN
//
// Webhook có thể trễ/đứt mạng và backend có thể restart giữa chừng — nên KHÔNG
// xử lý nghiệp vụ ngay trên luồng nhận. Luồng nhận (routes/webhooks.ts) chỉ
// verify chữ ký + INSERT một dòng vào bảng rồi ack 200 (<3s theo yêu cầu
// Shopee). Worker ở đây xử lý TUẦN TỰ (FIFO) từng dòng:
//
//   · Chống trùng 2 tầng: (1) unique bodyHash — Shopee gửi lại y nguyên một
//     sự kiện thì insert bị chặn ngay; (2) nghiệp vụ idempotent theo
//     (channelId, order_sn) + mốc stockHeldAt/stockDeductedAt/stockRestoredAt
//     — sự kiện khác hash nhưng cùng đơn cũng không ghi trùng.
//   · Lỗi tạm thời (API sàn, DB): thử lại tối đa MAX_ATTEMPTS lần, giãn cách
//     NHÂN ĐÔI (exponential backoff) qua cột nextRetryAt.
//   · Hết lượt vẫn lỗi: đánh dấu FAILED + bắn InventorySyncAlert lên UI.
//   · Restart giữa chừng: job PROCESSING mồ côi được trả về PENDING lúc boot.
// ============================================================

import crypto from "crypto";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { SHOPEE_PUSH_CODE, type ShopeePushPayload } from "./webhook";
import {
  dispatchShopeeWebhookEvent,
  findShopeeChannelByShopId,
} from "./service";
import { syncShopeeEscrowEstimateForOrder } from "./settlements";
import {
  createSyncAlert,
  STOCK_VERIFY_EVENT_CODE,
  syncShopeeStockForProducts,
  VERIFY_DELAY_MS,
  verifyStockPush,
  type StockVerifyPayload,
} from "./inventory-sync";

/** Tổng số lần thử một job (1 lần đầu + 2 lần retry). */
const MAX_ATTEMPTS = 3;
/** Giãn cách trước lần retry đầu; các lần sau nhân đôi (30s → 60s). */
const BASE_RETRY_MS = 30 * 1000;
/** Nhịp worker tự quét job đến hạn retry / job tồn sau restart. */
const POLL_INTERVAL_MS = 15 * 1000;

/**
 * Ghi một sự kiện ĐÃ QUA verify chữ ký vào hàng đợi bền. Chỉ một INSERT —
 * đủ nhanh để route ack 200 trong hạn 3 giây. `duplicate=true` = bản retry
 * y nguyên đã nhận trước đó (đụng unique bodyHash), bỏ qua êm.
 */
export async function enqueueShopeeWebhook(
  rawBody: Buffer | string,
  payload: ShopeePushPayload
): Promise<{ queued: boolean; duplicate: boolean }> {
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const orderSn = payload.data?.ordersn ?? payload.data?.order_sn;
  try {
    await prisma.shopeeWebhookLog.create({
      data: {
        eventCode: Number(payload.code) || 0,
        shopId: payload.shop_id != null ? String(payload.shop_id) : "",
        orderSn: orderSn ? String(orderSn) : null,
        bodyHash,
        payload: JSON.stringify(payload),
      },
    });
  } catch (err) {
    // P2002 = đụng unique bodyHash → Shopee retry y nguyên, đã có trong hàng đợi.
    if ((err as { code?: string }).code === "P2002") {
      return { queued: false, duplicate: true };
    }
    throw err; // lỗi DB thật — để route trả 500 cho Shopee gửi lại sau
  }
  void drain(); // đánh thức worker, không chờ (route phải ack ngay)
  return { queued: true, duplicate: false };
}

// ---------- Worker ----------

let draining = false;
let started = false;

/**
 * Khởi động worker (gọi 1 lần lúc nạp module route). Trả job PROCESSING mồ côi
 * (backend chết giữa chừng ở lần chạy trước) về PENDING rồi quét theo nhịp —
 * nhờ vậy job retry đến hạn và job tồn đọng luôn được nhặt lại.
 */
export function startShopeeWebhookWorker(): void {
  if (started) return;
  started = true;

  void (async () => {
    const orphaned = await prisma.shopeeWebhookLog.updateMany({
      where: { status: WebhookJobStatus.PROCESSING },
      data: { status: WebhookJobStatus.PENDING },
    });
    if (orphaned.count > 0) {
      console.log(`[Webhook Shopee] Khôi phục ${orphaned.count} job dở dang sau restart`);
    }
    void drain();
  })().catch((err) => console.error("[Webhook Shopee] Lỗi khởi động worker:", err));

  // unref: timer không giữ process sống khi server tắt.
  setInterval(() => void drain(), POLL_INTERVAL_MS).unref();
}

/**
 * Xử lý TUẦN TỰ từng job đến hạn theo thứ tự nhận (FIFO). Chạy tuần tự là chủ
 * đích: tránh dồn nhiều transaction song song lên DB và giữ đúng thứ tự trạng
 * thái của cùng một đơn (UNPAID → READY_TO_SHIP → ...).
 */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      // Nhặt cả job webhook PENDING lẫn job đối soát VERIFYING đã đến giờ.
      const job = await prisma.shopeeWebhookLog.findFirst({
        where: {
          OR: [
            {
              status: WebhookJobStatus.PENDING,
              OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
            },
            { status: WebhookJobStatus.VERIFYING, nextRetryAt: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      if (!job) break;

      // Nhận job bằng UPDATE có điều kiện — nếu tiến trình khác đã cầm thì thôi.
      const claimed = await prisma.shopeeWebhookLog.updateMany({
        where: { id: job.id, status: job.status },
        data: { status: WebhookJobStatus.PROCESSING, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      const attempt = job.attempts + 1;

      // Job ĐỐI SOÁT tồn kho (Double-Check) — nhánh riêng, không phải webhook.
      if (job.eventCode === STOCK_VERIFY_EVENT_CODE) {
        await handleStockVerifyJob(job.id, job.payload, attempt);
        continue;
      }

      try {
        const payload = JSON.parse(job.payload) as ShopeePushPayload;
        const stockSync = await dispatchShopeeWebhookEvent(payload);

        await prisma.shopeeWebhookLog.update({
          where: { id: job.id },
          data: {
            status: WebhookJobStatus.SUCCESS,
            processedAt: new Date(),
            lastError: null,
          },
        });

        // Đẩy tồn khả dụng mới lên sàn SAU khi job đơn hàng đã chốt xong —
        // hàm này tự retry + ghi log + bắn cảnh báo, không bao giờ ném.
        if (stockSync) {
          await syncShopeeStockForProducts(stockSync);
        }

        // PHÍ TẠM TÍNH REAL-TIME: đơn vừa có sự kiện → kéo luôn số ước tính
        // escrow để P&L hiện phí ngay, không chờ vòng quét. Best-effort: lỗi
        // (đơn quá mới chưa có bản nháp phí...) chỉ log, KHÔNG được làm hỏng
        // job webhook đã SUCCESS — vòng quét ước tính sẽ vét lại sau.
        if (
          job.orderSn &&
          (job.eventCode === SHOPEE_PUSH_CODE.ORDER_STATUS ||
            job.eventCode === SHOPEE_PUSH_CODE.TRACKING_NO)
        ) {
          try {
            const channel = await findShopeeChannelByShopId(job.shopId);
            if (channel) {
              await syncShopeeEscrowEstimateForOrder(channel, job.orderSn);
            }
          } catch (err) {
            console.warn(
              `[Webhook Shopee] Chưa lấy được phí ước tính đơn ${job.orderSn} (vòng quét sẽ vét lại):`,
              (err as Error).message
            );
          }
        }
      } catch (err) {
        const message = (err as Error).message;
        console.error(
          `[Webhook Shopee] Job ${job.id} (code=${job.eventCode}, đơn ${job.orderSn ?? "?"}) lỗi lần ${attempt}/${MAX_ATTEMPTS}:`,
          err
        );

        if (attempt < MAX_ATTEMPTS) {
          // Exponential backoff: 30s → 60s. Job quay về PENDING chờ đến hạn,
          // KHÔNG chặn các job khác trong lúc chờ.
          await prisma.shopeeWebhookLog.update({
            where: { id: job.id },
            data: {
              status: WebhookJobStatus.PENDING,
              lastError: message,
              nextRetryAt: new Date(Date.now() + BASE_RETRY_MS * 2 ** (attempt - 1)),
            },
          });
        } else {
          await prisma.shopeeWebhookLog.update({
            where: { id: job.id },
            data: { status: WebhookJobStatus.FAILED, lastError: message },
          });
          await alertJobFailed(job.shopId, job.orderSn, message);
        }
      }
    }
  } catch (err) {
    console.error("[Webhook Shopee] Lỗi vòng xử lý hàng đợi:", err);
  } finally {
    draining = false;
  }
}

/**
 * XỬ LÝ MỘT LƯỢT JOB ĐỐI SOÁT (Double-Check) — update_stock trả 200 nhưng sàn
 * có thể ghi trễ nên chỉ tin sau khi đọc lại thấy khớp:
 *   · Khớp / không còn gì để soát → SUCCESS.
 *   · Lệch (verifyStockPush ĐÃ tự đẩy lại số đúng) hoặc lỗi tạm thời → hẹn
 *     giờ VERIFYING + VERIFY_DELAY_MS kiểm tra tiếp; quá MAX_ATTEMPTS lượt vẫn
 *     chưa khớp → FAILED + bắn InventorySyncAlert để chủ shop chỉnh tay.
 */
async function handleStockVerifyJob(
  jobId: string,
  rawPayload: string,
  attempt: number
): Promise<void> {
  let payload: StockVerifyPayload | null = null;
  try {
    payload = JSON.parse(rawPayload) as StockVerifyPayload;
    const result = await verifyStockPush(payload);

    if (result.outcome === "match" || result.outcome === "gone") {
      await prisma.shopeeWebhookLog.update({
        where: { id: jobId },
        data: {
          status: WebhookJobStatus.SUCCESS,
          processedAt: new Date(),
          lastError: null,
        },
      });
      if (result.outcome === "match") {
        console.log(
          `[Inventory Sync] Đối soát khớp: SKU ${payload.channelSku} — sàn = Hubsell = ${result.actual} (lượt ${attempt})`
        );
      }
      return;
    }

    // Lệch: đã đẩy lại bên trong verifyStockPush — hẹn kiểm tra tiếp/chốt FAILED.
    const note = `Đối soát lượt ${attempt}/${MAX_ATTEMPTS}: sàn còn ${result.actual} ≠ Hubsell ${result.expected} — đã đẩy lại`;
    console.warn(`[Inventory Sync] ${note} (SKU ${payload.channelSku})`);
    await finishVerifyAttempt(jobId, payload, attempt, note);
  } catch (err) {
    // Lỗi tạm thời (token/mạng/sàn không trả số tồn) — đếm lượt y như lệch.
    const message = (err as Error).message;
    console.error(
      `[Inventory Sync] Đối soát lỗi lượt ${attempt}/${MAX_ATTEMPTS} (job ${jobId}):`,
      err
    );
    await finishVerifyAttempt(jobId, payload, attempt, message);
  }
}

/** Chốt một lượt đối soát chưa khớp: còn lượt → hẹn giờ tiếp; hết → FAILED + cảnh báo. */
async function finishVerifyAttempt(
  jobId: string,
  payload: StockVerifyPayload | null,
  attempt: number,
  reason: string
): Promise<void> {
  if (attempt < MAX_ATTEMPTS) {
    await prisma.shopeeWebhookLog.update({
      where: { id: jobId },
      data: {
        status: WebhookJobStatus.VERIFYING,
        lastError: reason,
        nextRetryAt: new Date(Date.now() + VERIFY_DELAY_MS),
      },
    });
    return;
  }

  await prisma.shopeeWebhookLog.update({
    where: { id: jobId },
    data: { status: WebhookJobStatus.FAILED, lastError: reason },
  });
  if (payload) {
    await createSyncAlert(payload.channelId, {
      channelSku: payload.channelSku,
      orderSn: payload.orderSn,
      message: `Đối soát tồn kho SKU ${payload.channelSku} thất bại sau ${MAX_ATTEMPTS} lượt kiểm tra chéo: ${reason}. Tồn trên sàn nhiều khả năng ĐANG LỆCH với Hubsell — kiểm tra và chỉnh tay trên Seller Center.`,
    });
  }
}

/** Job hỏng hẳn sau MAX_ATTEMPTS lần — bắn cảnh báo lên UI cho chủ shop xử lý tay. */
async function alertJobFailed(
  shopId: string,
  orderSn: string | null,
  message: string
): Promise<void> {
  const channel = await findShopeeChannelByShopId(shopId).catch(() => null);
  if (!channel) return; // shop chưa nối Hubsell — không có chỗ treo cảnh báo
  await createSyncAlert(channel.id, {
    orderSn: orderSn ?? undefined,
    message: `Xử lý sự kiện Shopee${orderSn ? ` (đơn ${orderSn})` : ""} thất bại sau ${MAX_ATTEMPTS} lần thử: ${message}. Tồn kho/đơn hàng có thể đang LỆCH với sàn — kiểm tra và đồng bộ tay.`,
  });
}

/** Cho test/giám sát: số job đang chờ xử lý trong hàng đợi bền. */
export async function shopeeWebhookQueueSize(): Promise<number> {
  return prisma.shopeeWebhookLog.count({
    where: {
      status: {
        in: [
          WebhookJobStatus.PENDING,
          WebhookJobStatus.PROCESSING,
          WebhookJobStatus.VERIFYING,
        ],
      },
    },
  });
}

/**
 * Cho integration test: chạy MỘT lượt drain và đợi nó xong (worker thật chạy
 * nền qua timer nên test không await được). Không dùng trong luồng chạy thật.
 */
export async function drainShopeeWebhookQueueOnce(): Promise<void> {
  await drain();
}
