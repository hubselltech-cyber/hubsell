/**
 * MAPPER PHÍ SHOPEE → BẢNG ĐỐI SOÁT LỢI NHUẬN
 *
 * Ánh xạ các trường phí thô từ API/webhook Shopee (income statement của đơn) vào
 * đúng các cột của "Bảng tổng hợp đối soát lợi nhuận đơn hàng". Gom về một chỗ để
 * khi Shopee đổi tên trường hay bổ sung loại phí, chỉ sửa đúng file này mà không
 * đụng tới route hay giao diện.
 *
 * QUY ƯỚC DẤU: mọi khoản phí/khấu trừ trả về là ĐỘ LỚN DƯƠNG (magnitude). Tầng
 * giao diện tự hiển thị dấu trừ. Công thức Lãi/Lỗ ở nơi dùng sẽ TRỪ các khoản
 * này khỏi doanh thu gốc.
 */

/**
 * Hình dạng dữ liệu phí thô của một đơn Shopee (một phần income statement).
 * Tất cả tùy chọn vì Shopee chỉ trả đủ trường khi đơn đã đối soát/giải ngân.
 */
export interface ShopeeOrderIncome {
  /** Tổng tiền hàng sau giảm giá trực tiếp trên sản phẩm, TRƯỚC voucher shop. */
  merchandise_subtotal?: number | string | null;
  /** Voucher do SHOP tự chịu (khách áp mã của riêng shop). */
  seller_voucher?: number | string | null;
  /** Phí hoa hồng cố định theo ngành hàng. */
  commission_fee?: number | string | null;
  /** Phí thanh toán/giao dịch (thường ~5%). */
  transaction_fee?: number | string | null;
  /** Phí gói dịch vụ: Freeship Xtra, Voucher Xtra, Shopee Live/Video… */
  service_fee?: number | string | null;
  /** Phí tham gia Flash Sale / Campaign lớn của sàn (nếu Shopee tách riêng). */
  campaign_fee?: number | string | null;
  /** Hoa hồng Tiếp thị liên kết của SHOP (Seller Affiliate). */
  seller_affiliate_program?: number | string | null;
  /** Hoa hồng liên kết của SÀN (fallback khi không có seller_affiliate_program). */
  affiliate_commission?: number | string | null;
  /** Phí vận chuyển sàn ước tính lúc đặt đơn. */
  estimated_shipping_fee?: number | string | null;
  /** Phí vận chuyển thực tế sau đối soát (ưu tiên hơn ước tính nếu có). */
  actual_shipping_fee?: number | string | null;
  /** Phí phạt chênh lệch cân nặng do ĐVVC quét lại. */
  weight_adjustment_fee?: number | string | null;
}

/**
 * Cấu trúc phí đã chuẩn hóa cho một dòng bảng đối soát. Tất cả là magnitude
 * dương; `revenueGross` là doanh thu gốc (không phải phí).
 */
export interface ReconciliationFees {
  /** Doanh thu gốc — giá bán sau giảm giá trực tiếp, chưa trừ voucher. */
  revenueGross: number;
  /** Voucher shop tự chịu. */
  sellerVoucher: number;
  /** Phí cố định ngành hàng + phí thanh toán/giao dịch. */
  fixedAndTransaction: number;
  /** Phí gói dịch vụ Xtra (Freeship/Voucher Xtra, Live/Video…). */
  serviceXtra: number;
  /** Phí tham gia chiến dịch/Flash Sale. */
  campaign: number;
  /** Phí tiếp thị liên kết (Affiliate). */
  affiliate: number;
  /** Phí ship shop chịu + bù cân nặng. */
  shipAndWeight: number;
}

/** Ép về số hữu hạn không âm (magnitude). Rỗng/không hợp lệ → 0. */
function mag(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/**
 * Ánh xạ phí thô Shopee → các cột bảng đối soát (đặc tả mục 4).
 *
 *   Doanh thu gốc      ← merchandise_subtotal
 *   Voucher Shop       ← seller_voucher
 *   Phí cố định & TT   ← commission_fee + transaction_fee
 *   Phí dịch vụ Xtra   ← service_fee
 *   Phí Chiến dịch     ← campaign_fee (Shopee tách riêng; mặc định 0)
 *   Phí Tiếp thị LK    ← seller_affiliate_program ?? affiliate_commission
 *   Phí ship & Bù cân  ← (actual|estimated)_shipping_fee + weight_adjustment_fee
 */
export function mapShopeeOrderFees(raw: ShopeeOrderIncome): ReconciliationFees {
  const shipping =
    raw.actual_shipping_fee != null
      ? mag(raw.actual_shipping_fee)
      : mag(raw.estimated_shipping_fee);

  return {
    revenueGross: mag(raw.merchandise_subtotal),
    sellerVoucher: mag(raw.seller_voucher),
    fixedAndTransaction: mag(raw.commission_fee) + mag(raw.transaction_fee),
    serviceXtra: mag(raw.service_fee),
    campaign: mag(raw.campaign_fee),
    affiliate:
      raw.seller_affiliate_program != null
        ? mag(raw.seller_affiliate_program)
        : mag(raw.affiliate_commission),
    shipAndWeight: shipping + mag(raw.weight_adjustment_fee),
  };
}

/**
 * Lãi/Lỗ thực tế từ bộ phí đã chuẩn hóa + giá vốn snapshot.
 * = Doanh thu gốc − Voucher − Phí cố định&TT − Xtra − Chiến dịch − Affiliate
 *   − Giá vốn − Ship&Bù cân.
 */
export function reconciliationProfit(
  fees: ReconciliationFees,
  costSnapshot: number
): number {
  return (
    fees.revenueGross -
    fees.sellerVoucher -
    fees.fixedAndTransaction -
    fees.serviceXtra -
    fees.campaign -
    fees.affiliate -
    costSnapshot -
    fees.shipAndWeight
  );
}
