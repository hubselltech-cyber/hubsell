// ============================================================
// HỘP THƯ ĐẾN WEBHOOK (bảng webhook_events) — giai đoạn 2 kiến trúc quy mô,
// docs/HANG-DOI-BEN.md mục 3.3.
//
// Đường nhận chung cho sự kiện ĐƠN của các sàn: mỗi sự kiện = một dòng
// webhook_events, ghi CHUNG GIAO DỊCH với việc xếp hàng đợi evt.order. Đã ghi
// được dòng thì chắc chắn có việc xử lý; không ghi được thì nơi gọi biết ngay.
//
// Việc trong evt.order là "kéo lại đơn X của shop Y từ sàn", KHÔNG phải "xử lý
// sự kiện Z": handler không tin trạng thái trong sự kiện mà luôn kéo trạng thái
// mới nhất. Nên nhiều sự kiện dồn dập của một đơn gộp thành một việc (hàng đợi
// "gộp theo khóa": mỗi khóa tối đa 1 việc chờ + 1 việc đang chạy).
//
// Vì sao gộp mà không sót: sự kiện E hoặc tạo việc mới (chạy sau E), hoặc bị
// gộp vào một việc ĐANG CHỜ — việc đó chưa bắt đầu nên lượt kéo của nó diễn ra
// sau E. Cả hai trường hợp đều có một lượt kéo sau E.
//
// Đánh dấu dòng: handler xong thì chuyển MỌI dòng đang chờ của đơn đó sang
// SUCCESS (kể cả dòng đến giữa lúc đang xử lý — dòng đó đã tự tạo một việc mới
// vì việc cũ đang chạy, nên đánh dấu sớm không làm sót lượt kéo nào).
// ============================================================

import crypto from "crypto";
import { WebhookJobStatus } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { enqueue, QUEUES } from "../lib/queue";

/** Sàn có sự kiện đơn đi qua hộp thư đến. Thêm sàn = thêm handler ở workers/event-queue.ts. */
export type OrderEventSource = "SHOPEE" | "LAZADA" | "TIKTOK";

/** Dữ liệu của một việc evt.order. */
export interface OrderEventJob {
  source: OrderEventSource;
  /** Mã shop phía sàn (shop_id / seller_id). */
  shopId: string;
  /** Mã đơn phía sàn. */
  orderId: string;
}

/** Khóa gộp việc: một đơn của một shop trên một sàn. */
export function orderEventKey(job: OrderEventJob): string {
  return `${job.source}:${job.shopId}:${job.orderId}`;
}

export interface RecordOrderEventInput extends OrderEventJob {
  /** Loại sự kiện theo cách gọi của sàn — chỉ để tra soát. */
  eventType: string;
  /** Thân thô đã qua kiểm chữ ký — băm để chặn sàn gửi lại y nguyên. */
  rawBody: Buffer | string;
  payload: unknown;
}

export interface RecordOrderEventResult {
  /** true = sàn gửi lại y nguyên một sự kiện đã nhận; không ghi gì thêm. */
  duplicate: boolean;
  /** true = tạo việc mới; false = gộp vào việc đang chờ của cùng đơn (hoặc trùng). */
  queued: boolean;
}

/**
 * Ghi một sự kiện đơn ĐÃ QUA kiểm chữ ký + xếp việc, trong một giao dịch.
 * Ném khi database lỗi hoặc hàng đợi chưa sẵn sàng — nơi gọi quyết định trả gì cho sàn.
 */
export async function recordOrderEvent(input: RecordOrderEventInput): Promise<RecordOrderEventResult> {
  const bodyHash = crypto.createHash("sha256").update(input.rawBody).digest("hex");
  const job: OrderEventJob = { source: input.source, shopId: input.shopId, orderId: input.orderId };
  return prisma.$transaction(async (tx) => {
    // createMany + skipDuplicates thay cho create + bắt P2002: lỗi trùng khóa
    // bên trong giao dịch sẽ làm hỏng cả giao dịch.
    const inserted = await tx.webhookEvent.createMany({
      data: [
        {
          source: input.source,
          eventType: input.eventType,
          shopId: input.shopId,
          entityId: input.orderId,
          bodyHash,
          payload: JSON.stringify(input.payload),
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return { duplicate: true, queued: false };
    const sent = await enqueue(QUEUES.evtOrder, job, { key: orderEventKey(job), tx });
    return { duplicate: false, queued: sent.queued };
  });
}

// Ba hàm đánh dấu dùng SQL có chữ 'PENDING' viết thẳng để đi theo chỉ mục riêng
// phần webhook_events_pending_entity_idx (truyền trạng thái bằng tham số thì kế
// hoạch chung không dùng được chỉ mục riêng phần).

/** Handler xong: mọi dòng đang chờ của đơn → SUCCESS. `note` lưu vào lastError để tra soát. */
export async function markOrderEventsDone(job: OrderEventJob, attempts: number, note: string | null): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "webhook_events"
    SET "status" = ${WebhookJobStatus.SUCCESS}::"WebhookJobStatus", "processedAt" = NOW(),
        "attempts" = ${attempts}, "lastError" = ${note}
    WHERE "source" = ${job.source} AND "shopId" = ${job.shopId} AND "entityId" = ${job.orderId}
      AND "status" = 'PENDING'`;
}

/** Một lượt hỏng, còn thử lại: giữ PENDING, ghi lỗi + số lượt đã thử. */
export async function markOrderEventsError(job: OrderEventJob, attempts: number, message: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "webhook_events"
    SET "attempts" = ${attempts}, "lastError" = ${message.slice(0, 2000)}
    WHERE "source" = ${job.source} AND "shopId" = ${job.shopId} AND "entityId" = ${job.orderId}
      AND "status" = 'PENDING'`;
}

/**
 * Hết lượt thử: dòng còn chờ → FAILED. Trả lỗi cuối đã ghi (null khi không còn
 * dòng nào chờ — tức một việc khác của cùng đơn đã xử lý xong, không cần báo).
 */
export async function markOrderEventsFailed(job: OrderEventJob): Promise<{ failed: number; lastError: string | null }> {
  const rows = await prisma.$queryRaw<{ lastError: string | null }[]>`
    UPDATE "webhook_events"
    SET "status" = ${WebhookJobStatus.FAILED}::"WebhookJobStatus"
    WHERE "source" = ${job.source} AND "shopId" = ${job.shopId} AND "entityId" = ${job.orderId}
      AND "status" = 'PENDING'
    RETURNING "lastError"`;
  return { failed: rows.length, lastError: rows.find((r) => r.lastError)?.lastError ?? null };
}
