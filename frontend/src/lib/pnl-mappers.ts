/**
 * MAPPER LÃI/LỖ THỰC HIỆN THEO SÀN
 *
 * Ánh xạ "detail row" giàu trường (PnlDetailRow) sang cấu trúc CỘT ĐẶC THÙ của
 * từng sàn. Trường nào Hubsell CHƯA có dữ liệu thật (Shopee đọc từ file quyết
 * toán/Salework) thì để 0 và ghi chú "giữ chỗ" — dựng đủ khung cột trước, cắm số
 * thật sau khi luồng đồng bộ hoàn tất. Mọi khoản phí là magnitude dương.
 */

import type { PnlDetailRow, TiktokSettlementDetail } from "@/lib/api";

// ───────────────────────── SHOPEE ─────────────────────────

export interface ShopeeProfitRow {
  base: PnlDetailRow;
  // Doanh thu & trợ giá
  revenueGross: number;
  shopeeSubsidy: number; // Trợ giá Shopee
  // Phí vận chuyển
  shipQuoted: number; // Phí VC Dự kiến
  shipActual: number; // Phí VC Thực tế
  shipSubsidyShopee: number; // Trợ giá VC Shopee
  shipSubsidyShop: number; // Trợ giá VC Shop
  buyerPaidShip: number; // Người mua trả — giữ chỗ
  shipDiff: number; // Chênh lệch phí vận chuyển
  // Phí sàn & thuế (âm)
  feePlatform: number; // Phí sàn (cố định + thanh toán)
  feeAffiliate: number; // Phí TTLK (Affiliate)
  // Đối chiếu Seller Center VN 05/08/2026: "Phí Dịch Vụ" (Freeship/Voucher
  // Xtra) và "Phí dịch vụ PiShip" (bảo hiểm giao hàng) là HAI dòng khác nhau —
  // trước đây cột "PiShip (Xtra)" hiển thị nhầm Phí Dịch Vụ.
  feeServiceXtra: number; // Phí Dịch Vụ (Freeship/Voucher Xtra)
  feePiship: number; // Phí dịch vụ PiShip (bảo hiểm giao hàng)
  adWallet: number; // Nạp ví quảng cáo (sàn khấu trừ khi giải ngân)
  sellerSubsidy: number; // Trợ giá người bán
  tax: number; // Thuế sàn thu hộ
  // Hiệu quả kinh doanh
  estRevenue: number; // Doanh thu ước tính
  revenueFromShopee: number; // Doanh thu từ Shopee
  costSnapshot: number; // Chi phí giá vốn
  profit: number; // Doanh thu từ Shopee − Giá vốn (= profitAfterTax backend)
}

export function toShopeeRow(r: PnlDetailRow): ShopeeProfitRow {
  // Doanh thu từ Shopee = platformRevenue của backend (SSOT computePnlRow):
  // số sàn báo về ví (escrow thật hoặc ước tính của chính sàn) — KỂ CẢ ÂM: đơn
  // hoàn tiền 100% escrow = −2.700 (PiShip) (anh Trung 20/08). Chưa có số của
  // sàn thì backend rơi về doanh thu − tiền hoàn. Lợi nhuận = profitAfterTax
  // để bảng, thẻ KPI, biểu đồ ngày, bộ lọc Lợi nhuận âm cùng MỘT số (15/09).
  const revenueFromShopee = r.platformRevenue;
  return {
    base: r,
    revenueGross: r.revenueGross,
    shopeeSubsidy: r.platformSubsidy,
    shipQuoted: r.shippingFeeQuoted,
    shipActual: r.shippingFeeActual,
    shipSubsidyShopee: r.shipSubsidyPlatform,
    shipSubsidyShop: r.shipSubsidyShop,
    buyerPaidShip: 0,
    shipDiff: r.shippingFeeDiff,
    feePlatform: r.feeFixedPayment,
    feeAffiliate: r.feeAffiliate,
    feeServiceXtra: r.feeService,
    feePiship: r.feeSellerProtection,
    adWallet: r.adWalletTopup,
    sellerSubsidy: r.sellerVoucher,
    tax: r.taxWithheld,
    estRevenue: r.netRevenue,
    revenueFromShopee,
    costSnapshot: r.costSnapshot,
    profit: r.profitAfterTax,
  };
}

