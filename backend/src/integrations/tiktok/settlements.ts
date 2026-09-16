// ============================================================
// TIKTOK — BÓC BREAKDOWN BẢN KÊ 202501 / UNSETTLED 202507 → SAO KÊ CHI TIẾT
// (TiktokOrderSettlement, số CÓ DẤU nguyên bản) + CỘT GỘP CỦA ORDER (lưu dương)
//
// Chốt anh Trung 16/09/2026: đặt đúng TÊN phí theo TikTok Shop VN trước, mỗi
// cột chi tiết = đúng MỘT trường API (docs tải JSON 16/09), số nguyên dấu như
// sàn ghi (âm = sàn trừ shop, dương = ghi có). Cột gộp của Order chỉ là tổng
// magnitude để công thức dùng chung (computePnlRow, dòng tiền) không phải biết
// chi tiết từng sàn — nguồn sự thật của lợi nhuận vẫn là settlement_amount.
//
// Cùng một đơn có thể có NHIỀU dòng trong lượt quét (ORDER + REFUND + dòng điều
// chỉnh gắn adjustment_order_id) → cộng có dấu từng trường rồi mới bóc cột.
// Dòng unsettled (202507) cùng khuôn breakdown, chỉ khác tiền tố est_ ở các
// tổng → dùng chung mapper, cờ estimated=true.
// ============================================================

import type { TikTokAmountMap, TikTokTxBreakdown } from "./client";

const n = (v: unknown): number => (typeof v === "object" ? 0 : Number(v ?? 0) || 0);
/** Khối con lồng trong breakdown (supplementary_component) — chỉ nhận object. */
const asMap = (v: unknown): TikTokAmountMap | undefined =>
  v && typeof v === "object" ? (v as TikTokAmountMap) : undefined;
/** Dương hoá một tổng CÓ DẤU: phần sàn TRỪ (âm) → magnitude, dương → 0. */
const charged = (signed: number): number => Math.max(-signed, 0);
/** Phần sàn GHI CÓ (dương) của một tổng có dấu — rebate/hoàn phí. */
const credited = (signed: number): number => Math.max(signed, 0);

/** Sao kê chi tiết một đơn — số CÓ DẤU nguyên bản (khớp cột TiktokOrderSettlement). */
export interface TiktokSettlementDetailCols {
  // ---- Doanh thu (revenue_breakdown) ----
  grossSales: number; // subtotal_before_discount_amount — Giá gốc sản phẩm
  sellerDiscount: number; // seller_discount_amount — Chiết khấu của nhà bán hàng (âm)
  refundGross: number; // refund_subtotal_before_discount_amount — Doanh thu hoàn trả (âm)
  sellerDiscountRefund: number; // seller_discount_refund_amount (dương: CK trả lại shop)
  revenueAmount: number; // revenue_amount — Tổng phụ sau chiết khấu của nhà bán hàng
  platformDiscount: number; // supplementary.platform_discount_amount — Chiết khấu nền tảng (sàn chịu)
  customerRefund: number; // supplementary.customer_refund_amount — tiền khách thật nhận lại
  // ---- Phí vận chuyển (shipping_cost_breakdown) ----
  shipActual: number; // actual_shipping_fee_amount — Phí vận chuyển thực tế (âm)
  shipCustomerPaid: number; // customer_paid_shipping_fee_amount — Phí vận chuyển của khách hàng
  shipPlatformDiscount: number; // supplementary.platform_shipping_fee_discount_amount — CK PVC của nền tảng
  shipSubsidy: number; // shipping_fee_subsidy + promo_shipping_incentive — Trợ cấp phí vận chuyển
  shipSellerDiscount: number; // supplementary.seller_shipping_fee_discount_amount — CK PVC của nhà bán hàng
  shipReturn: number; // return_shipping_fee_amount — Phí vận chuyển trả hàng thực tế (âm)
  shipOther: number; // ký nhận/bảo hiểm/logistics_service_fee/shipping_app… (âm)
  shipReimbursement: number; // sfr/guarantee/failed_delivery/free_return subsidy (dương)
  shippingCost: number; // shipping_cost_amount — Phí vận chuyển của nhà bán hàng (ròng, âm = shop chịu)
  // ---- Phí (fee_tax_breakdown.fee) — tên theo TikTok Shop VN ----
  feeCommission: number; // platform_commission_amount — Phí hoa hồng nền tảng
  feeTransaction: number; // transaction_fee_amount — Phí giao dịch
  feeOrderProcessing: number; // vn_fix_infrastructure_fee — Phí xử lý đơn hàng
  feeSfp: number; // sfp_service_fee_amount — Phí dịch vụ Freeship Xtra
  feeVoucherXtra: number; // voucher_xtra_service_fee_amount — Phí dịch vụ Voucher Xtra
  feeFlashSale: number; // flash_sales_service_fee_amount — Phí dịch vụ Flash Sale
  feeAffiliate: number; // affiliate_commission_amount_before_pit (ưu tiên) / affiliate_commission_amount — Hoa hồng affiliate
  feeAffiliateAds: number; // affiliate_ads_commission_amount — Hoa hồng quảng cáo affiliate
  feeAffiliatePartner: number; // affiliate_partner_commission_amount — Hoa hồng cho đối tác affiliate
  feeGmvMax: number; // gmv_max_ad_fee_amount + gmv_max_coupon_fee — Nạp tiền quảng cáo từ đơn hàng
  feeOther: number; // phần còn lại của fee → Σ phí = fee_tax_amount − thuế (chốt chặn)
  feeTaxAmount: number; // fee_tax_amount — tổng phí + thuế sàn ghi
  // ---- Thuế (fee_tax_breakdown.tax) ----
  taxVat: number; // local_vat_amount — Thuế GTGT khấu trừ
  taxPit: number; // pit_amount — Thuế TNCN khấu trừ
  taxOther: number; // các sắc thuế vùng khác (không áp VN) — chốt chặn
  // ---- Điều chỉnh & kết quả ----
  adjustmentAmount: number; // Σ adjustment_amount các dòng gắn đơn (có dấu)
  adjustmentTypes: string | null; // loại điều chỉnh TikTok ghi, nối bằng ","
  settlementAmount: number; // Σ settlement_amount — Số tiền quyết toán (tiền về ví)
}

