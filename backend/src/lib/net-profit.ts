/**
 * LỢI NHUẬN RÒNG — một đẳng thức cho cả hai báo cáo (26/10/2026).
 *
 * Tổng quan (/api/analytics, thác nước) và Báo cáo dòng tiền
 * (/api/finance/analytics, thẻ "Lợi nhuận ròng tạm tính") cùng đọc sổ cái đơn
 * nhưng từng tính lợi nhuận theo hai công thức khác nhau: bên dòng tiền có
 * cộng THU vận hành khác và trừ THUẾ BỔ SUNG dự phòng, bên Tổng quan không.
 * Mobile xếp hai khối đó cạnh nhau nên khách thấy hai số "lợi nhuận ròng"
 * khác nhau trên một màn. Hàm này giữ đẳng thức ở MỘT chỗ:
 *
 *   LN trước thuế = LN gộp − Phí sàn − Chi phí vận hành − LN đơn thiếu giá vốn
 *                   + Thu vận hành khác
 *   LN ròng       = LN trước thuế − Thuế bổ sung dự phòng(LN trước thuế)
 *
 * Thuế bổ sung tính trên LN TRƯỚC thuế (hoặc doanh thu, theo cấu hình shop) —
 * nhận qua callback để không lặp công thức vòng.
 */
export function netProfitAfterProvision(input: {
  grossProfit: number;
  platformFee: number;
  operatingExpense: number;
  excludedProfit: number;
  operatingIncome: number;
  additionalTaxOf: (provisionalProfit: number) => number;
}): { provisionalProfit: number; additionalTax: number; netProfit: number } {
  const provisionalProfit =
    input.grossProfit -
    input.platformFee -
    input.operatingExpense -
    input.excludedProfit +
    input.operatingIncome;
  const additionalTax = input.additionalTaxOf(provisionalProfit);
  return { provisionalProfit, additionalTax, netProfit: provisionalProfit - additionalTax };
}
