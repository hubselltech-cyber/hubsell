import { api } from "./client";
import type {
  ReturnCarrierStatus,
  ReturnShippingFilter,
  ReturnsSummaryResponse,
} from "../types/api";

/**
 * Đối soát đơn hoàn — summary (đếm theo trạng thái + quá hạn) kèm danh sách
 * phân trang. Backend sắp xếp đơn CHỜ LÂU NHẤT lên đầu (thứ cần đi đòi trước).
 * search khớp mã đơn / mã vận đơn / tên khách.
 */
export function fetchReturns(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  /** Lọc theo Trạng thái vận chuyển chiều hoàn (sheet Bộ lọc, tab Chờ nhận hoàn). */
  ship?: ReturnShippingFilter;
  /** Lọc theo sàn — channelScope backend tự đọc, thẻ đếm cũng lọc theo. */
  channelName?: string;
} = {}) {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  if (params.search) q.set("search", params.search);
  if (params.status) q.set("status", params.status);
  if (params.ship) q.set("ship", params.ship);
  if (params.channelName) q.set("channelName", params.channelName);
  return api<ReturnsSummaryResponse>(`/api/warehouse/returns?${q.toString()}`);
}

/** Chỉ cần summary (trang Tổng quan) — lấy 1 dòng cho nhẹ. */
export function fetchReturnsSummary() {
  return fetchReturns({ page: 1, pageSize: 1 });
}

/** Số đơn tối đa mỗi lần hỏi hãng — khớp RETURN_LEG_BATCH_MAX ở backend. */
export const RETURN_CARRIER_BATCH = 10;

/**
 * Hỏi hãng đã trả kiện chưa cho các kiện GIAO THẤT BẠI quay đầu đang chờ về (tối đa
 * RETURN_CARRIER_BATCH đơn / lần, mỗi đơn 1 lệnh gọi sàn, backend đệm 10 phút). Đơn
 * khách trả hàng không cần hỏi — `returnShipping` trong danh sách đã đủ.
 */
export function fetchReturnCarrierStatus(ids: string[]) {
  return api<{ items: Record<string, ReturnCarrierStatus> }>(
    "/api/warehouse/returns/carrier-status",
    { method: "POST", body: { ids } }
  );
}
