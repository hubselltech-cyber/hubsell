// ============================================================
// CỜ "KHÁCH XIN HỦY ĐƠN, CHỜ SHOP QUYẾT" — phần dùng chung 3 sàn (23/10/2026).
//
// Trục riêng trên Order (cancelRequestedAt / Reason / Ref / DueAt), KHÔNG đổi
// shippingStatus: đơn đã chuẩn bị hàng vẫn là "Đã xử lý" cho tới khi sàn chốt.
// Nguồn từng sàn: Shopee order_status IN_CANCEL (shopee/service.ts), TikTok
// cancellations/search BUYER_CANCEL đang PENDING (tiktok/cancel-requests.ts),
// Lazada reverse order request_type CANCEL còn sống (lazada/returns-sync.ts).
// Khảo sát + trích docs: docs/HUY-DON-SAU-CHUAN-BI-HANG-KHAO-SAT.md.
// ============================================================

import type { Channel } from "@prisma/client";
import { ShippingStatus } from "@prisma/client";
import { notify } from "../services/notifications";

/** Bản ghi xóa cờ — sàn đã chốt (hủy hẳn → CANCELLED, hoặc tiếp tục giao). */
export const CLEAR_CANCEL_REQUEST = {
  cancelRequestedAt: null,
  cancelRequestReason: null,
  cancelRequestRef: null,
  cancelRequestDueAt: null,
} as const;

/** Đường dẫn web lọc sẵn đơn đang chờ quyết (deep-link từ chuông). */
export const CANCEL_REQUEST_LINK = "/orders?cancelRequested=1";

/**
 * Rung chuông cho chủ shop khi một đơn VỪA có yêu cầu hủy. notify tự chống
 * trùng (cùng tiêu đề chưa đọc trong 24 h) và nuốt lỗi — gọi sau khi giao dịch
 * đơn đã ghi, không làm hỏng luồng đồng bộ.
 */
export async function notifyCancelRequest(
  channel: Pick<Channel, "userId" | "shopName">,
  orderCode: string,
  reason: string | null,
  dueAt: Date | null
): Promise<void> {
  const parts = [`Gian ${channel.shopName}.`];
  if (reason) parts.push(`Lý do khách: ${reason}.`);
  if (dueAt) parts.push(`Hạn trả lời: ${dueAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.`);
  parts.push("Vào Đơn hàng → Chấp nhận hoặc Từ chối; không trả lời thì sàn tự hủy.");
  await notify(channel.userId, {
    type: "cancel_request",
    title: `Khách xin hủy đơn ${orderCode}`,
    body: parts.join(" "),
    link: CANCEL_REQUEST_LINK,
  });
}

/** Số giờ còn lại tới hạn (âm = quá hạn), để log/thông báo. */
export function hoursUntil(dueAt: Date | null, now: Date = new Date()): number | null {
  if (!dueAt) return null;
  return Math.round(((dueAt.getTime() - now.getTime()) / 36e5) * 10) / 10;
}

// ─────────────────── ĐƠN ĐÃ CHUẨN BỊ HÀNG BỊ HỦY (23/10/2026 tối) ───────────────────
//
// Anh Trung thử thật: khách hủy đơn đã chuẩn bị nhưng không có thông báo — pha
// "xin hủy" (IN_CANCEL / BUYER_CANCEL pending) có thể trôi qua giữa hai lượt đọc
// sàn, hoặc sàn hủy thẳng. Lưới đỡ: khi đồng bộ thấy đơn đang Đã xử lý / Đang giao
// chuyển sang Đã hủy → chuông ngay, kèm ai hủy + lý do nếu sàn trả. Shop tự hủy
// (seller) thì không báo — chính mình bấm.

const PREPARED_STATUSES = new Set<ShippingStatus>([ShippingStatus.PROCESSED, ShippingStatus.SHIPPING]);
const STATUS_LABEL: Partial<Record<ShippingStatus, string>> = {
  [ShippingStatus.PROCESSED]: "đã chuẩn bị hàng",
  [ShippingStatus.SHIPPING]: "đang giao",
};

export interface OrderCancelledInfo {
  prevStatus: ShippingStatus;
  /** Shopee cancel_by (buyer/seller/system), TikTok cancellation_initiator (BUYER/SELLER/SYSTEM); Lazada null. */
  by: string | null;
  reason: string | null;
}

/** true khi đáng rung chuông: đơn đã chuẩn bị / đang giao, và không phải shop tự hủy. */
export function shouldNotifyOrderCancelled(info: OrderCancelledInfo): boolean {
  if (!PREPARED_STATUSES.has(info.prevStatus)) return false;
  const by = (info.by ?? "").toLowerCase();
  return by !== "seller" && by !== "shop";
}

export async function notifyOrderCancelledAfterPrepare(
  channel: Pick<Channel, "userId" | "shopName">,
  orderCode: string,
  info: OrderCancelledInfo
): Promise<void> {
  if (!shouldNotifyOrderCancelled(info)) return;
  const by = (info.by ?? "").toLowerCase();
  const who = by === "system" ? "Sàn" : "Khách";
  const parts = [`Gian ${channel.shopName}. ${who} hủy khi đơn ${STATUS_LABEL[info.prevStatus] ?? "đã xử lý"}.`];
  if (info.reason) parts.push(`Lý do: ${info.reason}.`);
  parts.push("Rút kiện khỏi lô giao; hàng về kho thì nhập lại.");
  await notify(channel.userId, {
    type: "order_cancelled",
    title: `Đơn ${orderCode} bị hủy sau khi đã chuẩn bị hàng`,
    body: parts.join(" "),
    link: `/orders?search=${encodeURIComponent(orderCode)}`,
  });
}