/** Cột GỘP của Order (lưu DƯƠNG) — cùng bảng với Shopee mapShopeeEscrowFields. */
export interface TiktokOrderCols {
  fixedFee: number;
  paymentFee: number;
  serviceFee: number;
  affiliateFee: number;
  adWalletTopup: number;
  sellerVoucher: number;
  platformSubsidy: number;
  shippingFeeQuoted: number;
  shippingFeeActual: number;
  shipSubsidyPlatform: number;
  shipSubsidyShop: number;
  shippingFeeDiff: number;
  taxWithheld: number;
  refundedAmount: number;
  actualPayout: number;
}

/** Trường phí đã có cột riêng — phần fee CÒN LẠI dồn vào feeOther. */
const FEE_KNOWN = new Set([
  "platform_commission_amount",
  "transaction_fee_amount",
  "vn_fix_infrastructure_fee",
  "sfp_service_fee_amount",
  "voucher_xtra_service_fee_amount",
  "flash_sales_service_fee_amount",
  "affiliate_commission_amount",
  "affiliate_commission_amount_before_pit",
  "affiliate_commission_before_pit_amount",
  "affiliate_ads_commission_amount",
  "affiliate_partner_commission_amount",
  "gmv_max_ad_fee_amount",
  "gmv_max_coupon_fee",
  // PIT khấu trừ từ hoa hồng creator (unsettled 202507) đã nằm trong before_pit
  "pit_withheld_from_ads_commission_amount",
]);
const TAX_KNOWN = new Set(["local_vat_amount", "vat_amount", "pit_amount"]);

/**
 * Tên trường + giá trị KHÁC 0 của khối phí/thuế một dòng — ghi log MỘT lần mỗi
 * lượt đồng bộ để đối chiếu tên phí thật với bảng mapping (logShape chỉ in tên
 * cấp 2, không tới fee/tax). Export để tái dùng ở công cụ tra bản kê thô.
 */
