// ============================================================
// LÝ DO BỎ QUA KHI "CHUẨN BỊ HÀNG" KHÔNG CÒN ĐƠN NÀO ĐỂ GỌI SÀN (15/10/2026)
//
// Sự cố 15/10 (anh Trung test 30 đơn Shopee ANO + DarkMan): lượt 1 sàn ĐÃ nhận
// đủ đơn nhưng web báo lỗi ở bước in nên hộp thoại đứng nguyên; bấm lần 2 máy
// chủ trả 409 "Không có đơn nào ở trạng thái Chờ xử lý" — đúng về kỹ thuật
// nhưng không nói vì sao, người dùng tưởng Hubsell hỏng. Nay câu 409 nói rõ
// 30 đơn đã rời Chờ xử lý (sàn đã nhận ở lượt trước) và kèm mã NO_READY_ORDERS
// để giao diện đóng hộp thoại + tải lại bảng thay vì để người dùng bấm tiếp.
//
// Cùng ngày, đọc Supabase: lượt 1 DONE sau 8,5 giây nhưng lượt 2 (bấm lại 6
// giây sau) được tạo khi lượt 1 CÒN RUNNING → 20 đơn Shopee đã sắp xếp bị gọi
// lại, sàn từ chối "not eligible for rescheduling". Nay lượt mới KHÔNG gọi đơn
// đang nằm trong một lượt RUNNING còn sống (splitByRunningBatches); nếu mọi
// đơn chọn đều đang ở đúng MỘT lượt thì giao diện theo dõi tiếp lượt đó.
// ============================================================

import { UNPAID_REASON } from "./types";

export const LEFT_PENDING_REASON = "Đơn đã rời trạng thái Chờ xử lý";
export const CANCELLED_REASON = "Đơn đã hủy";
export const NOT_FOUND_REASON = "Không tìm thấy hoặc ngoài quyền";
/** Đơn đang nằm trong một lượt RUNNING còn sống của cùng chủ shop (15/10). */
export const IN_RUNNING_BATCH_REASON = "Đang được sắp xếp ở lượt trước — đợi lượt đó xong";
/** Mã lỗi 409 khi không còn đơn nào gọi sàn được — giao diện đóng hộp thoại + tải lại. */
export const NO_READY_ORDERS_CODE = "NO_READY_ORDERS";

export interface SkipCounts {
  unpaid: number;
  leftPending: number;
  cancelled: number;
  notFound: number;
  inRunning: number;
  other: number;
}

export function countSkipReasons(skipped: { reason: string }[]): SkipCounts {
  const c: SkipCounts = { unpaid: 0, leftPending: 0, cancelled: 0, notFound: 0, inRunning: 0, other: 0 };
  for (const s of skipped) {
    if (s.reason === UNPAID_REASON) c.unpaid += 1;
    else if (s.reason === LEFT_PENDING_REASON) c.leftPending += 1;
    else if (s.reason === CANCELLED_REASON) c.cancelled += 1;
    else if (s.reason === NOT_FOUND_REASON) c.notFound += 1;
    else if (s.reason === IN_RUNNING_BATCH_REASON) c.inRunning += 1;
    else c.other += 1;
  }
  return c;
}

/** Một lượt RUNNING còn sống (updatedAt trong STALE_MS) của chủ shop. */
export interface RunningBatchRef {
  id: string;
  /** id đơn lượt đó đem đi gọi sàn (cột fulfillment_batches.orderIds). */
  orderIds: string[];
}

export interface RunningSplit {
  /** id đơn chọn không nằm trong lượt nào đang chạy → gọi sàn ở lượt mới. */
  free: string[];
  /** id đơn chọn → id lượt đang xử lý nó (bỏ qua với IN_RUNNING_BATCH_REASON). */
  held: Map<string, string>;
  /**
   * Mọi đơn chọn đều đang ở đúng MỘT lượt → không tạo lượt mới, trả batchId
   * này để giao diện theo dõi tiếp. null khi còn đơn tự do, không đơn nào bị
   * giữ, hoặc đơn bị giữ rải ở ≥2 lượt (route trả 409 như hết đơn).
   */
  reattachTo: string | null;
}

/**
 * Hàm thuần — tách đơn chọn thành "tự do" và "đang ở lượt trước". Không DB:
 * route đã lấy sẵn các lượt RUNNING còn sống của chủ shop (0–2 dòng).
 * Cùng một đơn nằm ở nhiều lượt (không nên xảy ra) → lấy lượt đứng trước.
 */
export function splitByRunningBatches(running: RunningBatchRef[], selectedIds: string[]): RunningSplit {
  const owner = new Map<string, string>();
  for (const b of running) {
    for (const id of b.orderIds) if (!owner.has(id)) owner.set(id, b.id);
  }
  const free: string[] = [];
  const held = new Map<string, string>();
  for (const id of selectedIds) {
    const batchId = owner.get(id);
    if (batchId) held.set(id, batchId);
    else free.push(id);
  }
  const batches = new Set(held.values());
  const reattachTo = free.length === 0 && batches.size === 1 ? [...batches][0] : null;
  return { free, held, reattachTo };
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

  // Đơn đang ở lượt trước xét TRƯỚC "đã rời Chờ xử lý": việc còn đang chạy,
  // câu báo phải bảo ĐỢI chứ không phải "sàn đã nhận". (Chỉ tới đây khi đơn
  // bị giữ rải ở ≥2 lượt — đúng một lượt thì route đã trả reattached.)
  if (counts.inRunning > 0) {
    const rest = [...(counts.leftPending > 0 ? [`${counts.leftPending} đơn đã rời Chờ xử lý`] : []), ...tails];
    const restTail = rest.length > 0 ? ` · ${rest.join(" · ")}` : "";
    return {
      counts,
      error:
        `${counts.inRunning} đơn đang được sắp xếp ở lượt chuẩn bị trước — đợi lượt đó xong rồi tải lại ` +
        `danh sách, không bấm lại.${restTail}`,
    };
  }

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
