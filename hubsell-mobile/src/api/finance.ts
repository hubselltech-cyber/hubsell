import { api } from "./client";
import type {
  AnalyticsResponse,
  CashFlowResponse,
  RealizedPnlResponse,
} from "../types/api";

/**
 * Mọi API báo cáo backend nhận cùng bộ lọc: ?from&to (yyyy-mm-dd, giờ VN)
 * + ?channelName=SHOPEE|LAZADA|TIKTOK (lọc CẤP SÀN — channel-filter.ts).
 */
function reportQuery(from: string, to: string, channelName?: string): string {
  const q = new URLSearchParams({ from, to });
  if (channelName) q.set("channelName", channelName);
  return q.toString();
}

/** Chỉ cần summary (thẻ chỉ số + biểu đồ) — lấy trang 1 nhỏ nhất cho nhẹ. */
export function fetchPnlSummary(from: string, to: string, channelName?: string) {
  return api<RealizedPnlResponse>(
    `/api/finance/realized-pnl?page=1&pageSize=20&${reportQuery(from, to, channelName)}`
  );
}

/** Thác nước 4 cột: Giá trị SP → Khấu trừ sàn → Doanh thu → Chi phí → LN. */
export function fetchAnalytics(from: string, to: string, channelName?: string) {
  return api<AnalyticsResponse>(
    `/api/finance/analytics?${reportQuery(from, to, channelName)}`
  );
}

/** Vị trí thực của dòng tiền theo gian hàng (lũy kế, không lọc ngày). */
export function fetchCashFlow() {
  return api<CashFlowResponse>("/api/finance/cash-flow");
}
