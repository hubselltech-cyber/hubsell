/**
 * Nhãn khách đọc cho NGUYÊN NHÂN lệch phí vận chuyển — khớp mã backend
 * `lib/shipping-diff-reason.ts` (31/10/2026). Chỉ nhóm `claimable` là ca đòi
 * lại được; phần còn lại là chi phí ship shop chịu theo chính sách sàn.
 */
export type ShippingDiffReason =
  | "FEE_MISMATCH"
  | "LOGISTICS_SURCHARGE"
  | "AWAITING_STATEMENT"
  | "CANCELLED_AFTER_SHIP"
  | "CUSTOMER_RETURN"
  | "SHOP_FREESHIP"
  | "SHOP_BEARS_SHIPPING"
  | "OVER_PLATFORM_SUBSIDY"
  | "OTHER";

export const SHIPPING_DIFF_REASON_META: Record<
  ShippingDiffReason,
  { label: string; hint: string; claimable: boolean }
> = {
  FEE_MISMATCH: {
    label: "Cước thực tế cao hơn cước báo",
    hint: "Sàn tính cước theo cân nặng / kích thước thực tế cao hơn cước báo lúc đặt. Đây là ca khiếu nại đòi lại được — xuất file gửi sàn.",
    claimable: true,
  },
  LOGISTICS_SURCHARGE: {
    label: "Phụ phí vận chuyển",
    hint: "Sàn tính thêm phí bảo hiểm, ký nhận, vùng xa, cồng kềnh… Khiếu nại được nếu shop không đăng ký dịch vụ đó.",
    claimable: true,
  },
  AWAITING_STATEMENT: {
    label: "Chờ sao kê",
    hint: "Sàn chưa trả bản kê quyết toán, số đang là ước tính. Đối soát lại khi có sao kê.",
    claimable: true,
  },
  CANCELLED_AFTER_SHIP: {
    label: "Đơn hủy sau khi gửi",
    hint: "Khách hủy hoặc giao không thành công sau khi kiện đã rời kho → sàn thu cước chiều đi (và chiều về nếu có). Theo chính sách sàn, không khiếu nại; nếu lỗi do đơn vị vận chuyển thì khiếu nại ở mục Giao hàng của sàn.",
    claimable: false,
  },
  CUSTOMER_RETURN: {
    label: "Khách trả hàng",
    hint: "Phí ship chiều hoàn của đơn Trả hàng / Hoàn tiền. Theo chính sách sàn, không khiếu nại.",
    claimable: false,
  },
  SHOP_FREESHIP: {
    label: "Shop tự trợ giá ship",
    hint: "Voucher freeship do shop phát — shop chịu phần này. Không khiếu nại.",
    claimable: false,
  },
  SHOP_BEARS_SHIPPING: {
    label: "Shop chịu cước",
    hint: "Khách được miễn ship và sàn không trợ giá đơn này → shop trả trọn cước. Không khiếu nại.",
    claimable: false,
  },
  OVER_PLATFORM_SUBSIDY: {
    label: "Cước vượt mức sàn trợ",
    hint: "Sàn trợ ship có trần, phần cước vượt trần shop chịu. Không khiếu nại.",
    claimable: false,
  },
  OTHER: {
    label: "Khác",
    hint: "Chưa xếp được vào nhóm nào — xem chi tiết thanh toán của đơn trên sàn.",
    claimable: false,
  },
};

/** Thứ tự hiện trong bộ lọc: ca đòi được trước, chính sách sàn sau. */
export const SHIPPING_DIFF_REASON_ORDER: ShippingDiffReason[] = [
  "FEE_MISMATCH",
  "LOGISTICS_SURCHARGE",
  "AWAITING_STATEMENT",
  "CANCELLED_AFTER_SHIP",
  "CUSTOMER_RETURN",
  "SHOP_FREESHIP",
  "SHOP_BEARS_SHIPPING",
  "OVER_PLATFORM_SUBSIDY",
  "OTHER",
];

/** Giá trị gửi lên `?reason=`: hai nhóm gộp + từng mã. */
export type ShippingDiffReasonFilter = "CLAIMABLE" | "POLICY" | "" | ShippingDiffReason;

export function shippingDiffReasonLabel(reason: ShippingDiffReason | undefined): string {
  return reason ? SHIPPING_DIFF_REASON_META[reason].label : "—";
}
