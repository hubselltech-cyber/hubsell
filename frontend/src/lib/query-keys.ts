/**
 * QUERY KEY TẬP TRUNG — nguồn chân lý duy nhất cho tên cache React Query.
 *
 * Vì sao phải tập trung: prefetch khi hover sidebar (lib/prefetch.ts) và trang
 * đích PHẢI sinh ra key giống hệt nhau thì cache mới trúng; mỗi nơi tự bịa key
 * là prefetch thành công mà trang vẫn tải lại từ đầu. Mọi tham số Date/object
 * đều được ép về chuỗi/plain object ổn định trước khi vào key.
 */

import {
  channelFilterToQuery,
  type ChannelFilterQuery,
} from "./api";
import { rangeToQuery, type DateRange } from "./date-range";

export const qk = {
  // ----- Dùng chung -----
  channels: () => ["channels"] as const,
  mySubscription: () => ["my-subscription"] as const,

  // ----- Tổng quan -----
  dashboardSummary: () => ["dashboard-summary"] as const,
  analytics: (range?: DateRange, channel?: ChannelFilterQuery) =>
    ["analytics", rangeToQuery(range), channelFilterToQuery(channel)] as const,

  // ----- Đơn hàng -----
  orders: (params: Record<string, unknown>) => ["orders", params] as const,

  // ----- Tài chính -----
  financeAnalytics: (range?: DateRange, channel?: ChannelFilterQuery) =>
    [
      "finance-analytics",
      rangeToQuery(range),
      channelFilterToQuery(channel),
    ] as const,
  realizedPnl: (params: Record<string, unknown>) =>
    ["realized-pnl", params] as const,
  feeAudit: (params: Record<string, unknown>) => ["fee-audit", params] as const,
  /** Rổ #1 Kiểm toán phí sàn + trang Đối soát phí ship của kho dùng chung. */
  shippingDiscrepancies: (params: Record<string, unknown>) =>
    ["shipping-discrepancies", params] as const,
  cashFlow: () => ["cash-flow"] as const,
  expenses: (range?: DateRange) => ["expenses", rangeToQuery(range)] as const,

  // ----- Kho -----
  products: (params: Record<string, unknown>) => ["products", params] as const,
  warehouseReturns: (params: Record<string, unknown>) =>
    ["warehouse-returns", params] as const,
};
