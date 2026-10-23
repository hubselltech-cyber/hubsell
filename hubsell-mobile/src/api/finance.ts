import { api } from "./client";
import type {
  AnalyticsResponse,
  CashFlowResponse,
  OverviewAnalytics,
  RealizedPnlResponse,
} from "../types/api";

/**
 * Phạm vi gian hàng của mọi API báo cáo (backend lib/channel-filter.ts):
 *   không có gì → mọi gian · channelName → cả sàn · channelId → đúng MỘT gian
 * (channelId thắng channelName khi có cả hai).
 */
export interface ReportScope {
  channelName?: string;
  channelId?: string;
}

/**
 * Mọi API báo cáo backend nhận cùng bộ lọc: ?from&to (yyyy-mm-dd, giờ VN)
 * + ?channelName=SHOPEE|LAZADA|TIKTOK + ?channelId=<gian>. Vẫn nhận chuỗi
 * sàn trần cho chỗ gọi cũ.
 */
function reportQuery(from: string, to: string, scope?: string | ReportScope): string {
  const q = new URLSearchParams({ from, to });
  const s: ReportScope = typeof scope === "string" ? { channelName: scope } : (scope ?? {});
  if (s.channelName) q.set("channelName", s.channelName);
  if (s.channelId) q.set("channelId", s.channelId);
  return q.toString();
}

/** Chỉ cần summary (thẻ chỉ số + biểu đồ) — lấy trang 1 nhỏ nhất cho nhẹ. */
export function fetchPnlSummary(from: string, to: string, scope?: string | ReportScope) {
  return api<RealizedPnlResponse>(
    `/api/finance/realized-pnl?page=1&pageSize=20&${reportQuery(from, to, scope)}`
  );
}

/**
 * TỔNG QUAN — đúng endpoint của Tổng quan web (frontend fetchAnalytics →
 * /api/analytics): doanh thu, số đơn phát sinh, lợi nhuận dự kiến, kỳ trước,
 * trend 14 ngày, đơn theo gian. Backend đòi shop đã có gian hàng (409 nếu chưa).
 */
export function fetchOverview(from: string, to: string, scope?: string | ReportScope) {
  return api<OverviewAnalytics>(`/api/analytics?${reportQuery(from, to, scope)}`);
}

/** Thác nước 4 cột: Giá trị SP → Khấu trừ sàn → Doanh thu → Chi phí → LN. */
export function fetchAnalytics(from: string, to: string, scope?: string | ReportScope) {
  return api<AnalyticsResponse>(
    `/api/finance/analytics?${reportQuery(from, to, scope)}`
  );
}

/** Vị trí thực của dòng tiền theo gian hàng (lũy kế, không lọc ngày). */
export function fetchCashFlow() {
  return api<CashFlowResponse>("/api/finance/cash-flow");
}
