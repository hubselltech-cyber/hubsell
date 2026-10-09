// ============================================================
// "CHƯA THANH TOÁN" — số SÀN TỰ CÔNG BỐ cho tiền sẽ trả shop của mọi đơn sàn
// chưa chi (09/10/2026, anh Trung chốt thay cột "chờ đối soát" tính từ đơn).
//
// Hai hàm THUẦN bóc số từ payload sàn, để test không cần gọi API:
//   · Shopee get_income_overview: docs 10/2025 in ví dụ đặt total_income NGANG
//     HÀNG error/message, nhưng prod 09/10 trả trong `response` → đọc cả hai.
//     Shop VN (Local) chỉ có pending_amount + released_amount.
//   · TikTok /finance/202507/orders/unsettled: sum_est_settlement_amount là
//     CHUỖI số (docs: "estimated amount, subject to change before settlement").
// Không có số → null (bảng hiện "—"), KHÔNG lùi về 0.
// ============================================================

import type { ShopeeIncomeOverviewData } from "../integrations/shopee/client";
import type { TikTokUnsettledData } from "../integrations/tiktok/client";

function toMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** pending_amount của Shopee = ô "Chưa thanh toán" màn Doanh thu Seller Center. */
export function shopeePendingAmount(
  data: ShopeeIncomeOverviewData,
): number | null {
  const totals = data.response?.total_income ?? data.total_income;
  return toMoney(totals?.pending_amount);
}

/** Σ ước tính quyết toán của mọi giao dịch TikTok chưa quyết toán (đơn + điều chỉnh). */
export function tiktokUnsettledSum(data: TikTokUnsettledData): number | null {
  return toMoney(data.sum_est_settlement_amount);
}
