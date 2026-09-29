// ============================================================
// ĐỊNH NGHĨA TÀI CHÍNH DÙNG CHUNG — mỗi khái niệm MỘT định nghĩa, viết MỘT chỗ
// (docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md nguyên tắc 6). Trang/báo cáo chỉ được GỌI,
// không tự viết lại điều kiện — trước 30/09/2026 "đơn tính doanh thu" có hai
// cách hiểu (Tổng quan loại đơn đang hoàn, Báo cáo dòng tiền thì tính) nên hai
// trang ra hai số.
// ============================================================

import { ReturnStatus, ShippingStatus } from "@prisma/client";

/**
 * Đơn ĐANG HOÀN/TRẢ — hàng hoàn chưa xử lý xong: đang chờ về kho, đã quét nhận
 * nhưng chưa nhập kho, hoặc hỏng/mất đang chờ khiếu nại. Hoàn ĐÃ XONG (nhập kho
 * nguyên vẹn, khiếu nại thắng/thua) không thuộc nhóm này.
 */
export const RETURNING_STATUSES: ReturnStatus[] = [
  ReturnStatus.AWAITING,
  ReturnStatus.RECEIVED,
  ReturnStatus.DAMAGED,
];

const RETURNING_SET = new Set<ReturnStatus>(RETURNING_STATUSES);

export function isReturning(r: { returnStatus: ReturnStatus }): boolean {
  return RETURNING_SET.has(r.returnStatus);
}

/**
 * ĐƠN LỖ: tiền sàn trả về ví NHỎ HƠN giá vốn (lợi nhuận < 0). Bằng 0 không phải
 * lỗ. Đơn thiếu giá vốn mà vẫn âm thì VẪN là đơn lỗ: bổ sung giá vốn chỉ làm số
 * âm thêm, không thể thành lãi.
 */
export function isLossOrder(r: { profitAfterTax: number }): boolean {
  return r.profitAfterTax < 0;
}

/**
 * ĐƠN CHƯA CÓ GIÁ VỐN bị loại khỏi LỢI NHUẬN nhưng vẫn nằm trong DOANH THU (anh
 * Trung chốt 30/09/2026): thiếu giá vốn thì "lợi nhuận" của đơn thực chất là
 * nguyên tiền về, cộng vào làm lãi phình. Trả số đơn + phần lợi nhuận bị loại
 * để báo cáo nói rõ "X đơn chưa có giá vốn nên không được tính vào lợi nhuận"
 * và để đẳng thức đóng: Doanh thu − Chi phí − excludedProfit = Lợi nhuận.
 */
export function summarizeMissingCost(
  rows: { missingCostPrice: boolean; profitAfterTax: number }[]
): { orderCount: number; excludedProfit: number } {
  let orderCount = 0;
  let excludedProfit = 0;
  for (const r of rows) {
    if (!r.missingCostPrice) continue;
    orderCount += 1;
    excludedProfit += r.profitAfterTax;
  }
  return { orderCount, excludedProfit };
}

/**
 * ĐƠN TÍNH DOANH THU (anh Trung chốt 30/09/2026): không hủy VÀ không đang
 * hoàn/trả. Áp cho Tổng quan, Báo cáo dòng tiền, Trợ lý hỏi đáp, báo cáo tuần.
 */
export function countsAsRevenue(r: {
  shippingStatus: ShippingStatus;
  returnStatus: ReturnStatus;
}): boolean {
  return r.shippingStatus !== ShippingStatus.CANCELLED && !isReturning(r);
}
