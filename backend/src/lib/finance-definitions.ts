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
 * ĐƠN CHƯA CÓ GIÁ VỐN — định nghĩa anh Trung chốt 02/11/2026, áp mã 04/11/2026
 * (docs/TAI-CHINH-GIA-VON-0-ROI-ROAS-KHAO-SAT-02-11.md mục 8.1):
 *
 *   · Lợi nhuận KỲ (Tổng quan, Dòng tiền, Lãi/Lỗ, Thuế bổ sung, Trợ lý) = Σ lợi
 *     nhuận MỌI đơn tính doanh thu — đơn thiếu giá vốn tính như GIÁ VỐN 0 đ
 *     (dòng thiếu đã góp 0 đ vốn trong computePnlRow, sổ cái không đổi).
 *     Đẳng thức mọi trang: Doanh thu − Chi phí = Lợi nhuận.
 *   · Cờ `missingCostPrice` GIỮ để ĐẾM + NHẮC nhập giá vốn ("N đơn chưa có giá
 *     vốn — đang tính với giá vốn 0 đ"), không còn trừ ra khỏi lợi nhuận.
 *   · ROI/ROAS hòa vốn, biên lãi quảng cáo KHÔNG đổi: vẫn gạt đơn có cờ khỏi tử
 *     lẫn mẫu (lib/ads-margin.ts, lib/tiktok-breakeven.ts đọc cờ riêng từ sổ).
 *
 * Trước đó (30/09/2026 → 04/11/2026): đơn thiếu giá vốn bị LOẠI khỏi lợi nhuận
 * (Doanh thu − Chi phí − excludedProfit = Lợi nhuận). Lý do đổi + số đo ở docs trên.
 *
 * Hàm trả số đơn + Σ lợi nhuận (đã tính với giá vốn 0) của các đơn đó — chỉ để
 * đếm/tham khảo nội bộ (HQ, Trợ lý), KHÔNG in ra màn khách (anh bỏ dòng "lãi
 * tạm tính" 30/10/2026). API khách vẫn trả `missingCost.excludedProfit = 0` để
 * mobile cũ (1.4.0/1.4.1 chưa OTA) tự đóng bậc thác nước.
 */
export function summarizeMissingCost(
  rows: { missingCostPrice: boolean; profitAfterTax: number }[]
): { orderCount: number; profitAtZeroCost: number } {
  let orderCount = 0;
  let profitAtZeroCost = 0;
  for (const r of rows) {
    if (!r.missingCostPrice) continue;
    orderCount += 1;
    profitAtZeroCost += r.profitAfterTax;
  }
  return { orderCount, profitAtZeroCost };
}

/**
 * Hợp đồng API cho màn khách (web + mobile): giữ tên trường `excludedProfit`
 * nhưng LUÔN 0 từ 04/11/2026 — không còn phần lợi nhuận nào bị loại. Mobile
 * 1.4.0/1.4.1 dựng bậc "Thiếu vốn" với amount 0 → WaterfallChart tự bỏ bậc.
 */
export function missingCostApiSummary(orderCount: number): { orderCount: number; excludedProfit: 0 } {
  return { orderCount, excludedProfit: 0 };
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
