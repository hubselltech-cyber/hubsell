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
 *   LN trước thuế = LN gộp − Phí sàn − Chi phí vận hành + Thu vận hành khác
 *   LN ròng       = LN trước thuế − Thuế bổ sung dự phòng(LN trước thuế)
 *
 * Đơn thiếu giá vốn tính như giá vốn 0 đ (anh Trung chốt 02/11/2026, áp
 * 04/11/2026 — lib/finance-definitions.ts summarizeMissingCost): LN gộp đã là
 * Doanh thu − Σ giá vốn (dòng thiếu góp 0 đ) nên KHÔNG còn bậc trừ "LN đơn
 * thiếu giá vốn" như 30/09 → 04/11.
 *
 * Thuế bổ sung tính trên LN TRƯỚC thuế (hoặc doanh thu, theo cấu hình shop) —
 * nhận qua callback để không lặp công thức vòng.
 */
export function netProfitAfterProvision(input: {
  grossProfit: number;
  platformFee: number;
  operatingExpense: number;
  operatingIncome: number;
  additionalTaxOf: (provisionalProfit: number) => number;
}): { provisionalProfit: number; additionalTax: number; netProfit: number } {
  const provisionalProfit =
    input.grossProfit - input.platformFee - input.operatingExpense + input.operatingIncome;
  const additionalTax = input.additionalTaxOf(provisionalProfit);
  return { provisionalProfit, additionalTax, netProfit: provisionalProfit - additionalTax };
}

/**
 * LỢI NHUẬN RÒNG của Báo cáo dòng tiền (08/11/2026) — một chỗ cho cả
 * /api/finance/analytics lẫn Tổng quan Lợi nhuận của trang Lãi/Lỗ (cầu nối
 * "Lãi đơn hàng → Lợi nhuận ròng"):
 *
 *   LN trước thuế = Σ lãi đơn tính doanh thu (đã quyết toán + chờ)
 *                   − Quảng cáo sàn − Chi phí vận hành nhập tay + Thu vận hành khác
 *   LN ròng       = LN trước thuế − Thuế bổ sung dự phòng(LN trước thuế)
 *
 * Khác netProfitAfterProvision (Tổng quan, đi từ LN gộp − phí sàn): ở đây lãi
 * đơn đã net phí/thuế sàn trong payout nên không trừ phí sàn lần nữa.
 */
export function cashFlowNetProfit(input: {
  /** Σ profitAfterTax của đơn tính doanh thu (settled + pending). */
  orderProfit: number;
  adsSpend: number;
  operatingExpense: number;
  operatingIncome: number;
  additionalTaxOf: (provisionalProfit: number) => number;
}): { provisionalProfit: number; additionalTax: number; netProfit: number } {
  const provisionalProfit =
    input.orderProfit - input.adsSpend - input.operatingExpense + input.operatingIncome;
  const additionalTax = input.additionalTaxOf(provisionalProfit);
  return { provisionalProfit, additionalTax, netProfit: provisionalProfit - additionalTax };
}
