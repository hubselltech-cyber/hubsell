import type { OverviewAnalytics } from "../types/api";
import type { WaterfallStep } from "../components/WaterfallChart";

// ============================================================
// HAI KHỐI VẼ của màn Tài chính đọc /api/analytics: vòng CƠ CẤU CHI PHÍ và thác nước
// BÓC TÁCH DÒNG TIỀN — cùng nhãn, cùng công thức với Tổng quan web
// (frontend/src/app/page.tsx CostStructure + PnlBreakdown). Hàm THUẦN, tách khỏi
// FinancePage.tsx 26/11/2026 để có test giữ hai đẳng thức:
//   · Σ lát cơ cấu chi phí = totalPlatformFee + totalCost + totalOperatingExpense;
//   · Tổng giá trị SP − Σ bậc thác = Lãi ròng backend trả.
//
// THẤT THU HÀNG MẤT/HỎNG (anh Trung 26/11/2026: "Trong tài chính cần in thêm chi phí thất
// thu hàng hỏng") = giá vốn hàng hoàn kho đã báo hỏng, ghi theo NGÀY KHO BÁO HỎNG. Backend
// trả `damagedLoss` (cả dòng) + `damagedLossInCost` (phần đã nằm trong totalCost); phần còn
// lại (damagedLoss − damagedLossInCost, ÂM được khi đơn tạo trong kỳ nhưng báo hỏng ở kỳ
// khác) backend đã gộp vào totalOperatingExpense cho bản app cũ. Bản này vẽ thành lát /
// bậc RIÊNG nên phải gỡ nó khỏi Giá vốn và Vận hành — tổng không đổi một đồng.
// ============================================================

function adsOf(a: OverviewAnalytics): number {
  return (a.expensesByCategory ?? [])
    .filter((e) => e.category === "ADS")
    .reduce((sum, e) => sum + e.amount, 0);
}

export const DAMAGED_LOSS_LABEL = "Thất thu hàng mất/hỏng";

/**
 * Cơ cấu chi phí — 13 khoản ĐÚNG nhãn + màu của CostStructure trên Tổng quan web: 8 bucket
 * sàn khấu trừ (platformFeeBreakdown) + giá vốn + Ads + 2 nhóm vận hành + thất thu hàng
 * mất/hỏng. Khoản 0 đồng tự ẩn.
 */
export function costSegments(a: OverviewAnalytics) {
  const fee = a.platformFeeBreakdown;
  const damagedLoss = a.damagedLoss ?? 0;
  const damagedInCost = a.damagedLossInCost ?? 0;
  return [
    { key: "service", label: "Phí nền tảng (CĐ, thanh toán, dịch vụ)", amount: fee?.service ?? 0, color: "#f97316" },
    { key: "affiliate", label: "Phí tiếp thị liên kết", amount: fee?.affiliate ?? 0, color: "#f59e0b" },
    { key: "tax", label: "Thuế sàn TMĐT (GTGT + TNCN)", amount: fee?.tax ?? 0, color: "#ef4444" },
    { key: "refund", label: "Tiền hoàn trả khách", amount: fee?.refund ?? 0, color: "#f43f5e" },
    { key: "voucher", label: "Voucher & xu của shop", amount: fee?.voucher ?? 0, color: "#ec4899" },
    { key: "shippingDiff", label: "Chênh lệch phí vận chuyển", amount: fee?.shippingDiff ?? 0, color: "#14b8a6" },
    { key: "adWallet", label: "Nạp ví quảng cáo sàn", amount: fee?.adWallet ?? 0, color: "#6366f1" },
    { key: "feeOther", label: "Khấu trừ khác của sàn", amount: fee?.other ?? 0, color: "#94a3b8" },
    { key: "cogs", label: "Giá vốn hàng bán (COGS)", amount: (a.totalCost ?? 0) - damagedInCost, color: "#3b82f6" },
    { key: "ads", label: "Chi phí quảng cáo", amount: adsOf(a), color: "#8b5cf6" },
    { key: "varops", label: "Chi phí Biến đổi Vận hành", amount: a.operatingVariableExpense ?? 0, color: "#10b981" },
    { key: "fixops", label: "Chi phí Cố định Vận hành", amount: a.operatingFixedExpense ?? 0, color: "#a16207" },
    { key: "damaged", label: DAMAGED_LOSS_LABEL, amount: damagedLoss, color: "#be123c" },
  ].filter((s) => s.amount !== 0);
}

/** Các bậc thác nước — đúng thứ tự + công thức của PnlBreakdown web. */
export function waterfallSteps(a: OverviewAnalytics): WaterfallStep[] {
  const adsExpense = adsOf(a);
  const damagedLoss = a.damagedLoss ?? 0;
  const damagedInCost = a.damagedLossInCost ?? 0;
  const operatingExpense = (a.totalOperatingExpense ?? 0) - adsExpense - (damagedLoss - damagedInCost);
  const fee = a.totalPlatformFee ?? 0;
  const tax = a.totalPlatformTax ?? 0;
  // KHUYẾN MÃI = voucher shop tự bỏ (platformFeeBreakdown.voucher) tách thành bậc
  // riêng ngay sau cột giá trị SP để khách thấy tiền TRƯỚC / SAU khuyến mãi (góp ý
  // khách 22/10, anh chốt 23/10 tối); Chi phí sàn bỏ phần này ra khỏi để không trừ đôi.
  const promo = a.platformFeeBreakdown?.voucher ?? 0;
  return [
    { key: "promo", short: "Khuyến mãi", amount: promo, hue: "rose" },
    { key: "cogs", short: "Giá vốn", amount: (a.totalCost ?? 0) - damagedInCost, hue: "rose" },
    { key: "fee", short: "Chi phí", amount: fee - tax - promo, hue: "rose" },
    { key: "tax", short: "Thuế sàn", amount: tax, hue: "rose" },
    { key: "ads", short: "Ads", amount: adsExpense, hue: "amber" },
    { key: "ops", short: "Vận hành", amount: operatingExpense, hue: "amber" },
    // Bậc riêng ngay sau Vận hành, như web. amount 0 thì chart tự bỏ bậc (đa số shop
    // không có đơn báo hỏng trong kỳ).
    { key: "damaged", short: "Thất thu", amount: damagedLoss, hue: "amber" },
    // Đơn chưa có giá vốn tính như giá vốn 0 (anh chốt 02/11/2026, áp 04/11): bỏ bậc
    // "Thiếu vốn" (30/09 → 04/11) — backend trả excludedProfit = 0 nên bản cũ chưa OTA
    // cũng tự đóng thác (WaterfallChart bỏ bậc 0); số đơn thiếu nhắc ở thẻ Lợi nhuận.
    // Thu vận hành khác = bậc CỘNG (amount âm → chart vẽ "+" xanh); thuế bổ sung
    // dự phòng = bậc trừ cuối — y web, để Lãi ròng dưới thác = thẻ Lợi nhuận
    // (26/10/2026). amount 0 thì chart tự bỏ bậc.
    { key: "income", short: "Thu khác", amount: -(a.operatingIncome ?? 0), hue: "amber" },
    { key: "provisionTax", short: "Thuế DP", amount: a.additionalTax ?? 0, hue: "amber" },
  ];
}
