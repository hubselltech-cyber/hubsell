import { api } from "./client";
import type {
  LookupResponse,
  OrdersListResponse,
  ReceiveReturnResponse,
  OrderDto,
} from "../types/api";

export function fetchOrders(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  shippingStatus?: string;
}) {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  if (params.search) q.set("search", params.search);
  if (params.shippingStatus) q.set("shippingStatus", params.shippingStatus);
  return api<OrdersListResponse>(`/api/orders?${q.toString()}`);
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
