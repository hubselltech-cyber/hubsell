// ============================================================
// PHẦN THUẦN của cổng gọi sàn (N4 + N5, docs CUNG-HOA-LOP-GOI-SAN mục 5b):
// GCRA nhiều khóa (xin lượt theo lô), AIMD hạ/hồi nhịp, lùi full jitter.
//
// Hàm SQL `api_rate_take` / `api_rate_penalize` (migration 20261019110000) là
// bản Postgres của ĐÚNG các công thức này — test DB so hai bản trên cùng chuỗi
// lệnh. Đổi công thức ở đây thì phải đổi cả SQL.
// ============================================================

/** Trần một khóa. emissionMs = 1000 / lượt-mỗi-giây; 0 = không chặn trước (chỉ lùi + đo). */
export interface KeyLimit {
  key: string;
  emissionMs: number;
  burst: number;
}

export interface KeyState {
  /** GCRA "theoretical arrival time" (ms). */
  tatMs: number;
  /** Bị lùi tới mốc này (ms); 0 = không. */
  blockedUntilMs: number;
  /** Số lần lỗi liên tiếp (về 0 khi gọi thành công). */
  failures: number;
  /** Hệ số nhịp AIMD lúc bị hạ (0–1]. */
  factor: number;
  decreasedAtMs: number;
}

export const FRESH_KEY: KeyState = { tatMs: 0, blockedUntilMs: 0, failures: 0, factor: 1, decreasedAtMs: 0 };

/** Hệ số nhịp hiện tại: hồi tuyến tính từ lần hạ gần nhất, tối đa 1. */
export function currentFactor(s: KeyState, nowMs: number, recoverMs: number): number {
  if (s.factor >= 1) return 1;
  return Math.min(1, s.factor + Math.max(0, nowMs - s.decreasedAtMs) / recoverMs);
}

export interface TakeDecision {
  /** 0 = được gọi (đã trừ lượt mọi khóa); > 0 = phải chờ ngần ấy ms, KHÔNG trừ lượt khóa nào. */
  waitMs: number;
  /** tat mới của các khóa có trần (chỉ áp khi waitMs = 0). */
  newTat: Map<string, number>;
  /** Khóa đang có lỗi liên tiếp — gọi thành công thì xóa đếm. */
  failedKeys: string[];
}

/**
 * Xin `n` lượt cùng lúc trên mọi khóa (tất cả hoặc không). n bị kẹp ≤ burst
 * nhỏ nhất của các khóa có trần (xin quá burst thì không bao giờ được).
 */
export function gcraTake(
  states: ReadonlyMap<string, KeyState>,
  limits: readonly KeyLimit[],
  nowMs: number,
  n: number,
  recoverMs: number
): TakeDecision {
  let waitMs = 0;
  const newTat = new Map<string, number>();
  const failedKeys: string[] = [];
  const cap = Math.min(...limits.filter((l) => l.emissionMs > 0).map((l) => l.burst), Number.POSITIVE_INFINITY);
  const want = Math.max(1, Math.min(n, cap));
  for (const l of limits) {
    const s = states.get(l.key) ?? FRESH_KEY;
    if (s.failures > 0) failedKeys.push(l.key);
    if (s.blockedUntilMs > nowMs) waitMs = Math.max(waitMs, s.blockedUntilMs - nowMs);
    if (l.emissionMs <= 0) continue;
    const eff = l.emissionMs / currentFactor(s, nowMs, recoverMs);
    const tat = Math.max(s.tatMs, nowMs) + eff * want;
    const over = tat - nowMs - l.burst * eff;
    if (over > 0) waitMs = Math.max(waitMs, Math.ceil(over));
    newTat.set(l.key, tat);
  }
  return { waitMs, newTat, failedKeys };
}

export interface PenaltyRule {
  baseMs: number;
  capMs: number;
  /** true = full jitter (rand × trần lần này); false = đúng trần lần này (lỗi cứng theo app). */
  jitter: boolean;
  /** Hạ nhịp AIMD khóa này. */
  decrease?: boolean;
  minFactor?: number;
}

/** Thời gian lùi cho lần lỗi thứ `failures` (≥ 1); tôn trọng Retry-After của sàn. */
export function backoffMs(failures: number, rule: PenaltyRule, rand: number, retryAfterMs?: number | null): number {
  const ceiling = Math.min(rule.capMs, rule.baseMs * 2 ** Math.max(0, failures - 1));
  const generated = rule.jitter ? Math.round(rand * ceiling) : ceiling;
  return retryAfterMs != null && retryAfterMs > 0 ? Math.max(generated, Math.round(retryAfterMs)) : generated;
}

/** Trạng thái khóa sau một lần lỗi. */
export function penalize(
  s: KeyState,
  rule: PenaltyRule,
  nowMs: number,
  rand: number,
  recoverMs: number,
  retryAfterMs?: number | null
): KeyState {
  const failures = s.failures + 1;
  const blockedUntilMs = Math.max(s.blockedUntilMs, nowMs + backoffMs(failures, rule, rand, retryAfterMs));
  if (!rule.decrease) return { ...s, failures, blockedUntilMs };
  const factor = Math.max(rule.minFactor ?? 0.1, currentFactor(s, nowMs, recoverMs) * 0.5);
  return { ...s, failures, blockedUntilMs, factor, decreasedAtMs: nowMs };
}
