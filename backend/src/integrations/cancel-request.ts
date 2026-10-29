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

/** Đơn đã chuẩn bị hàng / đang giao — khách hủy lúc này là ca shop phải xử lý kiện. */
const PREPARED_STATUSES = new Set<ShippingStatus>([ShippingStatus.PROCESSED, ShippingStatus.SHIPPING]);

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
  channel: Pick<Channel, "userId" | "shopName" | "channelName">,
  orderCode: string,
  reason: string | null,
  dueAt: Date | null,
  opts: { prevStatus?: ShippingStatus | null } = {}
): Promise<void> {
  // Chuẩn chữ anh Trung chốt 23/10 tối: "Khách yêu cầu hủy một đơn hàng đã chuẩn
  // bị hàng + mã đơn + tên sàn + tên shop, vui lòng xử lý".
  const prepared = opts.prevStatus != null && PREPARED_STATUSES.has(opts.prevStatus);
  const parts = [`${channelLabel(channel.channelName)} · ${channel.shopName}.`];
  parts.push(
    `Vui lòng xử lý: Chấp nhận hoặc Từ chối trong Đơn hàng${
      dueAt ? ` trước ${dueAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : ""
    }; không trả lời thì sàn tự hủy.`
  );
  if (reason) parts.push(`Lý do khách: ${reason}.`);
  await notify(channel.userId, {
    type: "cancel_request",
    title: prepared
      ? `Khách yêu cầu hủy đơn đã chuẩn bị hàng ${orderCode}`
      : `Khách yêu cầu hủy đơn ${orderCode}`,
    body: parts.join(" "),
    link: CANCEL_REQUEST_LINK,
  });
}

const CHANNEL_LABELS: Record<string, string> = { SHOPEE: "Shopee", LAZADA: "Lazada", TIKTOK: "TikTok", OFFLINE: "Offline" };
function channelLabel(name: string): string {
  return CHANNEL_LABELS[name] ?? name;
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

const STATUS_LABEL: Partial<Record<ShippingStatus, string>> = {
  [ShippingStatus.PROCESSED]: "đã chuẩn bị hàng",
  [ShippingStatus.SHIPPING]: "đang giao",
};

export interface OrderCancelledInfo {
  prevStatus: ShippingStatus;
  /** Shopee cancel_by (buyer/seller/system), TikTok cancellation_initiator (BUYER/SELLER/SYSTEM); Lazada null. */
  by: string | null;
  reason: string | null;
  /** Lát A 29/10/2026: kiện đã bàn giao sẽ quay đầu — đơn đã được cắm Chờ hàng về. */
  returning?: boolean;
}

/** true khi đáng rung chuông: đơn đã chuẩn bị / đang giao, và không phải shop tự hủy. */
export function shouldNotifyOrderCancelled(info: OrderCancelledInfo): boolean {
  if (!PREPARED_STATUSES.has(info.prevStatus)) return false;
  const by = (info.by ?? "").toLowerCase();
  return by !== "seller" && by !== "shop";
}

/** Chữ chuông (thuần, có test): ai hủy, lý do sàn trả, việc kho cần làm. */
export function orderCancelledMessage(
  channel: Pick<Channel, "shopName" | "channelName">,
  orderCode: string,
  info: OrderCancelledInfo
): { title: string; body: string; link: string } {
  const by = (info.by ?? "").toLowerCase();
  // Kiện quay đầu mà sàn không nói ai hủy (Lazada) thì là sàn / hãng hủy, không phải khách.
  const who = by === "system" || (info.returning && !by) ? "Sàn" : "Khách";
  const parts = [
    `${channelLabel(channel.channelName)} · ${channel.shopName}. Sàn đã chấp nhận hủy ngay khi đơn ${STATUS_LABEL[info.prevStatus] ?? "đã xử lý"}, không có bước hỏi shop.`,
  ];
  if (info.reason) parts.push(`Lý do: ${info.reason}.`);
  parts.push(
    info.returning
      ? "Kiện đã bàn giao vận chuyển sẽ quay về shop — Hubsell đã chuyển đơn sang Chờ hàng về, kho quét mã khi kiện về."
      : "Vui lòng xử lý: rút kiện khỏi lô giao; hàng về kho thì nhập lại."
  );
  return {
    title: `${who} đã hủy đơn đã chuẩn bị hàng ${orderCode}`,
    body: parts.join(" "),
    link: info.returning ? "/warehouse/returns" : `/orders?search=${encodeURIComponent(orderCode)}`,
  };
}

export async function notifyOrderCancelledAfterPrepare(
  channel: Pick<Channel, "userId" | "shopName" | "channelName">,
  orderCode: string,
  info: OrderCancelledInfo
): Promise<void> {
  if (!shouldNotifyOrderCancelled(info)) return;
  const msg = orderCancelledMessage(channel, orderCode, info);
  await notify(channel.userId, { type: "order_cancelled", ...msg });
}
