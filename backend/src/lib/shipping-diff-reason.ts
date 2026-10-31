import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";

/**
 * NGUYÊN NHÂN một đơn bị lệch phí vận chuyển (`Order.shippingFeeDiff > 0`) —
 * trang Đối soát phí vận chuyển (khảo sát 31/10/2026, docs
 * DOI-SOAT-PHI-SHIP-NGUYEN-NHAN-KHAO-SAT-31-10.md mục 2c/4a).
 *
 * Phân loại LÚC ĐỌC từ cột đã có (Order + bản kê chi tiết TikTok/Lazada),
 * không gọi sàn, không migration. Thứ tự luật = loại trừ dần, một đơn một
 * nhãn. Chỉ nhóm `claimable` là ca khiếu nại đòi lại được — thẻ "Tổng số tiền
 * cần đòi lại" và file khiếu nại chỉ cộng nhóm này; phần còn lại là chi phí
 * ship shop chịu theo chính sách sàn (TikTok tự đánh DA_DOI_SOAT từ trước).
 */
export type ShippingDiffReason =
  | "FEE_MISMATCH" // cước thực tế cao hơn cước sàn báo (cân nặng/kích thước) — đòi được
  | "LOGISTICS_SURCHARGE" // phụ phí: bảo hiểm, ký nhận, vùng xa, cồng kềnh…
  | "AWAITING_STATEMENT" // chưa có bản kê thật, số đang ước tính
  | "CANCELLED_AFTER_SHIP" // hủy / giao không thành công sau khi kiện rời kho
  | "CUSTOMER_RETURN" // khách trả hàng — ship chiều hoàn
  | "SHOP_FREESHIP" // voucher freeship của shop
  | "SHOP_BEARS_SHIPPING" // khách miễn ship, sàn không trợ → shop trả trọn cước
  | "OVER_PLATFORM_SUBSIDY" // sàn trợ có trần, phần dư shop chịu
  | "OTHER";

export const SHIPPING_DIFF_REASONS: readonly ShippingDiffReason[] = [
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

const CLAIMABLE = new Set<ShippingDiffReason>([
  "FEE_MISMATCH",
  "LOGISTICS_SURCHARGE",
  "AWAITING_STATEMENT",
]);

export function isClaimableReason(reason: ShippingDiffReason): boolean {
  return CLAIMABLE.has(reason);
}

/** Số có dấu nguyên bản của bản kê TikTok (âm = sàn trừ). */
export interface TiktokShipCols {
  estimated: boolean;
  shipCustomerPaid: number;
  shipPlatformDiscount: number;
  shipSubsidy: number;
  shipSellerDiscount: number;
  shipReturn: number;
  shipOther: number;
}

/** Số có dấu của sao kê Lazada (âm = sàn trừ). */
export interface LazadaShipCols {
  shipFeeReturn: number;
  feeShipSeller: number;
  shipFeeAdjustment: number;
  shipDiscountSeller: number;
}

export interface ShippingDiffInput {
  channelName: ChannelName;
  shippingStatus: ShippingStatus;
  returnStatus: ReturnStatus;
  isSettled: boolean;
  tiktok?: TiktokShipCols | null;
  lazada?: LazadaShipCols | null;
}

export function classifyShippingDiff(o: ShippingDiffInput): ShippingDiffReason {
  const returning = o.returnStatus !== ReturnStatus.NONE;
  const cancelledNoReturn = o.shippingStatus === ShippingStatus.CANCELLED && !returning;

  switch (o.channelName) {
    case ChannelName.TIKTOK: {
      const t = o.tiktok;
      // Chưa quyết toán hoặc bản kê chỉ là ước tính → chờ sao kê. Đã quyết
      // toán mà thiếu dòng bản kê (dữ liệu cũ) thì vẫn xếp theo trạng thái đơn.
      if (!o.isSettled || t?.estimated) return "AWAITING_STATEMENT";
      if (cancelledNoReturn) return "CANCELLED_AFTER_SHIP";
      if (returning || (t && t.shipReturn < 0)) return "CUSTOMER_RETURN";
      if (!t) return "OTHER";
      if (t.shipOther < 0) return "LOGISTICS_SURCHARGE";
      if (t.shipSellerDiscount < 0) return "SHOP_FREESHIP";
      if (t.shipCustomerPaid === 0 && t.shipPlatformDiscount === 0 && t.shipSubsidy === 0)
        return "SHOP_BEARS_SHIPPING";
      if (t.shipPlatformDiscount > 0 || t.shipSubsidy > 0) return "OVER_PLATFORM_SUBSIDY";
      return "OTHER";
    }
    case ChannelName.LAZADA: {
      const l = o.lazada;
      if (!o.isSettled) return "AWAITING_STATEMENT";
      if (cancelledNoReturn) return "CANCELLED_AFTER_SHIP";
      if (returning || (l && l.shipFeeReturn < 0)) return "CUSTOMER_RETURN";
      if (l?.shipDiscountSeller != null && l.shipDiscountSeller < 0) return "SHOP_FREESHIP";
      if (l?.feeShipSeller != null && l.feeShipSeller < 0) return "SHOP_BEARS_SHIPPING";
      // "Điều chỉnh phí vận chuyển" âm = sàn tính lại cước sau giao → cùng
      // bản chất lệch cước, khiếu nại được.
      return "FEE_MISMATCH";
    }
    case ChannelName.SHOPEE: {
      // Escrow Shopee chỉ còn cột gộp trên Order (chưa lưu reverse_shipping_fee /
      // buyer_paid_shipping_fee) → tách được 3 nhãn.
      if (!o.isSettled) return "AWAITING_STATEMENT";
      if (cancelledNoReturn) return "CANCELLED_AFTER_SHIP";
      if (returning) return "CUSTOMER_RETURN";
      return "FEE_MISMATCH";
    }
    default:
      return "OTHER";
  }
}
