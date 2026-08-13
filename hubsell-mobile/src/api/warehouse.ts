import { api } from "./client";
import type { ReturnsSummaryResponse } from "../types/api";

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
} = {}) {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  if (params.search) q.set("search", params.search);
  if (params.status) q.set("status", params.status);
  return api<ReturnsSummaryResponse>(`/api/warehouse/returns?${q.toString()}`);
}

/** Chỉ cần summary (trang Tổng quan) — lấy 1 dòng cho nhẹ. */
export function fetchReturnsSummary() {
  return fetchReturns({ page: 1, pageSize: 1 });
}