export function describeTiktokFeeTax(line: TikTokTxBreakdown): string {
  const show = (label: string, m: TikTokAmountMap | undefined) =>
    `${label}=[${Object.entries(m ?? {})
      .filter(([, v]) => typeof v !== "object" && n(v) !== 0)
      .map(([k, v]) => `${k}:${v}`)
      .join(",")}]`;
  return [
    show("fee", line.fee_tax_breakdown?.fee),
    show("tax", line.fee_tax_breakdown?.tax),
    show("ship", line.shipping_cost_breakdown),
    show("revenue", line.revenue_breakdown),
  ].join(" ");
}
/** Phụ phí logistics sàn trừ (ngoài cước chính/ship hoàn) — gom cột shipOther. */
const SHIP_OTHER = [
  "signature_confirmation_fee_amount",
  "shipping_insurance_fee_amount",
  "logistics_service_fee",
  "shipping_app_service_fee_amount",
  "international_leg_logistics_amount",
  "seller_self_shipping_service_fee_amount",
  "distant_shipping_fee_amount",
  "replacement_shipping_fee_amount",
  "exchange_shipping_fee_amount",
];
/** Sàn bù ship giao thất bại/hoàn (dương) — gom cột shipReimbursement. */
const SHIP_REIMBURSE = [
  "sfr_reimbursement",
  "shipping_fee_guarantee_reimbursement",
  "failed_delivery_subsidy_amount",
  "free_return_subsidy_amount",
  "return_shipping_fee_paid_buyer_amount",
  "fbt_fulfillment_fee_reimbursement_amount",
  "tiktok_shop_shipping_incentive_amount",
  "fbt_overall_merchant_subsidy",
  "fbt_key_merchant_subsidy",
];

/** Tổng có dấu của một khoá qua nhiều khối breakdown. */
function sumKey(maps: (TikTokAmountMap | undefined)[], key: string): number {
  return maps.reduce((s, m) => s + n(m?.[key]), 0);
}

/** Tổng có dấu của MỌI khoá trong khối, trừ các khoá đã có cột riêng. */
function sumRest(maps: (TikTokAmountMap | undefined)[], known: Set<string>): number {
  let s = 0;
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (known.has(k)) continue;
      if (typeof v === "object") continue; // khối con (supplementary_component)
      s += n(v);
    }
  }
  return s;
}

/** Tổng có dấu một trường "tổng" — bản kê dùng X, unsettled dùng est_X. */
function total(lines: TikTokTxBreakdown[], key: string): number {
  return lines.reduce(
    (s, t) => s + n((t as Record<string, unknown>)[key] ?? (t as Record<string, unknown>)[`est_${key}`]),
    0
  );
}

/**
 * Cộng dồn MỌI dòng (ORDER/REFUND/điều chỉnh) của MỘT đơn thành sao kê chi
 * tiết có dấu + cột gộp Order. Export để vitest đánh thẳng bằng payload docs.
 */