// ───────────────────────── TIKTOK SHOP ─────────────────────────
//
// 16/09/2026 (chốt anh Trung): cột = ĐÚNG TÊN PHÍ TikTok Shop VN, mỗi cột một
// trường của bản kê Finance API 202501 (đã quyết toán) hoặc Get Unsettled
// Transactions 202507 (số ước tính của chính sàn). Số CÓ DẤU nguyên bản: âm =
// sàn trừ shop, dương = ghi có. Đơn chưa có dòng nào từ sàn (provisional) chỉ
// có số từ API đơn hàng — cột phí để 0, không tự ước %.

export interface TiktokProfitRow {
  base: PnlDetailRow;
  detail: TiktokSettlementDetail | null;
  /** Số ước tính của sàn (đơn chờ đối soát, từ Unsettled 202507). */
  estimated: boolean;
  /** Chưa có dòng nào từ sàn — chỉ số tạm từ API đơn hàng. */
  provisional: boolean;
  // Doanh thu
  grossSales: number; // Giá gốc sản phẩm
  sellerDiscount: number; // Chiết khấu của nhà bán hàng (âm)
  revenueAmount: number; // Tổng phụ sau chiết khấu của nhà bán hàng
  platformDiscount: number; // Chiết khấu nền tảng (sàn chịu, tham chiếu)
  refundGross: number; // Doanh thu hoàn trả (âm)
  // Phí vận chuyển
  shipActual: number;
  shipCustomerPaid: number;
  shipPlatformDiscount: number;
  shipSubsidy: number;
  shipSellerDiscount: number;
  shipReturn: number;
  shipOther: number;
  shipReimbursement: number;
  shippingCost: number; // Phí vận chuyển của nhà bán hàng (ròng)
  // Phí
  feeCommission: number;
  feeTransaction: number;
  feeOrderProcessing: number;
  feeSfp: number;
  feeVoucherXtra: number;
  feeFlashSale: number;
  feeAffiliate: number;
  feeAffiliateAds: number;
  feeAffiliatePartner: number;
  feeGmvMax: number;
  feeOther: number;
  // Thuế
  taxVat: number;
  taxPit: number;
  taxOther: number;
  // Điều chỉnh & kết quả
  adjustmentAmount: number;
  adjustmentTypes: string | null;
  settlementAmount: number; // Số tiền quyết toán (tiền về ví) — = platformRevenue
  costSnapshot: number;
  profit: number;
}

export function toTiktokRow(r: PnlDetailRow): TiktokProfitRow {
  const d = r.tiktok;
  if (d) {
    return {
      base: r,
      detail: d,
      estimated: d.estimated,
      provisional: false,
      grossSales: d.grossSales,
      sellerDiscount: d.sellerDiscount,
      revenueAmount: d.revenueAmount,
      platformDiscount: d.platformDiscount,
      refundGross: d.refundGross + d.sellerDiscountRefund,
      shipActual: d.shipActual,
      shipCustomerPaid: d.shipCustomerPaid,
      shipPlatformDiscount: d.shipPlatformDiscount,
      shipSubsidy: d.shipSubsidy,
      shipSellerDiscount: d.shipSellerDiscount,
      shipReturn: d.shipReturn,
      shipOther: d.shipOther,
      shipReimbursement: d.shipReimbursement,
      shippingCost: d.shippingCost,
      feeCommission: d.feeCommission,
      feeTransaction: d.feeTransaction,
      feeOrderProcessing: d.feeOrderProcessing,
      feeSfp: d.feeSfp,
      feeVoucherXtra: d.feeVoucherXtra,
      feeFlashSale: d.feeFlashSale,
      feeAffiliate: d.feeAffiliate,
      feeAffiliateAds: d.feeAffiliateAds,
      feeAffiliatePartner: d.feeAffiliatePartner,
      feeGmvMax: d.feeGmvMax,
      feeOther: d.feeOther,
      taxVat: d.taxVat,
      taxPit: d.taxPit,
      taxOther: d.taxOther,
      adjustmentAmount: d.adjustmentAmount,
      adjustmentTypes: d.adjustmentTypes,
      // Tiền về ví theo SSOT backend (đã quyết toán = payout thật; ước tính =
      // est_settlement) — cùng số với cột Lợi nhuận của thẻ/biểu đồ.
      settlementAmount: r.platformRevenue,
      costSnapshot: r.costSnapshot,
      profit: r.profitAfterTax,
    };
  }
  // Chưa có dòng nào từ sàn: doanh thu tạm = giá khách trả + phần sàn bù chiết
  // khấu nền tảng (API đơn hàng), phí/thuế 0 — tuyệt đối không ước %.
  return {
    base: r,
    detail: null,
    estimated: false,
    provisional: true,
    grossSales: r.revenueGross,
    sellerDiscount: -r.sellerVoucher,
    revenueAmount: r.revenueGross - r.sellerVoucher + r.platformSubsidy,
    platformDiscount: r.platformSubsidy,
    refundGross: -r.refundedAmount,
    shipActual: 0,
    shipCustomerPaid: 0,
    shipPlatformDiscount: 0,
    shipSubsidy: 0,
    shipSellerDiscount: 0,
    shipReturn: 0,
    shipOther: 0,
    shipReimbursement: 0,
    shippingCost: 0,
    feeCommission: 0,
    feeTransaction: 0,
    feeOrderProcessing: 0,
    feeSfp: 0,
    feeVoucherXtra: 0,
    feeFlashSale: 0,
    feeAffiliate: 0,
    feeAffiliateAds: 0,
    feeAffiliatePartner: 0,
    feeGmvMax: 0,
    feeOther: 0,
    taxVat: 0,
    taxPit: 0,
    taxOther: 0,
    adjustmentAmount: 0,
    adjustmentTypes: null,
    settlementAmount: r.platformRevenue,
    costSnapshot: r.costSnapshot,
    profit: r.profitAfterTax,
  };
}

