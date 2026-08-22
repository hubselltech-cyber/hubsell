/**
 * PREFETCH KHI HOVER LINK SIDEBAR — Tầng 1 kế hoạch UI đẳng cấp.
 *
 * Rê chuột lên một mục menu là nạp sẵn dữ liệu MẶC ĐỊNH của trang đó vào cache
 * React Query; bấm vào là số hiện tức thì thay vì "Đang tải dữ liệu…".
 *
 * Nguyên tắc sống còn: bộ (queryKey, tham số) ở đây phải sinh ra GIỐNG HỆT
 * state khởi tạo của trang đích (trang 1, bộ lọc mặc định) — key lệch một
 * trường là prefetch thành công mà trang vẫn tải lại từ đầu. Vì vậy key luôn
 * build qua lib/query-keys.ts và tham số chép đúng giá trị khởi tạo của trang.
 *
 * An toàn quyền: handler chỉ gắn lên các Link ĐÃ qua lọc quyền của sidebar,
 * nên không bao giờ prefetch trang người dùng không thấy; lỡ backend vẫn trả
 * 403 thì prefetchQuery nuốt lỗi — không toast, không đổi UI.
 */

import type { QueryClient } from "@tanstack/react-query";

import {
  channelFilterToQuery,
  fetchAnalytics,
  fetchChannels,
  fetchDashboardSummary,
  fetchFinanceAnalytics,
  fetchMySubscription,
  fetchOrders,
  fetchProducts,
  fetchRealizedPnl,
  fetchWarehouseReturns,
  type ChannelFilterQuery,
} from "./api";
import {
  defaultRange,
  previousRange,
  RANGE_PRESETS,
  rangeToQuery,
} from "./date-range";
import { qk } from "./query-keys";

/** "Tất cả sàn" — cùng hình dạng ALL_CHANNELS của ChannelFilter. */
const ALL: ChannelFilterQuery = { channelName: "", channelId: "" };

/** Danh sách gian hàng nuôi ChannelFilter — trang báo cáo nào cũng cần. */
function prefetchChannels(qc: QueryClient) {
  qc.prefetchQuery({
    queryKey: qk.channels(),
    queryFn: fetchChannels,
    staleTime: 5 * 60_000, // khớp staleTime trong ChannelFilter
  });
}

const PREFETCHERS: Record<string, (qc: QueryClient) => void> = {
  "/": (qc) => {
    // Dashboard mở mặc định khoảng HÔM NAY (xem app/page.tsx)
    const today = RANGE_PRESETS.find((p) => p.key === "today")!.resolve();
    qc.prefetchQuery({
      queryKey: qk.dashboardSummary(),
      queryFn: fetchDashboardSummary,
    });
    qc.prefetchQuery({
      queryKey: qk.analytics(today, ALL),
      queryFn: () => fetchAnalytics(today, ALL),
    });
    prefetchChannels(qc);
  },

  "/orders": (qc) => {
    const params = { page: 1, pageSize: 20, channel: ALL };
    qc.prefetchQuery({
      queryKey: qk.orders({ ...params, channel: channelFilterToQuery(ALL) }),
      queryFn: () => fetchOrders(params),
    });
    prefetchChannels(qc);
  },

  "/finance/analytics": (qc) => {
    const range = defaultRange();
    qc.prefetchQuery({
      queryKey: qk.financeAnalytics(range, ALL),
      queryFn: () => fetchFinanceAnalytics(range, ALL),
    });
    qc.prefetchQuery({
      queryKey: qk.financeAnalytics(previousRange(range), ALL),
      queryFn: () =>
        fetchFinanceAnalytics(previousRange(range), ALL).catch(() => null),
    });
    prefetchChannels(qc);
  },

  "/finance/realized-pnl": (qc) => {
    const range = defaultRange();
    qc.prefetchQuery({
      queryKey: qk.realizedPnl({
        ...rangeToQuery(range),
        platform: "ALL",
        status: "all",
        lossOnly: false,
        search: "",
        page: 1,
        pageSize: 20,
      }),
      queryFn: () =>
        fetchRealizedPnl({
          range,
          status: "all",
          lossOnly: false,
          search: "",
          page: 1,
          pageSize: 20,
        }),
    });
  },

  "/products": (qc) => {
    // PAGE_SIZE = 10 của hub Hàng hóa (app/products/page.tsx)
    qc.prefetchQuery({
      queryKey: qk.products({ page: 1, pageSize: 10, search: "" }),
      queryFn: () => fetchProducts({ page: 1, pageSize: 10, search: "" }),
    });
  },

  "/settings/plan": (qc) => {
    // Cùng key với banner trần gói trong AppShell — thường đã ấm sẵn cache.
    qc.prefetchQuery({
      queryKey: qk.mySubscription(),
      queryFn: fetchMySubscription,
      staleTime: 60_000,
    });
  },

  "/warehouse/returns": (qc) => {
    const params = { channel: ALL, page: 1, pageSize: 20 };
    qc.prefetchQuery({
      queryKey: qk.warehouseReturns({
        status: undefined,
        search: undefined,
        channel: channelFilterToQuery(ALL),
        page: 1,
        pageSize: 20,
      }),
      queryFn: () => fetchWarehouseReturns(params),
    });
    prefetchChannels(qc);
  },
};

/**
 * Gọi từ onMouseEnter/onFocus của Link sidebar. Trang chưa có prefetcher thì
 * lặng lẽ bỏ qua; staleTime mặc định 30s tự chặn việc rê chuột nhiều lần bắn
 * request lặp.
 */
export function prefetchRoute(qc: QueryClient, href: string) {
  PREFETCHERS[href]?.(qc);
}
