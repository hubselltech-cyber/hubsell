// ============================================================
// VIỆC SỰ KIỆN TIKTOK SHOP của hàng đợi bền pg-boss (workers/event-queue.ts,
// docs/HANG-DOI-BEN.md mục 4.3) + phần đọc payload webhook.
//
// Route (routes/webhooks.ts) kiểm chữ ký, phân loại sự kiện, ghi webhook_events
// + xếp việc evt.order / evt.auth trong một giao dịch rồi ack; worker gọi các
// hàm handle* dưới đây. Mỗi việc KÉO LẠI chi tiết đơn từ sàn (không tin trạng
// thái trong payload) + upsert theo (channelId, orderCode) nên thứ tự sự kiện
// không quan trọng.
//
// Trước 05/10/2026 tệp này còn chứa hàng đợi cũ trên bảng tiktok_webhook_logs
// (nhiều làn trong RAM). Đường đó đã gỡ ở bước 6b; bảng còn giữ tới sau
// 31/10/2026 chỉ để HQ tra nhật ký cũ.
//
// Tên trường payload theo docs Webhook 202309 (type / tts_notification_id /
// shop_id / timestamp / data.order_id / data.order_status). Parser đọc phòng
// thủ cả kiểu đặt tên khác.
// ============================================================

import {
  findTiktokChannelByShopId,
  processTiktokAuthorizationEvent,
  processTiktokOrderEvent,
} from "./service";
import { finishStockPush } from "../inventory-push";
import { createSyncAlert } from "../shopee/inventory-sync";
import { describeChannelFailure } from "../../services/sync-alert-text";

/**
 * Loại sự kiện webhook TikTok Shop (trường `type`, dạng số) — ĐỐI CHIẾU bảng
 * "Quản lý webhook" trên Console app Hubsell 16/09/2026 (bản nháp theo docs
 * trước đó sai số: kiện hàng là 4 không phải 3, thu hồi ủy quyền là 6 không
 * phải 5). Mọi sự kiện ĐƠN HÀNG xử lý CÙNG MỘT CÁCH: kéo lại chi tiết đơn rồi
 * upsert + tác động kho — nên hoãn/hủy/hoàn/đổi địa chỉ đều về đúng trạng thái sàn.
 */
export const TIKTOK_WEBHOOK_TYPE = {
  ORDER_STATUS_CHANGE: 1,
  /** "Cập nhật trạng thái hoàn lại" (hủy/chỉ hoàn tiền/trả hàng — bản cũ). */
  REVERSE_STATUS_UPDATE: 2,
  RECIPIENT_ADDRESS_UPDATE: 3,
  PACKAGE_UPDATE: 4,
  PRODUCT_STATUS_CHANGE: 5,
  SELLER_DEAUTHORIZATION: 6,
  AUTHORIZATION_EXPIRE: 7,
  CANCELLATION_STATUS_CHANGE: 11,
  RETURN_STATUS_CHANGE: 12,
  NEW_CONVERSATION: 13,
} as const;

const ORDER_EVENT_TYPES: readonly number[] = [
  TIKTOK_WEBHOOK_TYPE.ORDER_STATUS_CHANGE,
  TIKTOK_WEBHOOK_TYPE.REVERSE_STATUS_UPDATE,
  TIKTOK_WEBHOOK_TYPE.RECIPIENT_ADDRESS_UPDATE,
  TIKTOK_WEBHOOK_TYPE.PACKAGE_UPDATE,
  TIKTOK_WEBHOOK_TYPE.CANCELLATION_STATUS_CHANGE,
  TIKTOK_WEBHOOK_TYPE.RETURN_STATUS_CHANGE,
];
const AUTH_EVENT_TYPES: readonly number[] = [
  TIKTOK_WEBHOOK_TYPE.SELLER_DEAUTHORIZATION,
  TIKTOK_WEBHOOK_TYPE.AUTHORIZATION_EXPIRE,
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
  if (AUTH_EVENT_TYPES.includes(type)) return "auth";
  if (ORDER_EVENT_TYPES.includes(type)) return "order";
  return null;
}

// ---------- Việc của hàng đợi bền pg-boss (workers/event-queue.ts) ----------

/**
 * Kéo lại MỘT đơn từ sàn rồi upsert + tác động kho. Ném lỗi = hỏng lượt này
 * (hàng đợi tự thử lại); trả ghi chú khi không có gì để làm, null khi trọn vẹn.
 */
export async function handleTiktokOrderJob(
  shopId: string,
  orderId: string,
  eventType?: number | string
): Promise<string | null> {
  const channel = await findTiktokChannelByShopId(shopId);
  if (!channel) return "shop chưa kết nối Hubsell";

  const result = await processTiktokOrderEvent(channel, orderId);
  console.log(
    `[Webhook TikTok] ${eventType != null ? `type=${eventType} ` : ""}đơn ${orderId} (shop ${shopId}) →`,
    JSON.stringify({ ...result, stockTicket: undefined, productIds: result.productIds?.length })
  );
  if (!result.found) return "sàn không trả chi tiết đơn";

  // Kho biến động → đẩy "có thể bán" mới lên các gian khác đã nối cùng SKU
  // + kiểm tra ngưỡng sắp hết hàng. Dòng chờ đẩy do processTiktokOrderEvent lập
  // phiếu ngay trong giao dịch đơn; ở đây chốt phiếu SAU khi giao dịch đã commit.
  // Lỗi đẩy sàn có retry + cảnh báo riêng, không kéo việc đơn chạy lại.
  await finishStockPush(result.stockTicket);
  return null;
}

/** Sự kiện thu hồi / hết hạn ủy quyền của một shop. */
export async function handleTiktokAuthJob(shopId: string): Promise<string | null> {
  const r = await processTiktokAuthorizationEvent(shopId);
  console.log(`[Webhook TikTok] Ủy quyền shop ${shopId} →`, r?.status ?? "shop chưa nối");
  return r ? null : "shop chưa kết nối Hubsell";
}

/** Việc của hàng đợi bền hỏng hẳn sau khi hết lượt thử — cảnh báo lên UI cho chủ shop xử lý tay. */
export async function alertTiktokJobFailed(
  shopId: string,
  orderId: string | null,
  attempts: number,
  message: string
): Promise<void> {
  const channel = await findTiktokChannelByShopId(shopId).catch(() => null);
  if (!channel) return;
  await createSyncAlert(channel.id, {
    orderSn: orderId ?? undefined,
    message: describeChannelFailure(
      channel.shopName,
      `sự kiện TikTok${orderId ? ` đơn ${orderId}` : ""} xử lý thất bại sau ${attempts} lần: ${message}`
    ),
  });
}
