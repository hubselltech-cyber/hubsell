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
