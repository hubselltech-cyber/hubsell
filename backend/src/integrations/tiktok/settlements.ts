// ============================================================
// TIKTOK — BÓC TÁCH GIAO DỊCH BẢN KÊ → CỘT QUYẾT TOÁN CỦA ORDER (16/09/2026)
//
// Đối chiếu payload THẬT shop and.not.or (log "[TikTok] Hình dạng giao dịch bản
// kê"): mỗi dòng statement_transactions là một giao dịch PHẲNG với ~60 trường
// *_amount (chuỗi số, phí mang dấu ÂM), type = ORDER | REFUND | ADJUSTMENT |
// SAMPLE_SHIPPING_FEE…; dòng có order_id mới thuộc đơn. Gom MỌI dòng của cùng
// một đơn trong lượt chạy rồi GHI ĐÈ (idempotent).
//
// Quy ước cột (mọi cột LƯU DƯƠNG, cùng bảng với Shopee mapShopeeEscrowFields):
//   platform_commission (+ referral_fee)              → fixedFee    ("Phí sàn CĐ")
//   transaction_fee                                    → paymentFee  ("TT")
//   sfp_service / bảo hiểm / ký nhận / phí xử lý hoàn
//   / FBT + phần fee_amount CHƯA bóc được cột nào       → serviceFee  (khớp Σ = |fee_amount|)
//   affiliate_* (thường + ads + partner)               → affiliateFee
//   platform_discount                                  → platformSubsidy (sàn bù phần giảm giá sàn)
//   customer_paid_shipping_fee                         → shippingFeeQuoted (khách trả)
//   actual_shipping_fee                                → shippingFeeActual
//   shipping_fee_subsidy + platform_shipping_fee_discount + promo_shipping_incentive
//                                                      → shipSubsidyPlatform
//   thực tế − (khách trả + sàn trợ) (nếu > 0)          → shippingFeeDiff (ship shop chịu)
//   pit + iva_vat + isr + sales_tax                    → taxWithheld (thuế sàn thu hộ)
//   customer_refund (+ customer_order_refund)          → refundedAmount
//   Σ settlement_amount                                → actualPayout (GỐC mọi phép lợi nhuận)
// sellerVoucher CỐ Ý = 0: OrderItem.price của TikTok là sale_price ĐÃ trừ giảm
// giá shop (line_item.sale_price), ghi thêm seller_discount là trừ đôi.
// ============================================================

import type { TikTokStatementTransaction } from "./client";

const n = (v: unknown): number => Number(v ?? 0) || 0;
const abs = (v: unknown): number => Math.abs(n(v));

export interface TiktokSettlementColumns {
  fixedFee: number;
  paymentFee: number;
  serviceFee: number;
  affiliateFee: number;
  platformSubsidy: number;
  shippingFeeQuoted: number;
  shippingFeeActual: number;
  shipSubsidyPlatform: number;
  shippingFeeDiff: number;
  taxWithheld: number;
  refundedAmount: number;
  actualPayout: number;
}

/** Cộng dồn các dòng giao dịch của MỘT đơn thành bộ cột quyết toán. Export để vitest. */
export function mapTiktokTransactionsToOrder(
  trxs: TikTokStatementTransaction[]
): TiktokSettlementColumns {
  const sum = (key: string) => trxs.reduce((s, t) => s + abs((t as Record<string, unknown>)[key]), 0);
  const sumSigned = (key: string) =>
    trxs.reduce((s, t) => s + n((t as Record<string, unknown>)[key]), 0);

  const fixedFee = sum("platform_commission_amount") + sum("referral_fee_amount");
  const paymentFee = sum("transaction_fee_amount");
  const affiliateFee =
    sum("affiliate_commission_amount") +
    sum("affiliate_ads_commission_amount") +
    sum("affiliate_partner_commission_amount");
  let serviceFee =
    sum("sfp_service_fee_amount") +
    sum("shipping_insurance_fee_amount") +
    sum("signature_confirmation_fee_amount") +
    sum("refund_administration_fee_amount") +
    sum("fbt_fulfillment_fee_amount");
  // Khớp tổng: phần fee_amount chưa bóc được vào cột nào dồn vào serviceFee để
  // Σ cột phí = |fee_amount| của sàn (không rơi một đồng phí nào ra ngoài).
  const feeTotal = sum("fee_amount");
  const feeKnown = fixedFee + paymentFee + affiliateFee + serviceFee;
  if (feeTotal > feeKnown + 0.5) serviceFee += feeTotal - feeKnown;

  const shippingFeeQuoted = sum("customer_paid_shipping_fee_amount");
  const shippingFeeActual = sum("actual_shipping_fee_amount");
  const shipSubsidyPlatform =
    sum("shipping_fee_subsidy_amount") +
    sum("platform_shipping_fee_discount_amount") +
    sum("promo_shipping_incentive_amount");
  const shippingFeeDiff = Math.max(shippingFeeActual - (shippingFeeQuoted + shipSubsidyPlatform), 0);

  const taxWithheld =
    sum("pit_amount") + sum("iva_vat_amount") + sum("isr_income_tax_amount") + sum("sales_tax_amount");
  const refundedAmount = sum("customer_refund_amount") + sum("customer_order_refund_amount");

  return {
    fixedFee,
    paymentFee,
    serviceFee,
    affiliateFee,
    platformSubsidy: sum("platform_discount_amount"),
    shippingFeeQuoted,
    shippingFeeActual,
    shipSubsidyPlatform,
    shippingFeeDiff,
    taxWithheld,
    refundedAmount,
    actualPayout: sumSigned("settlement_amount"),
  };
}
