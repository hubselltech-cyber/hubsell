/**
 * TRẠNG THÁI PHÍA CƠ QUAN THUẾ của một hóa đơn — chuẩn hóa từ SendTaxStatus
 * của meInvoice (/invoice/status) thành 4 giá trị Hubsell dùng chung cho
 * worker đồng bộ, báo cáo và badge UI.
 *
 * Vì sao phải chuẩn hóa: cùng con số SendTaxStatus nhưng nghĩa KHÁC NHAU theo
 * loại ký hiệu (tài liệu meInvoice):
 *   · ký hiệu CÓ MÃ (ký tự 2 = C): 0 chờ cấp mã · 1 gửi lỗi · 2 đã cấp mã · 3 từ chối
 *   · ký hiệu KHÔNG MÃ (K):        0 chưa gửi · 1 đã gửi · 2 CQT tiếp nhận ·
 *                                   3 không tiếp nhận · 4 lỗi
 * Hàm này là NƠI DUY NHẤT đọc bảng mã đó — nơi khác chỉ so sánh chuỗi.
 */

/** Chuỗi lưu ở InvoiceLog.cqtStatus. */
export type CqtStatus = "WAITING" | "SEND_ERROR" | "ACCEPTED" | "REJECTED";

export const CQT_STATUS_VALUES: readonly CqtStatus[] = [
  "WAITING",
  "SEND_ERROR",
  "ACCEPTED",
  "REJECTED",
];

/**
 * @param sendTaxStatus  SendTaxStatus meInvoice trả (null = không có trường).
 * @param withCode       Ký hiệu có mã CQT (ký tự thứ 2 = "C").
 * @returns null khi NCC không trả trạng thái (giữ nguyên giá trị cũ trong DB).
 */
export function mapCqtStatus(
  sendTaxStatus: number | null,
  withCode: boolean
): CqtStatus | null {
  if (sendTaxStatus == null) return null;
  if (withCode) {
    switch (sendTaxStatus) {
      case 0:
        return "WAITING";
      case 1:
        return "SEND_ERROR";
      case 2:
        return "ACCEPTED";
      case 3:
        return "REJECTED";
      default:
        return null;
    }
  }
  switch (sendTaxStatus) {
    case 0:
    case 1:
      return "WAITING";
    case 2:
      return "ACCEPTED";
    case 3:
      return "REJECTED";
    case 4:
      return "SEND_ERROR";
    default:
      return null;
  }
}

/** Ký hiệu hóa đơn có mã CQT? (TT 78: ký tự 2 — C = có mã, K = không mã.) */
export function seriesHasTaxCode(invoiceSeries: string | null | undefined): boolean {
  return invoiceSeries?.charAt(1) === "C";
}

/**
 * Bao lâu thì hỏi lại NCC về một hóa đơn — ACCEPTED chỉ cần kiểm 1 lần/ngày
 * (bắt hủy/xóa muộn), còn lại kiểm mỗi giờ tới khi có kết luận.
 */
export const CQT_RECHECK_MS: Record<"ACCEPTED" | "OTHER", number> = {
  ACCEPTED: 24 * 60 * 60 * 1000,
  OTHER: 60 * 60 * 1000,
};

/** Chỉ theo dõi hóa đơn lập trong cửa sổ này — cũ hơn coi như đã chốt. */
export const CQT_WATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
