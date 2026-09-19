// Định dạng số dùng chung cho các trang Quảng cáo TikTok (GMV Max).

/** ROI của TikTok = doanh thu ÷ chi phí quảng cáo (gồm cả đơn tự nhiên); null = chưa tiêu tiền. */
export function formatRoi(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

/**
 * Nơi chủ shop SỬA chiến dịch GMV Max (ROI mục tiêu, ngân sách, bật / tắt). Probe 19/09/2026: chiến dịch tạo từ Seller Center
 * KHÔNG sửa được qua Marketing API (40002 "Shop must belong to a Business Center account"; Ads Manager của tài khoản quảng
 * cáo cũng không liệt kê chúng) → Hubsell chỉ GỢI Ý con số, khách tự sửa ở đây. Mới là trang chủ Seller Center VN — chưa có
 * đường dẫn thẳng tới mục Quảng cáo cửa hàng; có thì thay ở MỘT chỗ này.
 */
export const TIKTOK_SELLER_CENTER_ADS_URL = "https://seller-vn.tiktok.com/";

/** Tỷ lệ sàn trả SẴN phần trăm dạng số trần (1.92 = 1,92%). */
export function formatPct(v: number): string {
  return `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
}
