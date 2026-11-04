// ============================================================
// TỰ CHUẨN BỊ HÀNG — luật chọn đơn + phân loại lỗi sàn (04/11/2026)
// docs/TU-CHUAN-BI-HANG.md mục 3. Hàm thuần, không đụng DB, để test được từng ca.
//
// Nguyên tắc: không đơn nào vào vòng thử lại không trần; mỗi đơn bị loại có
// đúng một lý do để log đếm được.
// ============================================================

import { isExpressShipping } from "../services/shipping";
import { isNotReadyError } from "../services/fulfillment/types";

export const AUTO_ARRANGE_STREAM = "auto-arrange";
export const AUTO_ARRANGE_SHADOW_STREAM = "auto-arrange-shadow";
export const AUTO_ARRANGE_LANE = "fulfill";

export interface AutoArrangeCandidate {
  id: string;
  orderCode: string;
  createdAt: Date;
  paymentStatus: string;
  cancelRequestedAt: Date | null;
  shippingCarrierName: string | null;
  autoArrangeTriedAt: Date | null;
  autoArrangeAttempts: number;
  autoArrangeBlockedAt: Date | null;
}

export type SkipReason =
  | "unpaid"
  | "cancel_requested"
  | "express"
  | "blocked"
  | "max_attempts"
  | "tried_recently"
  | "in_running_batch";

export interface SelectOptions {
  now: Date;
  /** Đơn đang nằm trong mẻ RUNNING còn sống (người đang bấm hoặc lượt máy trước). */
  runningOrderIds: ReadonlySet<string>;
  maxAttempts: number;
  /** Thử lại một đơn "chưa sẵn sàng" sớm nhất sau ngần này ms. */
  retryAfterMs: number;
  maxPerRun: number;
}

export interface Selection<T extends AutoArrangeCandidate> {
  /** Cũ nhất trước, đã cắt theo maxPerRun. */
  ready: T[];
  skipped: Record<SkipReason, number>;
  /** Còn đơn đủ điều kiện nhưng quá trần lượt này → tới hạn lại ngay. */
  more: boolean;
}

function skipReasonOf(o: AutoArrangeCandidate, opts: SelectOptions): SkipReason | null {
  if (o.paymentStatus === "UNPAID") return "unpaid";
  if (o.cancelRequestedAt) return "cancel_requested";
  // Hỏa tốc để người làm: hãng tới lấy trong vài giờ, phải chọn khung giờ và có hàng
  // sẵn — đúng câu cảnh báo trên popup. Muốn máy làm cả hỏa tốc thì bỏ dòng này.
  if (isExpressShipping(o.shippingCarrierName)) return "express";
  if (o.autoArrangeBlockedAt) return "blocked";
  if (o.autoArrangeAttempts >= opts.maxAttempts) return "max_attempts";
  if (o.autoArrangeTriedAt && opts.now.getTime() - o.autoArrangeTriedAt.getTime() < opts.retryAfterMs) {
    return "tried_recently";
  }
  if (opts.runningOrderIds.has(o.id)) return "in_running_batch";
  return null;
}

export function selectAutoArrangeCandidates<T extends AutoArrangeCandidate>(
  orders: readonly T[],
  opts: SelectOptions
): Selection<T> {
  const skipped: Record<SkipReason, number> = {
    unpaid: 0,
    cancel_requested: 0,
    express: 0,
    blocked: 0,
    max_attempts: 0,
    tried_recently: 0,
    in_running_batch: 0,
  };
  const eligible: T[] = [];
  for (const o of orders) {
    const reason = skipReasonOf(o, opts);
    if (reason) skipped[reason] += 1;
    else eligible.push(o);
  }
  // Cũ nhất trước: đơn chờ lâu sát hạn bàn giao của sàn hơn.
  eligible.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.orderCode.localeCompare(b.orderCode));
  const max = Math.max(0, opts.maxPerRun);
  return { ready: eligible.slice(0, max), skipped, more: eligible.length > max };
}

export type FailureClass = "channel" | "retry" | "block";

/**
 * Lỗi của MỘT đơn sàn trả về (đã qua humanizeArrangeError) thuộc nhóm nào:
 *  - channel: cả gian đang hỏng (mất kết nối, thiếu quyền, 429, sàn 5xx…) → không
 *    đánh dấu đơn, hẹn gian lại;
 *  - retry: sàn chưa sẵn sàng → đếm lần, thử lại lượt sau;
 *  - block: lỗi cứng của riêng đơn → chặn, người làm tay.
 * Xét theo thứ tự trên: câu "mất kết nối" cũng có chữ "chưa" nên phải bắt trước.
 */
export function classifyArrangeFailure(reason: string): FailureClass {
  const r = reason.toLowerCase();
  if (
    /mất kết nối|kết nối lại|chưa cấp quyền|permission|scope|token|chưa cấu hình|rate.?limit|429|too many|quá nhịp|quay lại sau|timeout|quá hạn chờ|econnreset|fetch failed|socket hang up|\b5\d\d\b|internal server error|service unavailable/.test(r)
  ) {
    return "channel";
  }
  if (/chưa sẵn sàng|chưa thanh toán|không trả kết quả/.test(r) || isNotReadyError(reason)) return "retry";
  return "block";
}

/** Mọi đơn của lượt đều lỗi với cùng một câu thuộc nhóm channel → coi là lỗi cả gian. */
export function isChannelWideFailure(failed: readonly { reason: string }[], total: number): boolean {
  if (total === 0 || failed.length !== total) return false;
  const first = failed[0].reason;
  return classifyArrangeFailure(first) === "channel" && failed.every((f) => f.reason === first);
}

/** Lỗi gian: mất kết nối / thiếu quyền chờ người ủy quyền lại → nghỉ lâu; còn lại là lỗi tạm. */
export function isAuthFailure(reason: string): boolean {
  return /mất kết nối|kết nối lại|chưa cấp quyền|permission|scope|token/i.test(reason);
}

/** Lệch nhịp ngẫu nhiên ± jitter quanh base, không âm. */
export function jittered(baseMs: number, jitterMs: number, random = Math.random): number {
  return Math.max(0, Math.round(baseMs + (random() * 2 - 1) * jitterMs));
}
