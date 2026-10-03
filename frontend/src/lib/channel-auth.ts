// ============================================================
// THỜI HẠN ỦY QUYỀN PHÍA SÀN của một gian (Shopee / TikTok) — phần tính toán thuần cho
// thẻ gian ở trang Kênh bán (03/10/2026, docs/THOI-HAN-UY-QUYEN-SAN.md).
//
// Mỗi lần ủy quyền trên sàn có một thời hạn. Hết hạn thì sàn ngừng cho Hubsell đồng bộ
// gian đó tới khi chủ shop ủy quyền lại — không phải Hubsell lỗi. Tệp này trả lời hai
// câu: gian này hết hạn ngày nào, và gian đã ngắt có phải vì hết hạn không.
// ============================================================

import type { Channel } from "@/lib/api";

/** Còn từ chừng này ngày trở xuống thì dòng "Ủy quyền … đến…" hiện thêm nút Ủy quyền lại (mức tự chọn). */
export const PLATFORM_AUTH_SOON_DAYS = 7;

/**
 * TikTok trả thẳng ngày hết hạn ủy quyền trong token (refresh_token_expire_in → cột
 * refreshTokenExpireAt): chủ shop để "Không giới hạn" thì ngày rơi vào khoảng 100 năm
 * sau, chọn có thời hạn thì là ngày thật (prod 03/10/2026: một gian hết sau 9 ngày).
 * Xa hơn mốc này coi là không giới hạn.
 */
const TIKTOK_AUTH_UNLIMITED_MS = 20 * 365 * 86_400_000;

/**
 * Ngày hết hạn ủy quyền phía sàn của gian; null = chưa biết, không giới hạn, hoặc sàn
 * không thuộc diện này (Lazada có kỳ dịch vụ riêng, xử lý ở trang Kênh bán).
 * Shopee: ngày Hubsell hỏi được từ Shopee (authExpireAt).
 */
export function platformAuthEnd(c: Channel, now: number = Date.now()): Date | null {
  if (c.channelName === "SHOPEE") return c.authExpireAt ? new Date(c.authExpireAt) : null;
  if (c.channelName === "TIKTOK" && c.refreshTokenExpireAt) {
    const end = new Date(c.refreshTokenExpireAt);
    return end.getTime() - now > TIKTOK_AUTH_UNLIMITED_MS ? null : end;
  }
  return null;
}

/**
 * Gian Shopee đã ngắt vì hết hạn ủy quyền: Shopee trả mã shop_access_expired ở lượt đồng
 * bộ cuối, hoặc ngày hết hạn Shopee báo đã qua.
 */
function shopeeAuthExpired(c: Channel, now: number): boolean {
  if (c.channelName !== "SHOPEE" || c.status === "ACTIVE") return false;
  if (c.lastSyncError?.includes("shop_access_expired")) return true;
  return Boolean(c.authExpireAt && new Date(c.authExpireAt).getTime() < now);
}

/**
 * Gian TikTok đã ngắt vì hết hạn ủy quyền: ngày hết hạn TikTok báo đến TRƯỚC lúc gian bị
 * ngắt. Chủ shop tự bấm ngắt khi quyền còn hạn thì không tính.
 */
function tiktokAuthExpired(c: Channel, now: number): boolean {
  if (c.channelName !== "TIKTOK" || c.status === "ACTIVE" || !c.refreshTokenExpireAt) return false;
  const end = new Date(c.refreshTokenExpireAt).getTime();
  const cut = c.disconnectedAt ? new Date(c.disconnectedAt).getTime() : now;
  return end <= cut;
}

/** Gian (Shopee / TikTok) đã ngắt VÌ HẾT HẠN ỦY QUYỀN phía sàn — không phải Hubsell lỗi, không phải chủ shop bấm ngắt. */
export function platformAuthExpired(c: Channel, now: number = Date.now()): boolean {
  return shopeeAuthExpired(c, now) || tiktokAuthExpired(c, now);
}
