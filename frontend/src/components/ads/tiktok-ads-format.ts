// Định dạng số dùng chung cho các trang Quảng cáo TikTok (GMV Max).

/** ROI của TikTok = doanh thu ÷ chi phí quảng cáo (gồm cả đơn tự nhiên); null = chưa tiêu tiền. */
export function formatRoi(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

/** Tỷ lệ sàn trả SẴN phần trăm dạng số trần (1.92 = 1,92%). */
export function formatPct(v: number): string {
  return `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
}
