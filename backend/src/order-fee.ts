/**
 * PHÍ SÀN CỦA MỘT ĐƠN — DÙNG CHUNG
 *
 * Tách khỏi routes/finance.ts để trang Tổng quan và Báo cáo dòng tiền tính phí
 * sàn theo cùng một công thức. Trước đây chỉ finance.ts có hàm này, còn
 * analytics.ts bỏ qua phí sàn hoàn toàn — hệ quả là hai trang báo hai con số
 * lợi nhuận thuần khác nhau cho cùng một kỳ.
 */

import type { Prisma } from "@prisma/client";

/** Các trường quyết toán cần có để tính phí sàn thực của một đơn. */
export interface FeeFields {
  isSettled: boolean;
  platformFee: Prisma.Decimal;
  fixedFee: Prisma.Decimal;
  serviceFee: Prisma.Decimal;
  paymentFee: Prisma.Decimal;
  affiliateFee: Prisma.Decimal;
  sellerVoucher: Prisma.Decimal;
  shippingFeeDiff: Prisma.Decimal;
  platformSubsidy: Prisma.Decimal;
}

/** Mảnh `select` của Prisma để lấy đủ các trường trên. */
export const FEE_SELECT = {
  isSettled: true,
  platformFee: true,
  fixedFee: true,
  serviceFee: true,
  paymentFee: true,
  affiliateFee: true,
  sellerVoucher: true,
  shippingFeeDiff: true,
  platformSubsidy: true,
} as const;

/**
 * Phí sàn thực dùng cho một đơn:
 * - Đã quyết toán → dùng số THỰC TẾ sàn trả về (fixed + service + payment
 *   + affiliate + voucher + chênh lệch ship − trợ giá)
 * - Chưa quyết toán → 0 ("chờ đối soát"). QUYẾT ĐỊNH CHỦ SHOP 30/07: mọi báo
 *   cáo là SỔ ĐỐI SOÁT VỚI SÀN — phí chỉ ghi khi sàn trả số thật, TUYỆT ĐỐI
 *   không ước % kênh (10%/12%...) rồi bịa vào cột chi phí.
 */
export function orderPlatformFee(order: FeeFields): {
  fee: number;
  isSettled: boolean;
} {
  if (order.isSettled) {
    const fee =
      Number(order.fixedFee) +
      Number(order.serviceFee) +
      Number(order.paymentFee) +
      Number(order.affiliateFee) +
      Number(order.sellerVoucher) +
      Number(order.shippingFeeDiff) -
      Number(order.platformSubsidy);
    return { fee, isSettled: true };
  }
  return { fee: 0, isSettled: false };
}