export function mapTiktokBreakdownToSettlement(lines: TikTokTxBreakdown[]): {
  detail: TiktokSettlementDetailCols;
  order: TiktokOrderCols;
} {
  const rb = lines.map((t) => t.revenue_breakdown);
  const sb = lines.map((t) => t.shipping_cost_breakdown);
  const sc = lines.map((t) => asMap(t.shipping_cost_breakdown?.supplementary_component));
  const fee = lines.map((t) => t.fee_tax_breakdown?.fee);
  const tax = lines.map((t) => t.fee_tax_breakdown?.tax);
  const sup = lines.map((t) => t.supplementary_component);

  // ---- Doanh thu ----
  const grossSales = sumKey(rb, "subtotal_before_discount_amount");
  const sellerDiscount = sumKey(rb, "seller_discount_amount");
  const refundGross = sumKey(rb, "refund_subtotal_before_discount_amount");
  const sellerDiscountRefund = sumKey(rb, "seller_discount_refund_amount");
  const revenueAmount = total(lines, "revenue_amount");
  const platformDiscount = sumKey(sup, "platform_discount_amount");
  const customerRefund = sumKey(sup, "customer_refund_amount");

  // ---- Vận chuyển ----
  const shipActual = sumKey(sb, "actual_shipping_fee_amount");
  const shipCustomerPaid = sumKey(sb, "customer_paid_shipping_fee_amount");
  const shipPlatformDiscount = sumKey(sc, "platform_shipping_fee_discount_amount");
  const shipSubsidy =
    sumKey(sc, "shipping_fee_subsidy_amount") + sumKey(sc, "promo_shipping_incentive_amount");
  const shipSellerDiscount = sumKey(sc, "seller_shipping_fee_discount_amount");
  const shipReturn = sumKey(sb, "return_shipping_fee_amount");
  const shipOther = SHIP_OTHER.reduce((s, k) => s + sumKey(sb, k), 0);
  const shipReimbursement = SHIP_REIMBURSE.reduce((s, k) => s + sumKey(sb, k), 0);
  const shippingCost = total(lines, "shipping_cost_amount");

  // ---- Phí ----
  const feeCommission = sumKey(fee, "platform_commission_amount");
  const feeTransaction = sumKey(fee, "transaction_fee_amount");
  const feeOrderProcessing = sumKey(fee, "vn_fix_infrastructure_fee");
  const feeSfp = sumKey(fee, "sfp_service_fee_amount");
  const feeVoucherXtra = sumKey(fee, "voucher_xtra_service_fee_amount");
  const feeFlashSale = sumKey(fee, "flash_sales_service_fee_amount");
  // Hoa hồng affiliate: SEA trả cả before_pit (chi phí thật của shop, gồm TNCN
  // creator shop phải nộp thay) lẫn amount (đã trừ PIT). Ưu tiên before_pit;
  // hai tên trường docs 202501 vs 202507 khác nhau nên đọc cả hai.
  const hasBeforePit = fee.some(
    (m) =>
      m?.affiliate_commission_amount_before_pit !== undefined ||
      m?.affiliate_commission_before_pit_amount !== undefined
  );
  const feeAffiliate = hasBeforePit
    ? sumKey(fee, "affiliate_commission_amount_before_pit") +
      sumKey(fee, "affiliate_commission_before_pit_amount")
    : sumKey(fee, "affiliate_commission_amount");
  const feeAffiliateAds = sumKey(fee, "affiliate_ads_commission_amount");
  const feeAffiliatePartner = sumKey(fee, "affiliate_partner_commission_amount");
  const feeGmvMax = sumKey(fee, "gmv_max_ad_fee_amount") + sumKey(fee, "gmv_max_coupon_fee");
  const feeTaxAmount = total(lines, "fee_tax_amount");
  // GTGT sàn nộp hộ: docs 202501 ghi local_vat_amount (đơn nội địa) nhưng payload
  // thật and.not.or 16/09 trả 1% doanh thu dưới tên khác (rơi vào taxOther) →
  // nhận cả vat_amount; đơn VN không có VAT xuyên biên giới nên không đếm đôi.
  const taxVat = sumKey(tax, "local_vat_amount") + sumKey(tax, "vat_amount");
  const taxPit = sumKey(tax, "pit_amount");
  const taxOther = sumRest(tax, TAX_KNOWN);
  // CHỐT CHẶN: phí chưa có cột = phần dư của fee_tax_amount sau khi bóc mọi
  // cột đã đặt tên + thuế — không rơi một đồng nào khỏi bảng. Khi sàn không
  // trả fee_tax_amount (thiếu tổng) thì cộng các trường fee còn lại.
  const feeNamed =
    feeCommission + feeTransaction + feeOrderProcessing + feeSfp + feeVoucherXtra +
    feeFlashSale + feeAffiliate + feeAffiliateAds + feeAffiliatePartner + feeGmvMax;
  const feeOther =
    feeTaxAmount !== 0
      ? feeTaxAmount - feeNamed - taxVat - taxPit - taxOther
      : sumRest(fee, FEE_KNOWN);

  // ---- Điều chỉnh & kết quả ----
  const adjustmentAmount = total(lines, "adjustment_amount");
  const adjustmentTypeList = [
    ...new Set(lines.map((t) => t.type).filter((x): x is string => !!x && x !== "ORDER")),
  ];
  const settlementAmount = total(lines, "settlement_amount");

  const detail: TiktokSettlementDetailCols = {
    grossSales, sellerDiscount, refundGross, sellerDiscountRefund, revenueAmount,
    platformDiscount, customerRefund,
    shipActual, shipCustomerPaid, shipPlatformDiscount, shipSubsidy, shipSellerDiscount,
    shipReturn, shipOther, shipReimbursement, shippingCost,
    feeCommission, feeTransaction, feeOrderProcessing, feeSfp, feeVoucherXtra, feeFlashSale,
    feeAffiliate, feeAffiliateAds, feeAffiliatePartner, feeGmvMax, feeOther, feeTaxAmount,
    taxVat, taxPit, taxOther,
    adjustmentAmount,
    adjustmentTypes: adjustmentTypeList.length ? adjustmentTypeList.join(",") : null,
    settlementAmount,
  };

  // ---- Cột gộp Order (lưu DƯƠNG). Nhóm nào ròng DƯƠNG (sàn ghi có: hoàn phí,
  // rebate) thì không âm hoá mà dồn sang platformSubsidy để công thức chung
  // vẫn cộng đúng chiều. Dòng điều chỉnh gắn đơn: ÂM → phí dịch vụ (riêng
  // SHIPPING_FEE_ADJUSTMENT → ship shop chịu), DƯƠNG → trợ giá.
  const isShipAdj = detail.adjustmentTypes?.includes("SHIPPING_FEE") ?? false;
  const adjCharged = charged(adjustmentAmount);
  const adjCredited = credited(adjustmentAmount);
  const serviceSigned = feeSfp + feeVoucherXtra + feeFlashSale + feeOther + feeGmvMax;
  const taxSigned = taxVat + taxPit + taxOther;
  const affiliateSigned = feeAffiliate + feeAffiliateAds + feeAffiliatePartner;
  const fixedSigned = feeCommission;
  const paymentSigned = feeTransaction + feeOrderProcessing;

  const order: TiktokOrderCols = {
    fixedFee: charged(fixedSigned),
    paymentFee: charged(paymentSigned),
    // GMV Max là chi phí quảng cáo THẬT trừ ngay trong đơn (không phải chuyển
    // ví như Shopee) → tính vào phí dịch vụ để Doanh thu ước tính khớp payout;
    // cột riêng feeGmvMax của sao kê chi tiết vẫn tách để đọc.
    serviceFee: charged(serviceSigned) + (isShipAdj ? 0 : adjCharged),
    affiliateFee: charged(affiliateSigned),
    adWalletTopup: 0,
    sellerVoucher: charged(sellerDiscount),
    // revenue_amount đã gồm phần sàn bù chiết khấu nền tảng → KHÔNG cộng
    // platformDiscount vào đây (computePnlRow đọc grossSales/sellerDiscount từ
    // sao kê chi tiết). Chỉ ghi các khoản sàn GHI CÓ ngoài doanh thu.
    platformSubsidy:
      credited(fixedSigned) + credited(paymentSigned) + credited(serviceSigned) +
      credited(affiliateSigned) + credited(taxSigned) + adjCredited,
    shippingFeeQuoted: credited(shipCustomerPaid),
    shippingFeeActual: charged(shipActual) + charged(shipReturn) + charged(shipOther),
    shipSubsidyPlatform: credited(shipPlatformDiscount) + credited(shipSubsidy) + credited(shipReimbursement),
    shipSubsidyShop: charged(shipSellerDiscount) + credited(shipSellerDiscount),
    // Phí vận chuyển của nhà bán hàng = shipping_cost_amount ròng (TikTok định
    // nghĩa: thực tế − khách trả − nền tảng trợ). Cộng thêm điều chỉnh ship âm.
    shippingFeeDiff: charged(shippingCost) + (isShipAdj ? adjCharged : 0),
    taxWithheld: charged(taxSigned),
    // Tiền TRẢ LẠI KHÁCH tính trên phần doanh thu shop bị đảo: giá gốc hoàn −
    // chiết khấu shop được trả lại (hết đếm đôi customer_refund + order_refund).
    refundedAmount: charged(refundGross + sellerDiscountRefund),
    actualPayout: settlementAmount,
  };

  return { detail, order };
}

/** Mốc quyết toán dự kiến của dòng unsettled (chỉ khi sàn trả unix giây). */
export function parseEstimatedSettlement(raw: string | undefined): Date | null {
  if (!raw) return null;
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < 1_000_000_000) return null;
  return new Date(sec * 1000);
}

/**
 * Gom dòng giao dịch theo ĐƠN: dòng ORDER/REFUND/RESERVE dùng order_id, dòng
 * điều chỉnh dùng adjustment_order_id (order_id trống). Dòng không gắn đơn
 * (phạt, ship mẫu, nạp ví ads cấp shop…) bỏ qua ở đây — trả về riêng để nơi
 * gọi đếm.
 */
export function groupTiktokLinesByOrder(lines: TikTokTxBreakdown[]): {
  byOrder: Map<string, TikTokTxBreakdown[]>;
  unlinked: number;
} {
  const byOrder = new Map<string, TikTokTxBreakdown[]>();
  let unlinked = 0;
  for (const t of lines) {
    const key = t.order_id || t.adjustment_order_id;
    if (!key || key === "0") {
      unlinked++;
      continue;
    }
    const acc = byOrder.get(key) ?? [];
    acc.push(t);
    byOrder.set(key, acc);
  }
  return { byOrder, unlinked };
}
