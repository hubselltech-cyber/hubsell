// ============================================================
// GIỚI HẠN GỌI API TIKTOK SHOP — MỘT CỬA cho mọi lời gọi nghiệp vụ (callApi)
//
// Căn cứ: tài liệu chính thức "Rate limits" của TikTok Shop
// (partner.tiktokshop.com/docv2/page/rate-limits, đọc 02/10/2026):
//   · Hạn mức ĐỘNG, không có con số cố định. Đơn vị cô lập nhỏ nhất là
//     App ID × gian đã ủy quyền; ngoài ra còn trần theo endpoint và trần bảo vệ
//     toàn sàn, nên bị chặn không hẳn do mình gọi nhiều.
//   · Tín hiệu quá tải: HTTP 429 hoặc mã nghiệp vụ 36009002 (một trong hai là đủ).
//   · Sàn yêu cầu: làm mượt (không dồn nhiều lượt trong cùng một giây), giới hạn
//     riêng theo gian và loại thao tác, nghỉ tăng dần có lệch ngẫu nhiên, tôn
//     trọng Retry-After, không thử lại ngay; lệnh GHI chỉ thử lại khi không gây
//     trùng.
//
// Vì sao có file này: trước 02/10/2026 callApi không nhận diện quá tải, không
// làm mượt, không thử lại. Tối 02/10 ba gian cùng dựng lại sao kê bị sàn trả
// 36009002 giữa chừng, cả lượt hỏng rồi 10 phút sau chạy lại từ đầu và lại bị
// chặn. Bản vá tạm khi đó (bọc riêng ba lời gọi bản kê trong service.ts) đã được
// thay bằng lớp này.
//
// Làm mượt chạy TRONG TIẾN TRÌNH: web và worker mỗi bên một bộ đếm, nên nhịp
// thật của một gian = tổng các tiến trình. Mức khởi điểm vì thế lấy đầu THẤP của
// bảng sàn gợi ý.
// ============================================================

/** Loại thao tác — sàn khuyên giới hạn riêng lệnh đọc và lệnh ghi. */
export type TiktokCallKind = "read" | "write";

export const TIKTOK_RATE_LIMIT = {
  /** Mã nghiệp vụ sàn dùng cho quá tải (docs mục 4.1). */
  BUSINESS_CODE: 36009002,
  /**
   * Nhịp khởi điểm theo App × gian (lượt/giây) — đầu thấp của bảng 2.2 trong
   * docs: đọc / đồng bộ thường 3–10, ghi thường 1–3. Sàn ghi rõ đây là mức gợi
   * ý để bắt đầu, KHÔNG phải hạn mức bảo đảm.
   */
  START_RPS: { read: 3, write: 1 } as Record<TiktokCallKind, number>,
  /** Sàn dưới khi bị chặn liên tiếp — đầu thấp nhất của bảng 2.2 (0,2 lượt/giây). */
  FLOOR_RPS: 0.2,
  /** Bị chặn → giảm nửa nhịp (mức tự chọn; docs chỉ nói "giảm, rồi tăng dần"). */
  THROTTLE_FACTOR: 0.5,
  /** Tăng lại 25% mỗi 10 phút yên ổn — docs: tăng 20–30% mỗi 10–15 phút. */
  RAMP_FACTOR: 1.25,
  RAMP_EVERY_MS: 10 * 60 * 1000,
  /** Nghỉ-thử-lại theo docs mục 5.6: gốc 1 giây, gấp đôi mỗi lần, trần 60 giây, lệch 0–500 ms, tối đa 5 lần. */
  BACKOFF_BASE_MS: 1_000,
  BACKOFF_CAP_MS: 60_000,
  JITTER_MS: 500,
  MAX_RETRIES: 5,
} as const;

/** Sàn báo quá tải và Hubsell đã hết lượt thử lại (hoặc lệnh không được phép thử lại). */
export class TiktokRateLimitError extends Error {
  constructor(
    readonly info: {
      path: string;
      kind: TiktokCallKind;
      httpStatus: number;
      code: number | null;
      requestId: string | null;
      retryAfterMs: number | null;
      attempts: number;
    },
    message: string
  ) {
    super(message);
    this.name = "TiktokRateLimitError";
  }
}

export function isTiktokRateLimited(err: unknown): err is TiktokRateLimitError {
  return err instanceof TiktokRateLimitError;
}

