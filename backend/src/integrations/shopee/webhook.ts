// ============================================================
// SHOPEE WEBHOOK (Push Mechanism) — XÁC THỰC CHỮ KÝ + KIỂU PAYLOAD
//
// Shopee yêu cầu endpoint push phản hồi 200 trong <3 giây, quá hạn nhiều lần sẽ
// bị đánh dấu chết và NGỪNG push. Route chỉ làm 2 việc nhanh: (1) verify chữ ký
// trên RAW BODY (ở đây), (2) ghi sự kiện vào HÀNG ĐỢI BỀN rồi ack 200 (xem
// webhook-queue.ts — bảng shopee_webhook_logs + worker FIFO, sống sót restart).
// File này KHÔNG đụng Prisma — chỉ chữ ký + kiểu dữ liệu dùng chung.
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

// (Hàng đợi in-memory cũ đã được thay bằng HÀNG ĐỢI BỀN trong webhook-queue.ts:
// bảng shopee_webhook_logs — dedup bền theo hash raw body, worker FIFO, retry
// giãn cách nhân đôi, sống sót qua restart.)
