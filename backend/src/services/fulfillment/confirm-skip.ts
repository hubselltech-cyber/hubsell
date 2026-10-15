// ============================================================
// LÝ DO BỎ QUA KHI "CHUẨN BỊ HÀNG" KHÔNG CÒN ĐƠN NÀO ĐỂ GỌI SÀN (15/10/2026)
//
// Sự cố 15/10 (anh Trung test 30 đơn Shopee ANO + DarkMan): lượt 1 sàn ĐÃ nhận
// đủ đơn nhưng web báo lỗi ở bước in nên hộp thoại đứng nguyên; bấm lần 2 máy
// chủ trả 409 "Không có đơn nào ở trạng thái Chờ xử lý" — đúng về kỹ thuật
// nhưng không nói vì sao, người dùng tưởng Hubsell hỏng. Nay câu 409 nói rõ
// 30 đơn đã rời Chờ xử lý (sàn đã nhận ở lượt trước) và kèm mã NO_READY_ORDERS
// để giao diện đóng hộp thoại + tải lại bảng thay vì để người dùng bấm tiếp.
// ============================================================

import { UNPAID_REASON } from "./types";

export const LEFT_PENDING_REASON = "Đơn đã rời trạng thái Chờ xử lý";
export const CANCELLED_REASON = "Đơn đã hủy";
export const NOT_FOUND_REASON = "Không tìm thấy hoặc ngoài quyền";
/** Mã lỗi 409 khi không còn đơn nào gọi sàn được — giao diện đóng hộp thoại + tải lại. */
export const NO_READY_ORDERS_CODE = "NO_READY_ORDERS";

export interface SkipCounts {
  unpaid: number;
  leftPending: number;
  cancelled: number;
  notFound: number;
  other: number;
}

export function countSkipReasons(skipped: { reason: string }[]): SkipCounts {
  const c: SkipCounts = { unpaid: 0, leftPending: 0, cancelled: 0, notFound: 0, other: 0 };
  for (const s of skipped) {
    if (s.reason === UNPAID_REASON) c.unpaid += 1;
    else if (s.reason === LEFT_PENDING_REASON) c.leftPending += 1;
    else if (s.reason === CANCELLED_REASON) c.cancelled += 1;
    else if (s.reason === NOT_FOUND_REASON) c.notFound += 1;
    else c.other += 1;
  }
  return c;
}

/**
 * Câu báo cho người dùng khi mẻ không còn đơn nào ở Chờ xử lý. Ưu tiên lý do
 * đông nhất; đuôi liệt kê các nhóm còn lại để không giấu đơn nào.
 */
export function describeNoReadyOrders(skipped: { reason: string }[]): { error: string; counts: SkipCounts } {
  const counts = countSkipReasons(skipped);
  const total = skipped.length;

  if (total > 0 && counts.unpaid === total) {
    return {
      counts,
      error: `Loại ${counts.unpaid} đơn chưa chuẩn bị vì khách chưa thanh toán — sàn chưa cho sắp xếp vận chuyển`,
    };
  }

  const tails: string[] = [];
  if (counts.unpaid > 0) tails.push(`${counts.unpaid} đơn khách chưa thanh toán`);
  if (counts.cancelled > 0) tails.push(`${counts.cancelled} đơn đã hủy`);
  if (counts.notFound > 0) tails.push(`${counts.notFound} đơn không tìm thấy hoặc ngoài quyền`);
  if (counts.other > 0) tails.push(`${counts.other} đơn bị bỏ qua vì lý do khác`);
  const tail = tails.length > 0 ? ` · ${tails.join(" · ")}` : "";

  if (counts.leftPending > 0) {
    return {
      counts,
      error:
        `${counts.leftPending} đơn đã rời trạng thái Chờ xử lý — sàn đã nhận ở lượt chuẩn bị trước ` +
        `hoặc đã được sắp xếp trên Seller Center. Hubsell tải lại danh sách để anh/chị xem đúng trạng thái.${tail}`,
    };
  }
  return { counts, error: `Không có đơn nào ở trạng thái Chờ xử lý để chuẩn bị${tail}` };
}