/** Một phản hồi có phải tín hiệu quá tải không (HTTP 429 hoặc mã 36009002). */
export function isTiktokThrottleSignal(httpStatus: number, code: number | null | undefined): boolean {
  return httpStatus === 429 || code === TIKTOK_RATE_LIMIT.BUSINESS_CODE;
}

/**
 * Lệnh đọc hay ghi. Các API tìm kiếm của TikTok dùng POST (orders/search,
 * returns/search, products/search) nhưng là lệnh đọc; còn lại POST / PUT là ghi.
 */
export function tiktokCallKind(method: string, path: string): TiktokCallKind {
  if (method === "GET" || path.endsWith("/search")) return "read";
  return "write";
}

/** Header Retry-After: số giây hoặc ngày giờ HTTP → mili giây phải chờ; không đọc được → null. */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/**
 * Thời gian nghỉ trước lượt thử lại thứ `retry` (0 = lần thử lại đầu):
 * wait = max(Retry-After, min(gốc × 2^retry + lệch, trần)) — docs mục 5.6.
 */
export function tiktokBackoffMs(retry: number, retryAfterMs: number | null, rand: number): number {
  const generated = Math.min(
    TIKTOK_RATE_LIMIT.BACKOFF_BASE_MS * 2 ** retry + rand * TIKTOK_RATE_LIMIT.JITTER_MS,
    TIKTOK_RATE_LIMIT.BACKOFF_CAP_MS
  );
  return Math.round(retryAfterMs != null ? Math.max(generated, retryAfterMs) : generated);
}

/** Điểm chạm ra ngoài (đồng hồ, nghỉ, số ngẫu nhiên) — test thay bằng bản điều khiển được. */
export const tiktokRateLimitDeps = {
  now: (): number => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
  random: (): number => Math.random(),
};

// ---------- Làm mượt theo gian × loại thao tác ----------

interface Lane {
  /** Nhịp hiện tại (lượt/giây) — giảm khi bị chặn, tăng dần lại khi yên. */
  rps: number;
  /** Mốc sớm nhất được gửi lượt kế. */
  nextAt: number;
  /** Mốc đổi nhịp gần nhất (bị chặn hoặc vừa tăng). */
  changedAt: number;
}
const lanes = new Map<string, Lane>();

function laneOf(shopKey: string, kind: TiktokCallKind, now: number): Lane {
  const key = `${shopKey}|${kind}`;
  let lane = lanes.get(key);
  if (!lane) {
    lane = { rps: TIKTOK_RATE_LIMIT.START_RPS[kind], nextAt: now, changedAt: now };
    lanes.set(key, lane);
  }
  // Tăng dần về nhịp khởi điểm sau mỗi quãng yên ổn.
  const start = TIKTOK_RATE_LIMIT.START_RPS[kind];
  while (lane.rps < start && now - lane.changedAt >= TIKTOK_RATE_LIMIT.RAMP_EVERY_MS) {
    lane.rps = Math.min(start, lane.rps * TIKTOK_RATE_LIMIT.RAMP_FACTOR);
    lane.changedAt += TIKTOK_RATE_LIMIT.RAMP_EVERY_MS;
  }
  return lane;
}

/**
 * Chờ tới lượt gửi của gian — các lời gọi cùng gian, cùng loại cách nhau tối
 * thiểu 1 / nhịp giây, kể cả khi nhiều việc gọi cùng lúc (xếp hàng theo thứ tự
 * đến). Lời gọi không gắn gian (cấp app) dùng chung một làn.
 */
export async function acquireTiktokSlot(shopKey: string, kind: TiktokCallKind): Promise<void> {
  const now = tiktokRateLimitDeps.now();
  const lane = laneOf(shopKey, kind, now);
  const at = Math.max(now, lane.nextAt);
  lane.nextAt = at + 1000 / lane.rps;
  if (at > now) await tiktokRateLimitDeps.sleep(at - now);
}

/** Gian vừa bị sàn chặn → giảm nhịp của làn đó. Trả nhịp mới (lượt/giây) để ghi log. */
export function noteTiktokThrottled(shopKey: string, kind: TiktokCallKind): number {
  const now = tiktokRateLimitDeps.now();
  const lane = laneOf(shopKey, kind, now);
  lane.rps = Math.max(TIKTOK_RATE_LIMIT.FLOOR_RPS, lane.rps * TIKTOK_RATE_LIMIT.THROTTLE_FACTOR);
  lane.changedAt = now;
  return lane.rps;
}

/** Cho test: xóa trạng thái các làn. */
export function resetTiktokRateLimitLanes(): void {
  lanes.clear();
}
