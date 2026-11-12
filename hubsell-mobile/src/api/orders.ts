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
 * Nhóm đơn của popup Thống kê ở màn Đơn hàng (12/11/2026, khách xin xem SKU của cả đơn
 * mới ra / đang giao / thành công):
 *   PENDING     = Chờ xử lý (đơn mới về)
 *   NOT_PRINTED = Chưa in phiếu (đã chuẩn bị hàng, chưa in phiếu trên Hubsell)
 *   PACK        = Chờ đóng gói (đã in phiếu, chưa quét đóng gói) — PHIẾU NHẶT HÀNG
 *   PACKED      = Đã đóng gói (đã quét, chưa giao cho đơn vị vận chuyển)
 *   SHIPPING    = Đang giao
 *   DELIVERED   = Đã giao thành công TRONG KỲ (bắt buộc có kỳ — không thì là cả lịch sử)
 * Sáu nhóm nối nhau thành MỘT dây chuyền: đơn chưa hủy nào cũng nằm ở đúng một nhóm
 * (anh Trung 12/11: "chuẩn bị hàng mà chưa in đơn thì thuộc phần nào?" — bản 4 nhóm bỏ
 * sót Chưa in phiếu và Đã đóng gói).
 */
export type PickGroup = "PENDING" | "NOT_PRINTED" | "PACK" | "PACKED" | "SHIPPING" | "DELIVERED";

/** Ba nhóm con của trạng thái Đã xử lý → giá trị `printed` gửi máy chủ. */
const PROCESSED_GROUP: Partial<Record<PickGroup, "yes" | "no" | "packed">> = {
  NOT_PRINTED: "no",
  PACK: "yes",
  PACKED: "packed",
};

/**
 * THỐNG KÊ SẢN PHẨM theo nhóm đơn (05/11/2026 chỉ có Phiếu nhặt hàng của Chờ đóng gói):
 * số lượng theo SKU / sản phẩm, trong phạm vi sàn / gian / hãng / từ khóa đang lọc. Cùng
 * route với popup của web nên hai nơi một số; trả ĐỦ mọi SKU (route cũ /api/orders/stats
 * cắt top 50 — thiếu dòng là kho nhặt thiếu). Trạng thái + printed bị ĐÈ theo `group`,
 * không lấy từ bộ lọc đang xem.
 */
export function fetchPickSummary(
  params: OrdersFilter,
  group: PickGroup = "PACK",
  delivered?: { from: string; to: string }
) {
  const q = filterParams({
    ...params,
    shippingStatus: PROCESSED_GROUP[group] ? "PROCESSED" : group,
    printed: PROCESSED_GROUP[group],
  });
  if (group === "DELIVERED" && delivered) {
    q.set("deliveredFrom", delivered.from);
    q.set("deliveredTo", delivered.to);
  }
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
export function lookupOrder(code: string, opts: { detail?: boolean; fast?: boolean } = {}) {
  // detail = xin kèm khối thông tin thanh toán của đơn (nút QR "Chi tiết đơn hàng").
  // fast   = máy chủ chỉ đọc DB, không tự hỏi sàn khi tra trượt (chế độ Quét nhiều — quét
  //          liên tục, mã phân tuyến trên tem không được kích một lượt đồng bộ).
  return api<LookupResponse>(
    `/api/orders/lookup?code=${encodeURIComponent(code)}${opts.detail ? "&detail=1" : ""}${opts.fast ? "&fast=1" : ""}`
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

// ───────── Hành trình vận chuyển — GET /api/orders/:id/tracking (12/11/2026) ─────────

export interface TrackingEventDto {
  /** ISO; null khi sàn không trả thời điểm. */
  at: string | null;
  description: string;
  kind: "normal" | "delivered" | "failed" | "returning";
}

export interface OrderTrackingDto {
  /** ok = có hành trình · not_shipped = chưa giao cho vận chuyển · unsupported = sàn / gian chưa lấy được. */
  state: "ok" | "not_shipped" | "unsupported";
  carrier: string | null;
  trackingCode: string | null;
  /** Mới nhất trước. */
  events: TrackingEventDto[];
  fetchedAt: string | null;
}

/**
 * Hành trình của bên vận chuyển, máy chủ hỏi sàn theo yêu cầu (1 call sàn / lượt, nhớ 10
 * phút). Chỉ gọi khi người dùng thật sự xem — xem components/OrderTrackingSection.tsx.
 */
export function fetchOrderTracking(orderId: string) {
  return api<OrderTrackingDto>(`/api/orders/${encodeURIComponent(orderId)}/tracking`);
}
