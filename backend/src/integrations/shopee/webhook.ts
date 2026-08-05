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
import { getBackendBaseUrl } from "../../backend-url";
import { getShopeeConfig } from "./config";

// ---------- 1. Xác thực chữ ký ----------
//
// Shopee ký MỖI request push bằng HMAC-SHA256(partner_key) trên chuỗi:
//     base_string = webhook_url + "|" + raw_request_body
// và gửi kết quả (hex) trong header `Authorization`. webhook_url phải là URL
// ĐĂNG KÝ TRÊN CONSOLE (không lấy từ req — proxy/tunnel làm sai host nội bộ).

/**
 * URL webhook đã đăng ký trên Shopee Console — phần tử của chuỗi ký. Mặc định
 * suy từ URL gốc backend (Render: https://<app>.onrender.com/api/webhook/shopee)
 * — URL khai trên Console phải TRÙNG TỪNG KÝ TỰ với giá trị này, lệch là mọi
 * push đều rớt verify. Đặt SHOPEE_WEBHOOK_URL chỉ khi cần ghi đè (vd sandbox
 * local đăng ký http://hubsell.tech/api/webhook/shopee).
 */
export function getShopeeWebhookUrl(): string {
  return (
    process.env.SHOPEE_WEBHOOK_URL ??
    `${getBackendBaseUrl()}/api/webhook/shopee`
  );
}

/**
 * Key ký push. Shopee Console cấp "Push Partner Key" RIÊNG cho Push Mechanism
 * (thấy ở trang Set Push — KHÁC API Partner Key `shpk...`): push thật từ server
 * Shopee ký bằng key này. Không đặt SHOPEE_PUSH_PARTNER_KEY thì rơi về API key
 * (tương thích test tự ký cũ trong vitest).
 */
export function getShopeePushPartnerKey(): string {
  return process.env.SHOPEE_PUSH_PARTNER_KEY || getShopeeConfig().partnerKey;
}

/**
 * Kiểm chữ ký webhook trên body THÔ (Buffer/string nguyên văn — JSON.parse rồi
 * serialize lại sẽ đảo thứ tự khoá/khoảng trắng làm sai chữ ký).
 * So sánh bằng timingSafeEqual để tránh timing attack.
 *
 * Chấp nhận chữ ký ký bằng Push Partner Key HOẶC API Partner Key: cú ping
 * "Verify" của Console Live bắn TRƯỚC khi Push Key được lưu bên Shopee nên có
 * thể được ký bằng API key; push thật sau khi Save ký bằng Push Key. Cả hai
 * đều là secret của app — nhận thêm key thứ hai không nới cửa cho bên ngoài.
 */
export function verifyShopeeWebhookSignature(
  rawBody: Buffer | string,
  authorizationHeader: string | undefined,
  webhookUrl: string = getShopeeWebhookUrl(),
  partnerKey?: string
): boolean {
  if (!authorizationHeader) return false;
  const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const keys = partnerKey
    ? [partnerKey]
    : [...new Set([getShopeePushPartnerKey(), getShopeeConfig().partnerKey])];
  const got = authorizationHeader.trim().toLowerCase();
  const b = Buffer.from(got, "utf8");
  for (const key of keys) {
    const expected = crypto
      .createHmac("sha256", key)
      .update(`${webhookUrl}|${bodyStr}`)
      .digest("hex");
    const a = Buffer.from(expected, "utf8");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  // Log chẩn đoán khi trượt chữ ký (KHÔNG in key/chữ ký đầy đủ): đủ để phân
  // biệt "sai key" với "sai URL ký" khi soi log Render.
  console.warn(
    `[Webhook Shopee] Chữ ký không khớp — url ký="${webhookUrl}", sig=${got.slice(0, 8)}…, body=${bodyStr.length} byte, đã thử ${keys.length} key`
  );
  return false;
}

// ---------- 2. Payload & mã sự kiện ----------

/** Mã sự kiện Shopee mà Hubsell xử lý; loại khác ack 200 và bỏ qua.
 *
 * Số lấy theo cột Push Code trên Console Live (đã đối chiếu 05/08/2026):
 * 1 = shop_authorization_push, 2 = shop_authorization_canceled_push,
 * 3 = order_status_push, 4 = order_trackingno_push. LƯU Ý: code 5 là
 * shopee_updates (thông báo chung của sàn) — bản cũ nhầm 5 là authorization. */
export const SHOPEE_PUSH_CODE = {
  /** Shop uỷ quyền / gia hạn quyền cho app. */
  AUTHORIZATION: 1,
  /** Shop THU HỒI uỷ quyền — xử lý cùng nhánh (verify token rồi cập nhật status). */
  DEAUTHORIZATION: 2,
  /** Đơn hàng đổi trạng thái (đơn mới / hủy / giao...). */
  ORDER_STATUS: 3,
  /** Đơn có mã vận đơn — payload cũng mang ordersn, xử lý như sự kiện đơn. */
  TRACKING_NO: 4,
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
