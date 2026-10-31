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
  /** Giá gốc trước mọi KM (escrow order_original_price; đơn hủy/chưa escrow: Σ giá niêm yết dòng). null = chưa có. */
  originalPrice: number | null;
  /** Giảm giá sản phẩm của shop (escrow order_seller_discount; dự phòng Σ(niêm yết − giá bán) dòng). */
  sellerDiscountSp: number | null;
  /** Giảm giá combo / mua kèm (order_selling_price − order_discounted_price). */
  bundleDiscount: number | null;
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
  // Giá gốc / giảm giá SP: số escrow của sàn; đơn hủy (escrow rỗng) hay đơn chưa có
  // escrow thì cộng từ giá niêm yết dòng hàng (API đơn) — chỉ khi MỌI dòng có số.
  const linesHaveOriginal = r.items.length > 0 && r.items.every((it) => it.originalPrice != null);
  const lineOriginal = linesHaveOriginal
    ? r.items.reduce((s, it) => s + (it.originalPrice ?? 0) * it.quantity, 0)
    : null;
  const originalPrice = r.shopeeOriginalPrice ?? lineOriginal;
  const sellerDiscountSp =
    r.shopeeSellerDiscount ?? (lineOriginal == null ? null : lineOriginal - r.revenueGross);
  return {
    base: r,
    originalPrice,
    sellerDiscountSp,
    bundleDiscount: r.shopeeBundleDiscount,
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
  shipRest: number;
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
  feeAffiliatePartnerAds: number;
  feeGmvMax: number;
  /** Cột con của feeGmvMax (voucher GMV Max) — chỉ để đối chiếu Seller Center, không cộng thêm. */
  feeGmvMaxVoucher: number;
  feeBonusCashback: number;
  feeShipGuarantee: number;
  feeOther: number;
  /** Voucher shop nằm trong Giảm giá của người bán (price_detail) — 0 khi chưa đọc (base.tiktokVoucherSeller null). */
  voucherSeller: number;
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
      voucherSeller: r.tiktokVoucherSeller ?? 0,
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
      shipRest: d.shipRest ?? 0,
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
      feeAffiliatePartnerAds: d.feeAffiliatePartnerAds ?? 0,
      feeGmvMax: d.feeGmvMax,
      feeGmvMaxVoucher: d.feeGmvMaxVoucher ?? 0,
      feeBonusCashback: d.feeBonusCashback ?? 0,
      feeShipGuarantee: d.feeShipGuarantee ?? 0,
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
    voucherSeller: r.tiktokVoucherSeller ?? 0,
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
    shipRest: 0,
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
    feeAffiliatePartnerAds: 0,
    feeGmvMax: 0,
    feeGmvMaxVoucher: 0,
    feeBonusCashback: 0,
    feeShipGuarantee: 0,
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
 * cột trống. Nhãn = đúng tên dòng trên Báo cáo kinh doanh của Seller Center
 * (đối chiếu 31/10/2026, docs TIKTOK-PHI-BAO-CAO-KINH-DOANH-DOI-CHIEU-API-KHAO-SAT-31-10.md).
 * `always` = luôn hiện dù cả kỳ bằng 0.
 *
 * Tooltip (hint) viết cho CHỦ SHOP: ngắn, phổ thông, không tên trường API —
 * tên trường ghi ở chú thích `// API:` cạnh mỗi cột cho người sửa mã.
 */
export interface TiktokColumnDef {
  key: keyof TiktokProfitRow;
  label: string;
  group: "revenue" | "ship" | "fee" | "tax" | "result";
  always?: boolean;
  hint?: string;
}

export const TIKTOK_COLUMNS: TiktokColumnDef[] = [
  // ---- Doanh thu ----
  // API: subtotal_before_discount_amount
  { key: "grossSales", label: "Tổng phụ trước giảm giá", group: "revenue", always: true, hint: "Giá niêm yết của mọi món trong đơn, trước mọi khoản giảm giá." },
  // API: seller_discount_amount
  { key: "sellerDiscount", label: "Giảm giá của người bán", group: "revenue", always: true, hint: "Phần giảm giá do shop chịu: giảm giá sản phẩm, Flash Deal, voucher của shop và phần shop góp trong voucher đồng tài trợ." },
  // API: voucher_deduction_seller (Get Order Price Details)
  { key: "voucherSeller", label: "Trong đó: voucher của shop", group: "revenue", hint: "Phần voucher của shop đã nằm trong Giảm giá của người bán, tách ra để đối chiếu. Đơn chưa đọc được hiện dấu gạch." },
  // API: revenue_amount
  { key: "revenueAmount", label: "Tổng phụ sau giảm giá của người bán", group: "revenue", always: true, hint: "Số TikTok dùng để tính hoa hồng và trả tiền cho shop. Đã gồm phần sàn bù cho giảm giá của nền tảng." },
  // API: supplementary_component.platform_discount_amount
  { key: "platformDiscount", label: "Giảm giá của nền tảng", group: "revenue", hint: "Giảm giá do TikTok tài trợ. Sàn bù lại cho shop nên không trừ vào doanh thu, chỉ để tham khảo." },
  // API: refund_subtotal_before_discount_amount + seller_discount_refund_amount
  { key: "refundGross", label: "Doanh thu hoàn trả", group: "revenue", hint: "Phần doanh thu bị trừ lại khi đơn hoàn tiền hoặc trả hàng. Seller Center gọi là “Tổng phụ của khoản hoàn tiền sau giảm giá của người bán”." },
  // ---- Phí vận chuyển ----
  // API: actual_shipping_fee_amount
  { key: "shipActual", label: "Phí vận chuyển thực tế", group: "ship", always: true, hint: "Cước đơn vị vận chuyển tính theo cân nặng, kích thước thật của kiện hàng." },
  // API: customer_paid_shipping_fee_amount (sàn chỉ trả số ròng)
  { key: "shipCustomerPaid", label: "Chi phí vận chuyển của khách hàng", group: "ship", hint: "Phần phí ship khách thực trả, đã trừ giảm giá ship của TikTok và phần hoàn lại cho khách. Sàn chỉ báo số sau cùng này, không tách “trước giảm giá” hay “giảm của TikTok Shop”." },
  // API: supplementary_component.platform_shipping_fee_discount_amount
  { key: "shipPlatformDiscount", label: "Chiết khấu phí vận chuyển của nền tảng", group: "ship", hint: "TikTok bù phí ship cho shop theo chương trình đang chạy." },
  // API: shipping_fee_subsidy_amount + promo_shipping_incentive_amount
  { key: "shipSubsidy", label: "Trợ giá vận chuyển", group: "ship", hint: "Sàn trợ thêm phí ship cho shop (shop tự giao hàng, đồng tài trợ freeship)." },
  // API: supplementary_component.seller_shipping_fee_discount_amount
  { key: "shipSellerDiscount", label: "Giảm phí vận chuyển của người bán", group: "ship", hint: "Shop tự giảm phí ship cho khách." },
  // API: return_shipping_fee_amount
  { key: "shipReturn", label: "Phí vận chuyển trả hàng thực tế", group: "ship", hint: "Cước chiều hàng hoàn về mà shop chịu." },
  // API: signature_confirmation / shipping_insurance / logistics_service_fee / hazmat / non_standard…
  { key: "shipOther", label: "Phụ phí vận chuyển", group: "ship", hint: "Các khoản vận chuyển sàn thu thêm: ký nhận, bảo hiểm hàng, phí dịch vụ logistics, kiện quá khổ hoặc quá cân." },
  // API: failed_delivery_subsidy / free_return_subsidy / shipping_fee_guarantee_reimbursement…
  { key: "shipReimbursement", label: "Sàn bồi hoàn phí vận chuyển", group: "ship", hint: "Sàn trả lại tiền ship khi giao không thành công, khách trả hàng hoặc theo chương trình Bảo đảm phí vận chuyển." },
  // Chốt chặn = shippingCost − Σ 8 cột trên (31/10/2026)
  { key: "shipRest", label: "Khoản vận chuyển khác", group: "ship", hint: "Phần còn lại để các cột vận chuyển cộng đúng bằng Phí vận chuyển của người bán. Thường là khoản sàn trợ thêm hoặc thu thêm mà bản kê chưa đặt tên riêng; bằng 0 ở hầu hết đơn." },
  // API: shipping_cost_amount
  { key: "shippingCost", label: "Phí vận chuyển của người bán", group: "ship", always: true, hint: "Số ship shop thực chịu sau khi trừ phần khách trả và phần sàn trợ. Lấy đúng số sàn báo." },
  // ---- Phí ----
  // API: platform_commission_amount
  { key: "feeCommission", label: "Phí hoa hồng của TikTok Shop", group: "fee", always: true, hint: "Tính theo tỷ lệ của ngành hàng trên giá sau giảm giá của người bán." },
  // API: transaction_fee_amount (sàn chỉ trả số sau khi trừ phần GMV Max tiết kiệm)
  { key: "feeTransaction", label: "Phí giao dịch", group: "fee", always: true, hint: "Phí xử lý thanh toán tính trên số tiền khách trả. Sàn chỉ báo số sau khi đã trừ phần tiết kiệm nhờ GMV Max, nên không tách được dòng “trước khi giảm”." },
  // API: vn_fix_infrastructure_fee
  { key: "feeOrderProcessing", label: "Phí xử lý đơn hàng", group: "fee", always: true, hint: "Khoản cố định cho mỗi đơn giao thành công (3.000đ, áp dụng từ 27/10/2025)." },
  // API: sfp_service_fee_amount
  { key: "feeSfp", label: "Phí dịch vụ Freeship Xtra", group: "fee", hint: "Phí tham gia chương trình Freeship Xtra." },
  // API: voucher_xtra_service_fee_amount
  { key: "feeVoucherXtra", label: "Phí dịch vụ Voucher Xtra", group: "fee", hint: "Phí tham gia chương trình Voucher Xtra." },
  // API: flash_sales_service_fee_amount
  { key: "feeFlashSale", label: "Phí dịch vụ Flash Sale", group: "fee", hint: "Phí tham gia Flash Sale." },
  // API: affiliate_commission_amount_before_pit (ưu tiên) / affiliate_commission_amount
  { key: "feeAffiliate", label: "Hoa hồng liên kết", group: "fee", hint: "Hoa hồng trả cho nhà sáng tạo (affiliate), tính trước thuế thu nhập cá nhân của họ." },
  // API: affiliate_ads_commission_amount
  { key: "feeAffiliateAds", label: "Hoa hồng liên kết Quảng cáo cửa hàng", group: "fee", hint: "Hoa hồng cho đơn đến từ quảng cáo cửa hàng gắn với nhà sáng tạo." },
  // API: affiliate_partner_commission_amount
  { key: "feeAffiliatePartner", label: "Hoa hồng của đối tác liên kết", group: "fee", hint: "Hoa hồng trả cho đối tác liên kết (đơn vị quản lý nhà sáng tạo)." },
  // API: tap_shop_ads_commission (cột riêng từ 31/10/2026)
  { key: "feeAffiliatePartnerAds", label: "Hoa hồng quảng cáo cửa hàng của Đối tác liên kết", group: "fee", hint: "Hoa hồng quảng cáo cửa hàng trả cho đối tác liên kết. Bản kê đồng bộ trước tháng 11/2026 còn gộp khoản này vào Phí khác." },
  // API: gmv_max_ad_fee_amount + gmv_max_coupon_fee
  { key: "feeGmvMax", label: "Chi phí GMV Max trừ trong đơn", group: "fee", hint: "Tiền quảng cáo GMV Max và voucher GMV Max mà sàn trừ thẳng vào đơn, không qua ví quảng cáo." },
  // API: gmv_max_coupon_fee (cột con, không cộng thêm)
  { key: "feeGmvMaxVoucher", label: "Trong đó: Voucher GMV Max", group: "fee", hint: "Phần voucher GMV Max đã nằm trong Chi phí GMV Max, tách ra để đối chiếu với dòng cùng tên trên Seller Center." },
  // API: bonus_cashback_service_fee_amount
  { key: "feeBonusCashback", label: "Phí dịch vụ Bonus Cashback", group: "fee", hint: "Phí tham gia chương trình Bonus Cashback, khoảng 1,5% doanh thu sau giảm giá." },
  // API: shipping_fee_guarantee_service_fee
  { key: "feeShipGuarantee", label: "Phí Bảo đảm phí vận chuyển", group: "fee", hint: "Khoản cố định mỗi đơn (1.620đ) của chương trình Bảo đảm phí vận chuyển." },
  // Chốt chặn = fee_tax_amount − Σ cột phí đã đặt tên − thuế
  { key: "feeOther", label: "Phí khác", group: "fee", hint: "Các khoản phí sàn trừ mà bản kê chưa đặt tên riêng, gom vào đây để tổng phí luôn đúng bằng số sàn báo. Đơn “sàn ước tính”: sàn báo tổng phí tạm cao hơn phần tách được, phần chênh nằm ở đây và biến mất khi quyết toán. Bản kê đồng bộ trước 29/10/2026 còn gộp Bonus Cashback và Bảo đảm phí vận chuyển; trước tháng 11/2026 còn gộp Hoa hồng quảng cáo cửa hàng của Đối tác liên kết." },
  // ---- Thuế ----
  // API: local_vat_amount / vat_amount
  { key: "taxVat", label: "Thuế GTGT do TikTok Shop khấu trừ", group: "tax", always: true, hint: "1% doanh thu, sàn nộp thay hộ kinh doanh và cá nhân theo Nghị định 117/2025." },
  // API: pit_amount (bản ước tính 202507 không có)
  { key: "taxPit", label: "Thuế TNCN do TikTok Shop khấu trừ", group: "tax", always: true, hint: "0,5% doanh thu, sàn nộp thay. Đơn “sàn ước tính” chưa có số này; phần đó nằm trong Phí khác cho tới khi quyết toán." },
  { key: "taxOther", label: "Thuế khác", group: "tax", hint: "Các loại thuế khác (không áp dụng ở Việt Nam), giữ để tổng luôn đúng." },
  // ---- Điều chỉnh & kết quả ----
  // API: adjustment_amount của các dòng gắn đơn
  { key: "adjustmentAmount", label: "Khoản điều chỉnh", group: "result", hint: "Khoản sàn điều chỉnh thêm cho đơn (phạt, bồi thường, chênh phí ship…). Loại điều chỉnh ghi ở dòng nhỏ bên dưới." },
  // API: settlement_amount
  { key: "settlementAmount", label: "Tổng số tiền quyết toán", group: "result", always: true, hint: "Tiền TikTok trả về ví cho đơn này. Đơn chưa quyết toán là số sàn ước tính." },
  { key: "costSnapshot", label: "Giá vốn sản phẩm", group: "result", always: true },
  { key: "profit", label: "LỢI NHUẬN THỰC TẾ", group: "result", always: true, hint: "Tổng số tiền quyết toán trừ Giá vốn sản phẩm." },
];

