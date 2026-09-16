// ============================================================
// HÀNG ĐỢI BỀN CHO WEBHOOK TIKTOK SHOP (bảng tiktok_webhook_logs) + WORKER NỀN
//
// Cùng khuôn shopee/webhook-queue.ts (anh Trung chốt 05/09/2026: nối shop TikTok
// thật BẮT BUỘC có queue trước). Route routes/webhooks.ts CHỈ verify chữ ký +
// INSERT một dòng rồi ack 200; worker ở đây xử lý sau:
//
//   · Chống trùng 2 tầng: (1) unique bodyHash — TikTok gửi lại y nguyên thì
//     insert bị chặn ngay; (2) nghiệp vụ idempotent: mỗi job KÉO LẠI chi tiết
//     đơn từ sàn (không tin trạng thái trong payload) + upsert theo
//     (channelId, orderCode) + mốc stockDeductedAt/stockRestoredAt.
//   · NHIỀU LÀN song song (TIKTOK_WEBHOOK_LANES) — sự kiện của CÙNG một đơn
//     không chạy song song trong cùng tiến trình (Set mã đơn đang xử lý); giữa
//     các tiến trình worker khác nhau thì claim bằng UPDATE có điều kiện + mỗi
//     job kéo trạng thái MỚI NHẤT từ sàn nên thứ tự sự kiện không còn quan trọng.
//   · Lỗi tạm thời (API sàn, DB): thử lại tối đa MAX_ATTEMPTS lần, giãn cách
//     nhân đôi qua nextRetryAt. Hết lượt → FAILED + InventorySyncAlert lên UI.
//   · Restart giữa chừng: job PROCESSING mồ côi được trả về PENDING lúc boot.
//
// Tên trường payload theo docs Webhook 202309 (type / tts_notification_id /
// shop_id / timestamp / data.order_id / data.order_status). Parser đọc phòng
// thủ cả kiểu đặt tên khác; ĐỐI CHIẾU LẠI khi nối shop thật (kế hoạch 16/09).
// ============================================================

import crypto from "crypto";
import { WebhookJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  findTiktokChannelByShopId,
  processTiktokAuthorizationEvent,
  processTiktokOrderEvent,
} from "./service";
import { enqueueStockPush } from "../inventory-push";
import { createSyncAlert } from "../shopee/inventory-sync";
import { describeChannelFailure } from "../../services/sync-alert-text";

/**
 * Loại sự kiện webhook TikTok Shop (trường `type`, dạng số) mà Hubsell quan tâm.
 * Mọi sự kiện ĐƠN HÀNG (1/3/11/12) xử lý CÙNG MỘT CÁCH: kéo lại chi tiết đơn
 * rồi upsert + tác động kho — nên hoãn/hủy/hoàn đều về đúng trạng thái sàn.
 */
export const TIKTOK_WEBHOOK_TYPE = {
  ORDER_STATUS_CHANGE: 1,
  PACKAGE_UPDATE: 3,
  SELLER_DEAUTHORIZATION: 5,
  CANCELLATION_STATUS_CHANGE: 11,
  RETURN_STATUS_CHANGE: 12,
} as const;

const ORDER_EVENT_TYPES: readonly number[] = [
  TIKTOK_WEBHOOK_TYPE.ORDER_STATUS_CHANGE,
  TIKTOK_WEBHOOK_TYPE.PACKAGE_UPDATE,
  TIKTOK_WEBHOOK_TYPE.CANCELLATION_STATUS_CHANGE,
  TIKTOK_WEBHOOK_TYPE.RETURN_STATUS_CHANGE,
];

export interface TiktokWebhookPayload {
  type?: number | string;
  tts_notification_id?: string;
  shop_id?: string | number;
  timestamp?: number;
  data?: {
    order_id?: string | number;
    orderId?: string | number;
    order_status?: string;
    [k: string]: unknown;
  };
}

/** Tổng số lần thử một job (1 lần đầu + 2 lần retry). */
const MAX_ATTEMPTS = 3;
/** Giãn cách trước lần retry đầu; các lần sau nhân đôi (30s → 60s). */
const BASE_RETRY_MS = 30 * 1000;
/** Nhịp worker tự quét job đến hạn retry / job tồn sau restart. */
const POLL_INTERVAL_MS = 15 * 1000;
/** Số làn xử lý song song trong một tiến trình worker (env TIKTOK_WEBHOOK_LANES). */
const LANES = Math.max(1, Math.min(8, Number(process.env.TIKTOK_WEBHOOK_LANES) || 3));

/** Đọc mã đơn trong payload — phòng thủ cả hai kiểu đặt tên. */
export function tiktokPayloadOrderId(payload: TiktokWebhookPayload): string {
  const raw = payload.data?.order_id ?? payload.data?.orderId;
  return raw == null ? "" : String(raw).trim();
}

