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
 * Báo cáo chỉ cần SỐ ĐƠN thiếu giá vốn (các bộ tổng đếm `missingCostCount`);
 * Σ lợi nhuận của chúng không giữ ở đâu vì không in ra màn khách (anh bỏ dòng
 * "lãi tạm tính" 30/10/2026).
 */

/**
 * Hợp đồng API cho màn khách (web + mobile) — `missingCost` của /api/analytics,
 * /api/finance/analytics, /api/finance/realized-pnl, /api/tax/report. Giữ tên
 * trường `excludedProfit` nhưng LUÔN 0 từ 04/11/2026: mobile 1.4.0/1.4.1 chưa
 * OTA dựng bậc "Thiếu vốn" với amount 0 → WaterfallChart tự bỏ bậc, không trừ
 * hai lần.
 */
export interface MissingCostSummary {
  orderCount: number;
  excludedProfit: 0;
}

export function missingCostApiSummary(orderCount: number): MissingCostSummary {
  return { orderCount, excludedProfit: 0 };
}

/**
 * TIỀN QUẢNG CÁO SÀN ĐÃ THU NGAY TRONG ĐƠN (anh Trung chốt 10/11/2026 "làm theo
 * hướng A" — cùng luật TikTok 20/10): khoản đã nằm trong tiền về ví nên cột Chi
 * phí chỉ cộng phần AdSpend VƯỢT nó, không trừ hai lần.
 *   · TikTok: phí GMV Max trên bản kê (`feeGmvMax`, số ÂM).
 *   · Shopee: tiền sàn trích từ đơn để nạp ví quảng cáo (`adWalletTopup`, lưu DƯƠNG).
 * Trả số CÓ DẤU (âm = sàn đã thu) để cộng dồn theo gian; nơi dùng lấy trị tuyệt
 * đối của TỔNG (services/ads-spend.ts). Một gian chỉ thuộc một sàn nên hai vế
 * không bao giờ cùng khác 0.
 * Giới hạn đã báo anh: tiền Shopee là NẠP ví, không phải tiêu — kỳ nào nạp nhiều
 * hơn tiêu thì chi phí tính theo số nạp (cao hơn thực, không bao giờ thấp hơn).
 */
export function adsChargedInOrder(r: { feeGmvMax: number; adWalletTopup: number }): number {
  return r.feeGmvMax - r.adWalletTopup;
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
