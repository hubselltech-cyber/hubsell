// ============================================================
// CỔNG CHẶN CHAT SHOPEE KHI SÀN THU HỒI QUYỀN (15/09/2026)
//
// Bối cảnh: tài khoản lên ISV → app 2040029 tự đổi thành ERP System = "All API
// except Chat API and Ads API". Từ đó mọi call /api/v2/sellerchat/* trả 403
// `error_api_permission` ("This app type has no permission to this API").
// Đã gửi ticket xin cấp lại (Enquiry 2099855634883350588) nhưng chưa biết bao
// giờ có. Trong lúc chờ, nếu cứ gọi thì:
//   · Trợ lý vận hành poll 15 giây/lần × mỗi gian → rải 403 liên tục lên log
//     sàn, làm xấu điểm "API Activity" của Service Partner Program;
//   · Cứu đơn giao thất bại thử nhắn từng đơn → ghi FAILED "Sàn từ chối" gây
//     hiểu lầm là lỗi của shop.
//
// Cách làm: cổng TRONG TIẾN TRÌNH, phạm vi TOÀN APP (lỗi là theo LOẠI APP,
// không theo shop). Gặp error_api_permission một lần → khóa mọi call chat
// trong TTL (mặc định 6 giờ); hết TTL tự thử lại một lần — sàn cấp quyền là
// tự mở, không cần deploy. Không dùng DB/Redis: mỗi tiến trình (web/worker)
// tự học sau đúng MỘT call 403, đủ rẻ; hàng chục ngàn shop cũng chỉ tốn một
// biến số.
// ============================================================

const PERMISSION_MARKERS = ["error_api_permission", "no permission to this api"];

/** TTL khóa (phút). Env để chỉnh không cần deploy; 0 = tắt cổng (luôn gọi). */
export const SHOPEE_CHAT_DENIED_TTL_MS =
  Math.max(0, Number(process.env.SHOPEE_CHAT_DENIED_TTL_MINUTES ?? 360) || 0) * 60_000;

/**
 * Câu lỗi chuẩn khi cổng đang khóa — GIỮ chữ "error_api_permission" để tầng
 * trên (FE humanizeChannelError, Cứu đơn) nhận diện cùng một nhánh với lỗi
 * thật từ sàn.
 */
export const SHOPEE_CHAT_DENIED_MESSAGE =
  "Shopee sellerchat lỗi: error_api_permission — app Hubsell (ISV/ERP System) chưa được Shopee cấp Chat API; đã gửi ticket xin cấp quyền, tạm ngưng gọi chat Shopee";

let deniedUntil = 0;
let lastRawError = "";

export function isShopeeChatPermissionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return PERMISSION_MARKERS.some((m) => msg.includes(m));
}

/** Mốc (ms) cổng còn khóa tới, hoặc null nếu đang mở. */
export function shopeeChatDeniedUntil(now = Date.now()): number | null {
  if (SHOPEE_CHAT_DENIED_TTL_MS === 0) return null;
  return deniedUntil > now ? deniedUntil : null;
}

export function markShopeeChatDenied(raw: string, now = Date.now()): void {
  if (SHOPEE_CHAT_DENIED_TTL_MS === 0) return;
  const wasOpen = deniedUntil <= now;
  deniedUntil = now + SHOPEE_CHAT_DENIED_TTL_MS;
  lastRawError = raw;
  if (wasOpen) {
    console.warn(
      `[shopee-chat-gate] Sàn báo không có quyền Chat API — tạm ngưng gọi sellerchat ${Math.round(
        SHOPEE_CHAT_DENIED_TTL_MS / 60_000
      )} phút. Lỗi gốc: ${raw}`
    );
  }
}

/** Chỉ dùng trong test. */
export function resetShopeeChatGate(): void {
  deniedUntil = 0;
  lastRawError = "";
}

export function shopeeChatGateSnapshot(): { deniedUntil: number | null; lastRawError: string } {
  return { deniedUntil: shopeeChatDeniedUntil(), lastRawError };
}

export class ShopeeChatDeniedError extends Error {
  readonly deniedUntil: number;
  constructor(until: number) {
    super(SHOPEE_CHAT_DENIED_MESSAGE);
    this.name = "ShopeeChatDeniedError";
    this.deniedUntil = until;
  }
}

/** Ném ngay nếu cổng đang khóa — dùng cho call không đi qua withShopeeChatGate. */
export function assertShopeeChatAllowed(now = Date.now()): void {
  const until = shopeeChatDeniedUntil(now);
  if (until) throw new ShopeeChatDeniedError(until);
}

/**
 * Bọc MỘT call sellerchat: cổng khóa → ném ShopeeChatDeniedError không gọi
 * sàn; gọi mà dính error_api_permission → khóa cổng rồi ném nguyên lỗi.
 */
export async function withShopeeChatGate<T>(fn: () => Promise<T>): Promise<T> {
  assertShopeeChatAllowed();
  try {
    return await fn();
  } catch (err) {
    if (isShopeeChatPermissionError(err)) {
      markShopeeChatDenied(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}
