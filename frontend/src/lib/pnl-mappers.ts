/**
 * MAPPER LÃI/LỖ THỰC HIỆN THEO SÀN
 *
 * Ánh xạ "detail row" giàu trường (PnlDetailRow) sang cấu trúc CỘT ĐẶC THÙ của
 * từng sàn. Trường nào Hubsell CHƯA có dữ liệu thật (Shopee đọc từ file quyết
 * toán/Salework) thì để 0 và ghi chú "giữ chỗ" — dựng đủ khung cột trước, cắm số
 * thật sau khi luồng đồng bộ hoàn tất. Mọi khoản phí là magnitude dương.
 */

import type { PnlDetailRow } from "@/lib/api";

// ───────────────────────── SHOPEE ─────────────────────────

export interface ShopeeProfitRow {
  base: PnlDetailRow;
  // Doanh thu & trợ giá
  revenueGross: number;
  shopeeSubsidy: number; // Trợ giá Shopee
  // Phí vận chuyển
  shipQuoted: number; // Phí VC Dự kiến
  shipActual: number; // Phí VC Thực tế
  shipSubsidyShopee: number; // Trợ giá VC Shopee — giữ chỗ
  shipSubsidyShop: number; // Trợ giá VC Shop — giữ chỗ
  buyerPaidShip: number; // Người mua trả — giữ chỗ
  shipDiff: number; // Chênh lệch phí vận chuyển
  // Phí sàn & thuế (âm)
  feePlatform: number; // Phí sàn (cố định + thanh toán)
  feeAffiliate: number; // Phí TTLK (Affiliate)
  feePiship: number; // PiShip (Freeship/Voucher Xtra)
  adWallet: number; // Nạp ví quảng cáo — giữ chỗ
  sellerSubsidy: number; // Trợ giá người bán
  tax: number; // Thuế — giữ chỗ
  // Hiệu quả kinh doanh
  estRevenue: number; // Doanh thu ước tính
  revenueFromShopee: number; // Doanh thu từ Shopee
  costSnapshot: number; // Chi phí giá vốn
  profit: number; // Doanh thu từ Shopee − Giá vốn
}

export function toShopeeRow(r: PnlDetailRow): ShopeeProfitRow {
  // Doanh thu từ Shopee: ưu tiên số thực nhận về ví; chưa có thì lấy doanh thu
  // ròng sau phí sàn.
  const revenueFromShopee = r.actualPayout > 0 ? r.actualPayout : r.netRevenue;
  return {
    base: r,
    revenueGross: r.revenueGross,
    shopeeSubsidy: r.platformSubsidy,
    shipQuoted: r.shippingFeeQuoted,
    shipActual: r.shippingFeeActual,
    shipSubsidyShopee: 0,
    shipSubsidyShop: 0,
    buyerPaidShip: 0,
    shipDiff: r.shippingFeeDiff,
    feePlatform: r.feeFixedPayment,
    feeAffiliate: r.feeAffiliate,
    feePiship: r.feeService,
    adWallet: 0,
    sellerSubsidy: r.sellerVoucher,
    tax: 0,
    estRevenue: r.netRevenue,
    revenueFromShopee,
    costSnapshot: r.costSnapshot,
    profit: revenueFromShopee - r.costSnapshot,
  };
}

// ───────────────────────── TIKTOK SHOP ─────────────────────────

export interface TiktokProfitRow {
  base: PnlDetailRow;
  // Doanh thu & giảm giá
  revenueGross: number; // Tổng giá trị sản phẩm (giá gốc)
  platformDiscount: number; // Chiết khấu của sàn (sàn tài trợ)
  sellerDiscount: number; // Chiết khấu của người bán (âm)
  revenueAfterDiscount: number; // Tổng giá trị SP sau chiết khấu
  // Phí vận chuyển
  shipBeforeDiscount: number; // PVC trước chiết khấu
  shipDiscountPlatform: number; // Chiết khấu PVC bởi sàn — giữ chỗ
  shipDiscountSeller: number; // Chiết khấu PVC bởi người bán — giữ chỗ
  shipAfterDiscount: number; // PVC sau chiết khấu
  shipActual: number; // PVC thực tế
  shipDiff: number; // Chênh lệch PVC (âm)
  // Phí & thuế TikTok (âm)
  feeFixedTransaction: number; // Phí cố định & Giao dịch
  feeServiceSfpXtra: number; // Phí dịch vụ SFP & Voucher Xtra
  feeFlashSale: number; // Phí Flash Sale — giữ chỗ
  feeAffiliate: number; // Phí Tiếp thị liên kết
  feeOrderProcessingSfr: number; // Phí xử lý đơn hàng & SFR — giữ chỗ
  taxVat: number; // Thuế & VAT — giữ chỗ
  // Hiệu quả kinh doanh
  estRevenue: number; // Doanh thu ước tính
  costSnapshot: number; // Chi phí giá vốn
  profit: number; // Doanh thu ước tính − Giá vốn
}

export function toTiktokRow(r: PnlDetailRow): TiktokProfitRow {
  return {
    base: r,
    revenueGross: r.revenueGross,
    platformDiscount: r.platformSubsidy,
    sellerDiscount: r.sellerVoucher,
    revenueAfterDiscount: r.revenueGross - r.platformSubsidy - r.sellerVoucher,
    shipBeforeDiscount: r.shippingFeeQuoted,
    shipDiscountPlatform: 0,
    shipDiscountSeller: 0,
    shipAfterDiscount: r.shippingFeeQuoted,
    shipActual: r.shippingFeeActual,
    shipDiff: r.shippingFeeDiff,
    feeFixedTransaction: r.feeFixedPayment,
    feeServiceSfpXtra: r.feeService,
    feeFlashSale: 0,
    feeAffiliate: r.feeAffiliate,
    feeOrderProcessingSfr: 0,
    taxVat: 0,
    estRevenue: r.netRevenue,
    costSnapshot: r.costSnapshot,
    profit: r.netRevenue - r.costSnapshot,
  };
}
