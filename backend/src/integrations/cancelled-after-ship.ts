// ============================================================
// ĐƠN HỦY SAU KHI ĐÃ BÀN GIAO VẬN CHUYỂN = KIỆN QUAY ĐẦU (lát A, 29/10/2026)
//
// Khảo sát docs/DON-HOAN-VA-SAO-KE.md mục 8: 30 ngày prod có 61/65 kiện kho quét
// mà app báo "Không hoàn" là đơn sàn đã HỦY sau khi giao thất bại (TikTok "Giao
// gói hàng thất bại" 1.029 đơn, Shopee "Failed Delivery" 165). Trục hoàn của
// ba sàn chỉ nhìn yêu cầu trả hàng của khách (returns/search, TO_RETURN,
// get_return_list, reverse RETURN) nên loại kiện này mãi là NONE — kho không
// thấy trong Đối soát đơn hoàn, quét kiện thì phải bấm nhận "ngoài danh sách".
//
// Luật chung ba sàn (anh Trung chốt 29/10: "Sàn chuyển CANCELLED là ship đã
// phát giao không thành công rồi"): đơn ĐANG GIAO / ĐÃ GIAO mà sàn chuyển sang
// Đã hủy → cắm Chờ hàng về ngay trong cùng bản ghi cập nhật đơn (đi qua webhook
// lẫn quét nền, không cần lượt quét yêu cầu hoàn). Dựa TRẠNG THÁI TRƯỚC, không
// dựa chữ lý do (cancel_reason đổi theo ngôn ngữ shop): hủy khi còn Chờ xử lý /
// Đã xử lý (quá hạn lấy hàng, seller không giao…) thì kiện còn ở shop, không
// có gì quay đầu → giữ Đã hủy như cũ.
//
// Cột ghi: returnStatus AWAITING (kho quét nhận như mọi đơn hoàn), mốc sàn báo
// hoàn, returnSolution RETURN_REFUND (hàng về — P&L không coi là khách giữ
// hàng), platformReturnStatus = CANCELLED_AFTER_SHIP để UI ghi "giao thất bại ·
// kiện quay đầu" thay vì mã yêu cầu hoàn. Tồn kho KHÔNG đổi: đơn hủy đã được
// restoreStockTx cộng lại ngay khi sàn báo hủy, nhập kho hoàn sau đó bị
// stockRestoredAt chặn cộng trùng; P&L: returnGoodsRecovered đã coi đơn hủy là
// không mất vốn, cờ AWAITING không đổi kết quả.
// ============================================================

import { ReturnSolution, ReturnStatus, ShippingStatus } from "@prisma/client";

/** Giá trị platformReturnStatus đánh dấu "sàn hủy sau khi bàn giao — kiện quay đầu". */
export const CANCELLED_AFTER_SHIP = "CANCELLED_AFTER_SHIP";

/** Trạng thái = kiện đã rời shop (đã bàn giao hãng vận chuyển). */
const HANDED_OVER = new Set<ShippingStatus>([ShippingStatus.SHIPPING, ShippingStatus.DELIVERED]);

/** Đơn chuyển từ đang giao / đã giao sang Đã hủy — kiện sẽ quay về shop. */
export function isCancelledAfterShip(
  prevStatus: ShippingStatus,
  nextStatus: ShippingStatus | null | undefined
): boolean {
  return nextStatus === ShippingStatus.CANCELLED && HANDED_OVER.has(prevStatus);
}

export interface CancelledAfterShipFields {
  returnStatus: typeof ReturnStatus.AWAITING;
  returnRequestedAt: Date;
  returnSolution: typeof ReturnSolution.RETURN_REFUND;
  platformReturnStatus: typeof CANCELLED_AFTER_SHIP;
}

/**
 * Cột cờ hoàn cần ghi thêm vào bản ghi cập nhật đơn, hoặc null khi không áp:
 * không phải chuyển sang Đã hủy, kiện chưa rời shop, hoặc trục hoàn đã có cờ
 * (yêu cầu trả hàng đang chờ / kho đã xử lý — không regress).
 * `at` = mốc sàn (cancel_time / update_time), rơi về giờ đồng bộ khi sàn không trả.
 */
export function cancelledAfterShipReturnFields(
  existing: { shippingStatus: ShippingStatus; returnStatus: ReturnStatus },
  nextStatus: ShippingStatus | null | undefined,
  at: Date
): CancelledAfterShipFields | null {
  if (!isCancelledAfterShip(existing.shippingStatus, nextStatus)) return null;
  if (existing.returnStatus !== ReturnStatus.NONE) return null;
  return {
    returnStatus: ReturnStatus.AWAITING,
    returnRequestedAt: at,
    returnSolution: ReturnSolution.RETURN_REFUND,
    platformReturnStatus: CANCELLED_AFTER_SHIP,
  };
}

/** Mốc sàn (giây epoch) → Date; thiếu / 0 → giờ hiện tại. */
export function platformTimeOr(sec: number | null | undefined, fallback: Date): Date {
  return sec && sec > 0 ? new Date(sec * 1000) : fallback;
}
