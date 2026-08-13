import { api } from "./client";
import type {
  LookupResponse,
  OrdersListResponse,
  OrderStatsResponse,
  ReceiveReturnResponse,
  OrderDto,
} from "../types/api";

export interface OrdersFilter {
  search?: string;
  shippingStatus?: string;
  /** Lọc theo sàn — channelScope backend tự đọc, số đếm tab cũng lọc theo. */
  channelName?: string;
  /** Lọc đích danh MỘT gian hàng — thắng channelName khi có cả hai. */
  channelId?: string;
  /** Hãng vận chuyển (SPX/GHTK/…). */
  carrier?: string;
}

function filterParams(params: OrdersFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.shippingStatus) q.set("shippingStatus", params.shippingStatus);
  if (params.channelName) q.set("channelName", params.channelName);
  if (params.channelId) q.set("channelId", params.channelId);
  if (params.carrier) q.set("carrier", params.carrier);
  return q;
}

export function fetchOrders(params: OrdersFilter & { page?: number; pageSize?: number }) {
  const q = filterParams(params);
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  return api<OrdersListResponse>(`/api/orders?${q.toString()}`);
}

/** Thống kê SP/SKU bán ra — cùng phạm vi lọc với danh sách, mặc định 30 ngày. */
export function fetchOrderStats(params: OrdersFilter & { days?: number }) {
  const q = filterParams(params);
  q.set("days", String(params.days ?? 30));
  return api<OrderStatsResponse>(`/api/orders/stats?${q.toString()}`);
}

/**
 * Tra mã vận đơn/mã đơn từ máy quét. Backend TỰ CHỮA LÀNH: trượt thì đồng bộ
 * nhanh với sàn rồi tra lại — nên lượt gọi này có thể mất vài giây, UI phải
 * có trạng thái chờ. 409 = mã khớp nhiều đơn (body kèm candidates).
 */
export function lookupOrder(code: string) {
  return api<LookupResponse>(
    `/api/orders/lookup?code=${encodeURIComponent(code)}`
  );
}

/**
 * CÔNG ĐOẠN 1 của luồng hoàn 2 bước: đánh dấu ĐÃ NHẬN hàng về tay.
 * KHÔNG cộng tồn kho — nhập kho là nút bulk trên web (chốt thiết kế 13/08).
 */
export function receiveReturn(orderId: string) {
  return api<ReceiveReturnResponse>(
    `/api/warehouse/returns/${orderId}/receive`,
    { method: "POST" }
  );
}

/** Đánh dấu kiện hoàn HƯ HỎNG/MẤT — không cộng kho, chuyển sang chờ khiếu nại. */
export function markDamaged(orderId: string, note?: string) {
  return api<{ order: OrderDto }>(`/api/orders/${orderId}/return`, {
    method: "POST",
    body: { condition: "DAMAGED", ...(note?.trim() ? { note: note.trim() } : {}) },
  });
}