/**
 * Phân loại sự kiện ở CỬA route: "order" cần mã đơn, "auth" chỉ cần shop_id,
 * null = ngoài phạm vi (sản phẩm, chat, ping…) → ack 200 và bỏ qua.
 */
export function classifyTiktokEvent(
  payload: TiktokWebhookPayload
): "order" | "auth" | null {
  const type = Number(payload.type);
  if (type === TIKTOK_WEBHOOK_TYPE.SELLER_DEAUTHORIZATION) return "auth";
  if (ORDER_EVENT_TYPES.includes(type)) return "order";
  return null;
}

/**
 * Ghi một sự kiện ĐÃ QUA verify chữ ký vào hàng đợi bền. Chỉ một INSERT —
 * route ack 200 ngay sau đó. `duplicate=true` = bản gửi lại y nguyên (đụng
 * unique bodyHash), bỏ qua êm.
 */
export async function enqueueTiktokWebhook(
  rawBody: Buffer | string,
  payload: TiktokWebhookPayload
): Promise<{ queued: boolean; duplicate: boolean }> {
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const orderId = tiktokPayloadOrderId(payload);
  try {
    await prisma.tiktokWebhookLog.create({
      data: {
        eventType: Number(payload.type) || 0,
        shopId: payload.shop_id != null ? String(payload.shop_id) : "",
        orderId: orderId || null,
        bodyHash,
        payload: JSON.stringify(payload),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return { queued: false, duplicate: true };
    }
    throw err; // lỗi DB thật — route trả 500 cho TikTok gửi lại sau
  }
  // Đánh thức worker trong cùng tiến trình (vai all/worker). Tiến trình vai
  // "web" chỉ enqueue — worker riêng tự nhặt theo nhịp POLL_INTERVAL_MS.
  if ((process.env.HUBSELL_ROLE ?? "all").trim().toLowerCase() !== "web") {
    void drain();
  }
  return { queued: true, duplicate: false };
}

// ---------- Worker ----------

let started = false;
let activeLanes = 0;
/** Mã đơn đang có job chạy dở trong tiến trình này — làn khác không cầm cùng đơn. */
const inFlightOrders = new Set<string>();

/**
 * Khởi động worker (gọi 1 lần từ workers/index.ts). Trả job PROCESSING mồ côi
 * (backend chết giữa chừng ở lần chạy trước) về PENDING rồi quét theo nhịp.
 */
export function startTiktokWebhookWorker(): void {
  if (started) return;
  started = true;

  void (async () => {
    const orphaned = await prisma.tiktokWebhookLog.updateMany({
      where: { status: WebhookJobStatus.PROCESSING },
      data: { status: WebhookJobStatus.PENDING },
    });
    if (orphaned.count > 0) {
      console.log(`[Webhook TikTok] Khôi phục ${orphaned.count} job dở dang sau restart`);
    }
    void drain();
  })().catch((err) => console.error("[Webhook TikTok] Lỗi khởi động worker:", err));

  setInterval(() => void drain(), POLL_INTERVAL_MS).unref();
}

/** Mở thêm làn cho tới trần LANES; mỗi làn tự chạy tới khi hết job đến hạn. */
async function drain(): Promise<void> {
  const lanes: Promise<void>[] = [];
  while (activeLanes < LANES) {
    activeLanes++;
    lanes.push(
      runLane().finally(() => {
        activeLanes--;
      })
    );
  }
  await Promise.all(lanes);
}

/**
 * MỘT LÀN: nhặt job đến hạn theo FIFO, bỏ qua đơn đang có làn khác cầm, claim
 * bằng UPDATE có điều kiện (nhiều tiến trình không xử lý đôi), xử lý, lặp.
 */
async function runLane(): Promise<void> {
  try {
    for (;;) {
      const busy = [...inFlightOrders];
      const job = await prisma.tiktokWebhookLog.findFirst({
        where: {
          status: WebhookJobStatus.PENDING,
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
          ...(busy.length ? { NOT: { orderId: { in: busy } } } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
      if (!job) break;

      const claimed = await prisma.tiktokWebhookLog.updateMany({
        where: { id: job.id, status: WebhookJobStatus.PENDING },
        data: { status: WebhookJobStatus.PROCESSING, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      if (job.orderId) inFlightOrders.add(job.orderId);
      try {
        await processJob(job.id, job.eventType, job.shopId, job.orderId, job.payload, job.attempts + 1);
      } finally {
        if (job.orderId) inFlightOrders.delete(job.orderId);
      }
    }
  } catch (err) {
    console.error("[Webhook TikTok] Lỗi vòng xử lý hàng đợi:", err);
  }
}

/** Xử lý một job đã claim: thành công → SUCCESS; lỗi → hẹn retry hoặc FAILED + cảnh báo. */
async function processJob(
  jobId: string,
  eventType: number,
  shopId: string,
  orderId: string | null,
  rawPayload: string,
  attempt: number
): Promise<void> {
  try {
    const note = await dispatchTiktokWebhookEvent(
      JSON.parse(rawPayload) as TiktokWebhookPayload
    );
    await prisma.tiktokWebhookLog.update({
      where: { id: jobId },
      data: { status: WebhookJobStatus.SUCCESS, processedAt: new Date(), lastError: note },
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error(
      `[Webhook TikTok] Job ${jobId} (type=${eventType}, đơn ${orderId ?? "?"}) lỗi lần ${attempt}/${MAX_ATTEMPTS}:`,
      err
    );
    if (attempt < MAX_ATTEMPTS) {
      await prisma.tiktokWebhookLog.update({
        where: { id: jobId },
        data: {
          status: WebhookJobStatus.PENDING,
          lastError: message,
          nextRetryAt: new Date(Date.now() + BASE_RETRY_MS * 2 ** (attempt - 1)),
        },
      });
    } else {
      await prisma.tiktokWebhookLog.update({
        where: { id: jobId },
        data: { status: WebhookJobStatus.FAILED, lastError: message },
      });
      await alertJobFailed(shopId, orderId, message);
    }
  }
}

/**
 * Bộ chia sự kiện cho worker. Ném lỗi = báo hàng đợi retry (lỗi tạm thời);
 * "không có gì để làm" (shop chưa nối, sàn không trả đơn) thì trả ghi chú và
 * kết thúc êm — retry cũng vô ích. Trả về ghi chú (lưu vào lastError để tra
 * soát) hoặc null khi xử lý trọn vẹn.
 */
export async function dispatchTiktokWebhookEvent(
  payload: TiktokWebhookPayload
): Promise<string | null> {
  const shopId = payload.shop_id != null ? String(payload.shop_id) : "";
  if (!shopId) return "thiếu shop_id";
  const kind = classifyTiktokEvent(payload);

  if (kind === "auth") {
    const r = await processTiktokAuthorizationEvent(shopId);
    console.log(`[Webhook TikTok] Ủy quyền shop ${shopId} →`, r?.status ?? "shop chưa nối");
    return r ? null : "shop chưa kết nối Hubsell";
  }

  if (kind === "order") {
    const orderId = tiktokPayloadOrderId(payload);
    if (!orderId) return "thiếu order_id";
    const channel = await findTiktokChannelByShopId(shopId);
    if (!channel) return "shop chưa kết nối Hubsell";

    const result = await processTiktokOrderEvent(channel, orderId);
    console.log(
      `[Webhook TikTok] type=${payload.type} đơn ${orderId} (shop ${shopId}) →`,
      JSON.stringify({ ...result, productIds: result.productIds?.length })
    );
    if (!result.found) return "sàn không trả chi tiết đơn";

    // Kho biến động → đẩy "có thể bán" mới lên các gian khác đã nối cùng SKU
    // + kiểm tra ngưỡng sắp hết hàng. Chạy SAU khi transaction đơn đã commit —
    // lỗi đẩy sàn có retry + cảnh báo riêng, không kéo job đơn chạy lại.
    if (result.productIds?.length) {
      await enqueueStockPush(result.productIds, { source: `webhook TikTok đơn ${orderId}` });
    }
    return null;
  }

  return `bỏ qua type=${payload.type}`;
}

/** Job hỏng hẳn sau MAX_ATTEMPTS lần — bắn cảnh báo lên UI cho chủ shop xử lý tay. */
async function alertJobFailed(
  shopId: string,
  orderId: string | null,
  message: string
): Promise<void> {
  const channel = await findTiktokChannelByShopId(shopId).catch(() => null);
  if (!channel) return;
  await createSyncAlert(channel.id, {
    orderSn: orderId ?? undefined,
    message: describeChannelFailure(
      channel.shopName,
      `sự kiện TikTok${orderId ? ` đơn ${orderId}` : ""} xử lý thất bại sau ${MAX_ATTEMPTS} lần: ${message}`
    ),
  });
}

/** Cho test/giám sát: số job đang chờ hoặc đang xử lý. */
export async function tiktokWebhookQueueSize(): Promise<number> {
  return prisma.tiktokWebhookLog.count({
    where: { status: { in: [WebhookJobStatus.PENDING, WebhookJobStatus.PROCESSING] } },
  });
}

/** Cho integration test: chạy MỘT lượt drain và đợi xong. Không dùng ở luồng thật. */
export async function drainTiktokWebhookQueueOnce(): Promise<void> {
  await drain();
}
