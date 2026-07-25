// ============================================================
// SHOPEE WEBHOOK (Push Mechanism) — XÁC THỰC CHỮ KÝ + HÀNG ĐỢI NỀN
//
// Shopee yêu cầu endpoint push phản hồi 200 trong <3 giây, quá hạn nhiều lần sẽ
// bị đánh dấu chết và NGỪNG push. Vì vậy route chỉ làm 2 việc nhanh: (1) verify
// chữ ký trên RAW BODY, (2) ack 200 rồi đẩy sự kiện vào hàng đợi trong tiến
// trình để xử lý DB/API phía sau. File này KHÔNG đụng Prisma — phần nghiệp vụ
// (kéo chi tiết đơn, upsert, trừ/hoàn kho) nằm ở service.ts.
// ============================================================

import crypto from "crypto";
import { getShopeeConfig } from "./config";

// ---------- 1. Xác thực chữ ký ----------
//
// Shopee ký MỖI request push bằng HMAC-SHA256(partner_key) trên chuỗi:
//     base_string = webhook_url + "|" + raw_request_body
// và gửi kết quả (hex) trong header `Authorization`. webhook_url phải là URL
// ĐĂNG KÝ TRÊN CONSOLE (không lấy từ req — proxy/tunnel làm sai host nội bộ).

/** URL webhook đã đăng ký trên Shopee Console — phần tử của chuỗi ký. */
export function getShopeeWebhookUrl(): string {
  return (
    process.env.SHOPEE_WEBHOOK_URL ??
    "http://hubsell.tech/api/webhook/shopee"
  );
}

/**
 * Kiểm chữ ký webhook trên body THÔ (Buffer/string nguyên văn — JSON.parse rồi
 * serialize lại sẽ đảo thứ tự khoá/khoảng trắng làm sai chữ ký).
 * So sánh bằng timingSafeEqual để tránh timing attack.
 */
export function verifyShopeeWebhookSignature(
  rawBody: Buffer | string,
  authorizationHeader: string | undefined,
  webhookUrl: string = getShopeeWebhookUrl(),
  partnerKey: string = getShopeeConfig().partnerKey
): boolean {
  if (!authorizationHeader) return false;
  const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto
    .createHmac("sha256", partnerKey)
    .update(`${webhookUrl}|${bodyStr}`)
    .digest("hex");
  const got = authorizationHeader.trim().toLowerCase();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- 2. Payload & mã sự kiện ----------

/** Mã sự kiện Shopee mà Hubsell xử lý; loại khác ack 200 và bỏ qua. */
export const SHOPEE_PUSH_CODE = {
  /** Sắp xếp lịch lấy hàng (logistics) — đơn đã có, cập nhật vận chuyển. */
  LOGISTICS: 3,
  /** Đơn hàng đổi trạng thái (đơn mới / hủy / giao...). */
  ORDER_STATUS: 4,
  /** Thay đổi uỷ quyền app (shop gia hạn / thu hồi quyền). */
  AUTHORIZATION: 5,
} as const;

export interface ShopeePushPayload {
  code?: number;
  shop_id?: number | string;
  timestamp?: number;
  data?: {
    ordersn?: string;
    order_sn?: string; // một số bản push dùng snake khác — nhận cả hai
    status?: string;
    update_time?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ---------- 3. Hàng đợi nền + chống trùng lặp ----------
//
// Shopee retry cùng MỘT sự kiện khi mạng lag → hai tầng chống trùng:
//   Tầng 1 (ở đây): dedup theo SHA-256 của raw body trong cửa sổ 10 phút —
//     bản retry y nguyên bị chặn ngay, không tốn lượt gọi API/DB.
//   Tầng 2 (service): upsert idempotent theo (channelId, order_sn) + mốc
//     stockDeductedAt/stockRestoredAt nên sự kiện lọt lưới cũng không ghi trùng.

type ShopeeWebhookHandler = (payload: ShopeePushPayload) => Promise<void>;

interface QueueJob {
  payload: ShopeePushPayload;
  attempts: number;
}

const DEDUP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30 * 1000;

const seenBodies = new Map<string, number>(); // hash raw body → timestamp nhận
const queue: QueueJob[] = [];
let draining = false;
let handler: ShopeeWebhookHandler | null = null;

/** service.ts đăng ký hàm xử lý thật; tách rời để file này không import Prisma. */
export function setShopeeWebhookHandler(h: ShopeeWebhookHandler): void {
  handler = h;
}

function pruneSeen(now: number): void {
  for (const [k, t] of seenBodies) {
    if (now - t > DEDUP_TTL_MS) seenBodies.delete(k);
  }
}

/**
 * Nhận một sự kiện ĐÃ QUA verify chữ ký: dedup theo raw body rồi xếp hàng xử lý
 * nền. Trả về ngay (không await xử lý) để route kịp ack 200 <3s theo yêu cầu
 * Shopee. `duplicate=true` nghĩa là bản retry y nguyên đã nhận trước đó.
 */
export function enqueueShopeeWebhook(
  rawBody: Buffer | string,
  payload: ShopeePushPayload
): { queued: boolean; duplicate: boolean } {
  const now = Date.now();
  pruneSeen(now);
  const hash = crypto.createHash("sha256").update(rawBody).digest("hex");
  if (seenBodies.has(hash)) {
    return { queued: false, duplicate: true };
  }
  seenBodies.set(hash, now);
  queue.push({ payload, attempts: 0 });
  void drain();
  return { queued: true, duplicate: false };
}

/** Xử lý tuần tự từng job (tránh dồn dập nhiều transaction song song lên DB). */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        if (!handler) throw new Error("Chưa đăng ký handler webhook Shopee");
        await handler(job.payload);
      } catch (err) {
        job.attempts += 1;
        console.error(
          `[Webhook Shopee] Xử lý lỗi (lần ${job.attempts}/${MAX_ATTEMPTS}) code=${job.payload.code}:`,
          err
        );
        if (job.attempts < MAX_ATTEMPTS) {
          // Lỗi tạm thời (API sàn/DB) → thử lại sau, không chặn các job khác.
          setTimeout(() => {
            queue.push(job);
            void drain();
          }, RETRY_DELAY_MS);
        }
      }
    }
  } finally {
    draining = false;
  }
}

/** Cho test/giám sát: số job đang chờ trong hàng đợi. */
export function shopeeWebhookQueueSize(): number {
  return queue.length;
}
