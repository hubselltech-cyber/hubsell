// ============================================================
// VIDEO ĐÓNG HÀNG — CHẶN GỌI DỒN trên các đường nóng của màn quay (M2.6, 26/11/2026 — thiết kế mục 29.4 + 39).
//
// Mục đích DUY NHẤT: một máy quay hỏng (vòng lặp thử lại, mã lỗi) không được dội hàng trăm lượt / giây vào máy chủ và
// database dùng chung với cả app. KHÔNG dùng để tính tiền, không phải hạn mức của gói.
//
// Đếm THEO TÀI KHOẢN đang đăng nhập trên máy quay, TRONG TỪNG TIẾN TRÌNH web (cố ý — mục 29.4): nhiều máy web thì trần
// thật = trần × số máy. Sổ đếm là lối chặn tại chỗ, mất khi khởi động lại (khi đó cùng lắm cho qua thêm một loạt).
// Thuật toán GCRA: đều `perSec` lượt / giây, cho dồn tối đa `burst` lượt.
//
// Ba chế độ (env PACK_RATE_LIMIT trên web): "shadow" (MẶC ĐỊNH — chỉ đếm + ghi nhật ký, KHÔNG chặn ai), "on" (trả 429 +
// Retry-After), "off". Chạy bóng trước vì hai con số hạn mức là số tự chọn, chưa có số đo của khách thật.
// ============================================================

export interface RateRule {
  /** Lượt / giây đều đặn. */
  perSec: number;
  /** Số lượt được dồn một lúc. */
  burst: number;
}

export interface RateVerdict {
  ok: boolean;
  /** Mốc mới của khóa (chỉ lưu khi ok). */
  tatMs: number;
  /** Bị chặn: phải chờ ít nhất ngần này. */
  retryAfterMs: number;
}

/** Một lượt xin qua. Thuần, để test được. `tatMs` = mốc đã lưu của khóa (undefined = khóa mới). */
export function gcraAllow(tatMs: number | undefined, nowMs: number, rule: RateRule): RateVerdict {
  const emission = 1000 / rule.perSec;
  const tolerance = emission * rule.burst;
  const next = Math.max(tatMs ?? nowMs, nowMs) + emission;
  if (next - nowMs > tolerance) return { ok: false, tatMs: tatMs ?? nowMs, retryAfterMs: Math.ceil(next - nowMs - tolerance) };
  return { ok: true, tatMs: next, retryAfterMs: 0 };
}

export type PackRateMode = "shadow" | "on" | "off";

export function packRateLimitMode(env: NodeJS.ProcessEnv = process.env): PackRateMode {
  const v = env.PACK_RATE_LIMIT?.trim().toLowerCase();
  return v === "on" || v === "off" ? v : "shadow";
}

/** Trần số tài khoản nằm trong sổ đếm của một tiến trình (đầy thì xóa sạch — cho qua thêm một loạt). SỐ TỰ CHỌN. */
const MAX_KEYS = 100_000;
const LOG_EVERY_MS = 60_000;

export interface PackRateLimiter {
  take(key: string, nowMs?: number): RateVerdict;
  /** Số lượt vượt hạn mức kể từ lần ghi nhật ký trước (test / theo dõi). */
  pendingOver(): number;
}

/**
 * Sổ đếm của MỘT tiến trình. `log` nhận tối đa một dòng / phút: bao nhiêu lượt vượt, bao nhiêu tài khoản, tài khoản
 * vượt nhiều nhất — đủ để quyết định bật chặn thật mà không làm ngập nhật ký.
 */
export function createPackRateLimiter(rule: RateRule, log: (line: string) => void = console.warn): PackRateLimiter {
  const tat = new Map<string, number>();
  const over = new Map<string, number>();
  let overTotal = 0;
  let lastLogMs = 0;

  function flush(nowMs: number): void {
    if (overTotal === 0 || nowMs - lastLogMs < LOG_EVERY_MS) return;
    let worst = "";
    let worstN = 0;
    for (const [k, n] of over) {
      if (n > worstN) {
        worst = k;
        worstN = n;
      }
    }
    log(
      `[PackVideo] gọi dồn: ${overTotal} lượt vượt hạn mức ${rule.perSec}/giây (dồn ${rule.burst}) trong phút qua · ${over.size} tài khoản · nhiều nhất ${worst} (${worstN} lượt) · chế độ ${packRateLimitMode()}`
    );
    over.clear();
    overTotal = 0;
    lastLogMs = nowMs;
  }

  return {
    take(key, nowMs = Date.now()) {
      const verdict = gcraAllow(tat.get(key), nowMs, rule);
      if (verdict.ok) {
        if (tat.size >= MAX_KEYS && !tat.has(key)) tat.clear();
        tat.set(key, verdict.tatMs);
      } else {
        if (over.size < 10_000 || over.has(key)) over.set(key, (over.get(key) ?? 0) + 1);
        overTotal += 1;
        if (lastLogMs === 0) lastLogMs = nowMs - LOG_EVERY_MS; // dòng đầu ghi ngay
      }
      flush(nowMs);
      return verdict;
    },
    pendingOver: () => overTotal,
  };
}
