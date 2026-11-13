// ============================================================
// TRẠNG THÁI VẬN CHUYỂN CHIỀU HOÀN của một đơn (13/11/2026, anh Trung: "bỏ cột
// khách hàng đi và thay bằng cột Trạng thái vận chuyển, mục đích để biết ship đã
// báo hoàn thành công hay chưa để dễ dàng đối soát").
//
// Hàm THUẦN, chỉ đọc các cột Order đã có — KHÔNG gọi sàn:
//   · returnDeliveredAt  — sàn xác nhận kiện hoàn đã về tay shop (Shopee
//     reverse_logistics_status = LOGISTICS_DELIVERY_DONE, TikTok yêu cầu trả hàng
//     sang SUCCESS / COMPLETE);
//   · platformReturnStatus — trạng thái yêu cầu hoàn nguyên văn của sàn;
//   · returnTrackingCode — có mã vận đơn chiều hoàn = khách đã gửi kiện;
//   · returnStatus / returnedAt — kho đã cầm kiện trên tay chưa.
//
// GIỚI HẠN ĐÃ BIẾT: kiện GIAO THẤT BẠI quay đầu (platformReturnStatus =
// CANCELLED_AFTER_SHIP) không có yêu cầu trả hàng nên API hoàn của cả ba sàn
// không nói gì về chặng về — muốn biết hãng đã trả kiện chưa phải đọc hành trình
// vận chuyển từng đơn (1 call / đơn). Chưa làm → trả NO_SIGNAL, không đoán
// "đang hoàn về" (đoán thì đúng ca hãng đã báo trả xong mà kho chưa nhận lại bị
// che mất).
// ============================================================

import { ReturnStatus } from "@prisma/client";
import { CANCELLED_AFTER_SHIP } from "../integrations/cancelled-after-ship";

export type ReturnShippingState =
  /** Kiện đã về tới shop: sàn xác nhận, hoặc kho đã cầm kiện. */
  | "RETURNED"
  /** Khách đã gửi kiện, sàn chưa báo về tới. */
  | "RETURNING"
  /** Có yêu cầu trả hàng nhưng khách chưa gửi kiện (chưa có mã vận đơn chiều hoàn). */
  | "WAITING_BUYER"
  /** Sàn không cho biết chặng về (kiện giao thất bại quay đầu, đơn không có trạng thái sàn). */
  | "NO_SIGNAL";

export interface ReturnShipping {
  state: ReturnShippingState;
  /** Mốc kiện về tới shop — chỉ có khi RETURNED và nguồn có ghi thời điểm. */
  at: Date | null;
  /** Ai nói kiện đã về: sàn / hãng, hay kho quét nhận. Null khi chưa về. */
  source: "platform" | "warehouse" | null;
  /** Kiện giao thất bại quay đầu (không phải khách trả hàng). */
  failedDelivery: boolean;
}

/**
 * Lazada (bảng webhook Reverse Order, đã dùng ở PLATFORM_RETURN_DONE_STATUSES):
 * RTM_RECEIVE_ITEM = sàn ghi nhận kiện hoàn đã giao về người bán. Lazada không
 * ghi returnDeliveredAt nên ca này RETURNED mà không có mốc giờ.
 */
const LAZADA_RETURNED = "RTM_RECEIVE_ITEM";

/** Trạng thái sàn nói rõ khách ĐÃ gửi kiện (TikTok BUYER_SHIPPED_ITEM, Lazada BUYER_RETURN_ITEM). */
function buyerHasShipped(status: string): boolean {
  return status.includes("BUYER_SHIPPED") || status.includes("BUYER_RETURN_ITEM");
}

export function returnShippingOf(order: {
  returnStatus: ReturnStatus;
  returnedAt: Date | null;
  returnDeliveredAt: Date | null;
  platformReturnStatus: string | null;
  returnTrackingCode: string | null;
}): ReturnShipping {
  const status = (order.platformReturnStatus ?? "").toUpperCase();
  const failedDelivery = status === CANCELLED_AFTER_SHIP;
  const inHand =
    order.returnStatus !== ReturnStatus.NONE && order.returnStatus !== ReturnStatus.AWAITING;

  // Shopee: kho quét TRƯỚC khi sàn báo thì lượt đồng bộ ghi returnDeliveredAt = giờ
  // đồng bộ (không phải giờ hãng trả kiện). Mốc sàn chỉ đáng tin khi nó đứng trước
  // mốc kho nhận; còn lại nguồn là kho.
  const platformAt =
    order.returnDeliveredAt &&
    !(inHand && order.returnedAt && order.returnDeliveredAt.getTime() >= order.returnedAt.getTime())
      ? order.returnDeliveredAt
      : null;

  if (platformAt) return { state: "RETURNED", at: platformAt, source: "platform", failedDelivery };
  if (inHand) return { state: "RETURNED", at: order.returnedAt, source: "warehouse", failedDelivery };
  if (status === LAZADA_RETURNED) {
    return { state: "RETURNED", at: null, source: "platform", failedDelivery: false };
  }

  if (failedDelivery || !status) return { state: "NO_SIGNAL", at: null, source: null, failedDelivery };
  if (order.returnTrackingCode || buyerHasShipped(status)) {
    return { state: "RETURNING", at: null, source: null, failedDelivery: false };
  }
  return { state: "WAITING_BUYER", at: null, source: null, failedDelivery: false };
}