/**
 * DANH SÁCH CỘT SỐ của tab TikTok — nguồn duy nhất cho bảng, Excel và luật ẩn
 * cột trống. Nhãn = tên TikTok Shop VN. `always` = luôn hiện dù cả kỳ bằng 0.
 */
export interface TiktokColumnDef {
  key: keyof TiktokProfitRow;
  label: string;
  group: "revenue" | "ship" | "fee" | "tax" | "result";
  always?: boolean;
  hint?: string;
}

export const TIKTOK_COLUMNS: TiktokColumnDef[] = [
  { key: "grossSales", label: "Giá gốc sản phẩm", group: "revenue", always: true, hint: "subtotal_before_discount_amount — giá niêm yết mọi dòng hàng, trước chiết khấu của nhà bán hàng lẫn nền tảng." },
  { key: "sellerDiscount", label: "Chiết khấu của nhà bán hàng", group: "revenue", always: true, hint: "seller_discount_amount — giảm giá do shop chịu (Product Discount, Flash Deal, voucher, phần shop trong voucher đồng tài trợ)." },
  { key: "revenueAmount", label: "Tổng phụ sau chiết khấu của nhà bán hàng", group: "revenue", always: true, hint: "revenue_amount — số TikTok dùng để tính hoa hồng và trả cho shop; ĐÃ gồm phần sàn bù chiết khấu nền tảng." },
  { key: "platformDiscount", label: "Chiết khấu nền tảng", group: "revenue", hint: "platform_discount_amount — giảm giá do TikTok tài trợ, sàn bù lại cho shop nên không trừ vào doanh thu (tham chiếu)." },
  { key: "refundGross", label: "Doanh thu hoàn trả", group: "revenue", hint: "refund_subtotal_before_discount_amount + seller_discount_refund_amount — phần doanh thu bị đảo do hoàn tiền/trả hàng." },
  { key: "shipActual", label: "Phí vận chuyển thực tế", group: "ship", always: true, hint: "actual_shipping_fee_amount — cước hãng tính theo cân nặng/kích thước thật." },
  { key: "shipCustomerPaid", label: "Phí vận chuyển của khách hàng", group: "ship", hint: "customer_paid_shipping_fee_amount — phần ship khách trả (âm = hoàn lại khách)." },
  { key: "shipPlatformDiscount", label: "Chiết khấu phí vận chuyển của nền tảng", group: "ship", hint: "platform_shipping_fee_discount_amount — sàn giảm ship theo chiến dịch." },
  { key: "shipSubsidy", label: "Trợ cấp phí vận chuyển", group: "ship", hint: "shipping_fee_subsidy_amount + promo_shipping_incentive_amount — sàn trợ ship cho shop tự giao / đồng tài trợ freeship." },
  { key: "shipSellerDiscount", label: "Chiết khấu phí vận chuyển của nhà bán hàng", group: "ship", hint: "seller_shipping_fee_discount_amount — shop giảm ship cho khách." },
  { key: "shipReturn", label: "Phí vận chuyển trả hàng thực tế", group: "ship", hint: "return_shipping_fee_amount — ship hoàn shop chịu khi lỗi thuộc về shop." },
  { key: "shipOther", label: "Phụ phí logistics khác", group: "ship", hint: "Ký nhận, bảo hiểm vận chuyển, logistics_service_fee, phí app vận chuyển…" },
  { key: "shipReimbursement", label: "Bồi hoàn phí vận chuyển", group: "ship", hint: "Sàn bồi hoàn ship giao thất bại / trả hàng / bảo đảm phí vận chuyển." },
  { key: "shippingCost", label: "Phí vận chuyển của nhà bán hàng", group: "ship", always: true, hint: "shipping_cost_amount — số RÒNG shop thực chịu = thực tế − khách trả − nền tảng trợ (định nghĩa TikTok)." },
  { key: "feeCommission", label: "Phí hoa hồng nền tảng", group: "fee", always: true, hint: "platform_commission_amount — % theo ngành hàng × (giá gốc − chiết khấu của nhà bán hàng)." },
  { key: "feeTransaction", label: "Phí giao dịch", group: "fee", always: true, hint: "transaction_fee_amount — 6% (từ 09/05/2026) trên số khách trả + chiết khấu nền tảng − hoàn." },
  { key: "feeOrderProcessing", label: "Phí xử lý đơn hàng", group: "fee", always: true, hint: "vn_fix_infrastructure_fee — 3.000đ/đơn giao thành công (từ 27/10/2025)." },
  { key: "feeSfp", label: "Phí dịch vụ Freeship Xtra", group: "fee", hint: "sfp_service_fee_amount — phí tham gia Chương trình Freeship Xtra (SFP)." },
  { key: "feeVoucherXtra", label: "Phí dịch vụ Voucher Xtra", group: "fee", hint: "voucher_xtra_service_fee_amount." },
  { key: "feeFlashSale", label: "Phí dịch vụ Flash Sale", group: "fee", hint: "flash_sales_service_fee_amount." },
  { key: "feeAffiliate", label: "Hoa hồng affiliate", group: "fee", hint: "affiliate_commission_amount_before_pit — hoa hồng trả creator, gồm cả TNCN của creator mà shop nộp thay." },
  { key: "feeAffiliateAds", label: "Hoa hồng quảng cáo affiliate", group: "fee", hint: "affiliate_ads_commission_amount — đơn từ quảng cáo (Shop Ads)." },
  { key: "feeAffiliatePartner", label: "Hoa hồng cho đối tác affiliate", group: "fee", hint: "affiliate_partner_commission_amount." },
  { key: "feeGmvMax", label: "Nạp tiền quảng cáo từ đơn hàng", group: "fee", hint: "gmv_max_ad_fee_amount + gmv_max_coupon_fee — chi phí GMV Max trừ ngay trong đơn." },
  { key: "feeOther", label: "Phí khác của nền tảng", group: "fee", hint: "Phần còn lại của fee_tax_amount sau khi bóc các cột đã đặt tên — chốt chặn để tổng luôn khớp sàn." },
  { key: "taxVat", label: "Thuế GTGT khấu trừ", group: "tax", always: true, hint: "local_vat_amount — 1% doanh thu, sàn nộp hộ hộ kinh doanh/cá nhân (NĐ 117/2025)." },
  { key: "taxPit", label: "Thuế TNCN khấu trừ", group: "tax", always: true, hint: "pit_amount — 0,5% doanh thu, sàn nộp hộ." },
  { key: "taxOther", label: "Thuế khác", group: "tax", hint: "Các sắc thuế vùng khác không áp Việt Nam — chốt chặn." },
  { key: "adjustmentAmount", label: "Khoản điều chỉnh", group: "result", hint: "adjustment_amount của các dòng điều chỉnh gắn đơn (loại ghi ở chú thích)." },
  { key: "settlementAmount", label: "Số tiền quyết toán", group: "result", always: true, hint: "settlement_amount — tiền TikTok trả về ví cho đơn (ước tính khi chưa quyết toán)." },
  { key: "costSnapshot", label: "Giá vốn sản phẩm", group: "result", always: true },
  { key: "profit", label: "LỢI NHUẬN THỰC TẾ", group: "result", always: true, hint: "Số tiền quyết toán − Giá vốn." },
];

