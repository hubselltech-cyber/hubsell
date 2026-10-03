import { api } from "./client";
import type {
  AnalyticsResponse,
  CashFlowResponse,
  OverviewAnalytics,
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

/**
 * TỔNG QUAN — đúng endpoint của Tổng quan web (frontend fetchAnalytics →
 * /api/analytics): doanh thu, số đơn phát sinh, lợi nhuận dự kiến, kỳ trước,
 * trend 14 ngày, đơn theo gian. Backend đòi shop đã có gian hàng (409 nếu chưa).
 */
export function fetchOverview(from: string, to: string, channelName?: string) {
  return api<OverviewAnalytics>(`/api/analytics?${reportQuery(from, to, channelName)}`);
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
