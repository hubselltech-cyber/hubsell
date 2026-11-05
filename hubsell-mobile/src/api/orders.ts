import { api } from "./client";
import type {
  LookupResponse,
  OrdersListResponse,
  PackingScanResponse,
  PickSummaryResponse,
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
  /** Chỉ đơn KHÁCH ĐANG XIN HỦY (cờ cancelRequestedAt, 23/10/2026) — chuông dẫn vào đây. */
  cancelRequested?: boolean;
  /**
   * Bộ lọc con của Đã xử lý: "no" = chưa in phiếu, "yes" = đã in CHƯA đóng gói (Chờ đóng
   * gói), "packed" = đã quét đóng gói. Backend KHÔNG tự kèm trạng thái — gửi printed mà
   * thiếu shippingStatus=PROCESSED là dính cả đơn Đang giao / Đã giao cũ.
   */
  printed?: "yes" | "no" | "packed";
}

function filterParams(params: OrdersFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.shippingStatus) q.set("shippingStatus", params.shippingStatus);
  if (params.channelName) q.set("channelName", params.channelName);
  if (params.channelId) q.set("channelId", params.channelId);
  if (params.carrier) q.set("carrier", params.carrier);
  if (params.cancelRequested) q.set("cancelRequested", "1");
  if (params.printed) q.set("printed", params.printed);
  return q;
}

export function fetchOrders(params: OrdersFilter & { page?: number; pageSize?: number }) {
  const q = filterParams(params);
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  return api<OrdersListResponse>(`/api/orders?${q.toString()}`);
}

/**
 * PHIẾU NHẶT HÀNG (05/11/2026, tên cũ "Thống kê bốc hàng"): số lượng cần lấy theo SKU /
 * sản phẩm của nhóm CHỜ ĐÓNG GÓI (Đã xử lý, đã in phiếu, chưa quét đóng gói), trong
 * phạm vi sàn / gian / hãng / từ khóa đang lọc. Cùng route với popup của web nên hai
 * nơi một số; trả ĐỦ mọi SKU (route cũ /api/orders/stats cắt top 50 — thiếu dòng là
 * kho nhặt thiếu). Trạng thái + printed bị ĐÈ ở đây, không lấy từ bộ lọc đang xem.
 */
export function fetchPickSummary(params: OrdersFilter) {
  const q = filterParams({ ...params, shippingStatus: "PROCESSED", printed: "yes" });
  return api<PickSummaryResponse>(`/api/orders/pick-summary?${q.toString()}`);
}

/**
 * QUÉT ĐÓNG GÓI: bắn một kiện đã gói → máy chủ ghi "Đã đóng gói" hoặc chặn (đơn đã
 * hủy…). Không hỏi sàn nên trả lời nhanh. 404 = không thấy đơn, 409 = mã khớp nhiều đơn
 * (ApiError); lỗi mạng ném ApiError status 0.
 */
export function scanPacking(code: string) {
  return api<PackingScanResponse>("/api/orders/packing/scan", {
    method: "POST",
    body: { code },
  });
}

/**
 * Tra mã vận đơn/mã đơn từ máy quét. Backend TỰ CHỮA LÀNH: trượt thì đồng bộ
 * nhanh với sàn rồi tra lại — nên lượt gọi này có thể mất vài giây, UI phải
 * có trạng thái chờ. 409 = mã khớp nhiều đơn (body kèm candidates).
 */
export function lookupOrder(code: string, opts: { detail?: boolean } = {}) {
  // detail = xin kèm khối thông tin thanh toán của đơn (nút QR "Chi tiết đơn hàng").
  return api<LookupResponse>(
    `/api/orders/lookup?code=${encodeURIComponent(code)}${opts.detail ? "&detail=1" : ""}`
  );
}

/**
 * CÔNG ĐOẠN 1 của luồng hoàn 2 bước: đánh dấu ĐÃ NHẬN hàng về tay.
 * KHÔNG cộng tồn kho — nhập kho là nút bulk trên web (chốt thiết kế 13/08).
 */
/** Kết quả trả lời sàn về yêu cầu hủy (backend services/cancel-request-decide.ts). */
export interface CancelDecideResult {
  orderCode: string;
  accepted: boolean;
  shippingStatus: string;
  cancelRequestedAt: string | null;
}

/**
 * Shop CHẤP NHẬN / TỪ CHỐI yêu cầu hủy của khách — gọi API sàn thật rồi kéo lại
 * đơn (lỗi sàn trả 502 kèm thông điệp để làm tay trên Seller Center).
 */
export function decideCancelRequest(orderId: string, accept: boolean) {
  return api<CancelDecideResult>(`/api/orders/${encodeURIComponent(orderId)}/cancel-request/decide`, {
    method: "POST",
    body: { accept },
  });
}

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
