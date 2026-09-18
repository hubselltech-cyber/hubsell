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

  // ----- Quảng cáo TikTok (GMV Max) -----
  tiktokAds: (params: Record<string, unknown>) => ["tiktok-ads", params] as const,
  tiktokAdsVideos: (campaignRowId: string, from: string, to: string) =>
    ["tiktok-ads-videos", campaignRowId, from, to] as const,
  tiktokAdsOutsideVideos: (campaignRowId: string, from: string, to: string) =>
    ["tiktok-ads-videos-outside", campaignRowId, from, to] as const,
  tiktokVideoMeta: (ids: string[]) => ["tiktok-video-meta", ids.join(",")] as const,
  tiktokAdsAutoRule: (campaignRowId: string) => ["tiktok-ads-auto-rule", campaignRowId] as const,
  tiktokAdsBacktest: (campaignRowId: string) => ["tiktok-ads-backtest", campaignRowId] as const,
  tiktokProductBreakeven: (channelId: string) => ["tiktok-product-breakeven", channelId] as const,

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

  // ----- Sổ KOC -----
  kocSummary: (params: Record<string, unknown>) => ["koc-summary", params] as const,
  kocOrders: (params: Record<string, unknown>) => ["koc-orders", params] as const,
  kocPartners: (params: Record<string, unknown>) => ["koc-partners", params] as const,
  kocTopProducts: (params: Record<string, unknown>) =>
    ["koc-top-products", params] as const,
  kocSamples: (params: Record<string, unknown>) => ["koc-samples", params] as const,
  kocExpenses: () => ["koc-expenses"] as const,

  // ----- Kho -----
  products: (params: Record<string, unknown>) => ["products", params] as const,
  warehouseReturns: (params: Record<string, unknown>) =>
    ["warehouse-returns", params] as const,
};
