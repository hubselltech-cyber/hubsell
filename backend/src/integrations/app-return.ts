import jwt from "jsonwebtoken";

/**
 * QUAY VỀ APP MOBILE SAU ỦY QUYỀN SÀN (lát 2, 28/10/2026 — docs
 * MOBILE-NOI-GIAN-GIA-VON.md mục 4).
 *
 * Địa chỉ callback đăng ký phía sàn cố định (Shopee/Lazada → backend này,
 * TikTok → trang web /channels/tiktok/callback). App mở trang ủy quyền bằng
 * phiên trình duyệt hệ thống và xin link với `?client=app`; backend ký
 * `client: "app"` vào state. Callback thấy dấu đó thì chuyển hướng về deep link
 * của app thay vì trang Kênh bán web — phiên trình duyệt tự đóng, app đọc kết
 * quả. Đích là scheme CỐ ĐỊNH của app (không lấy từ tham số) nên không mở
 * redirect bừa; mọi tham số kết quả giống hệt bộ tham số FE web đang dùng
 * (shopee=connected|error|code, lazada=…, tiktok=code) để app dùng chung bộ đọc.
 */
export const APP_MOBILE_SCHEME = process.env.APP_MOBILE_SCHEME ?? "hubsellmobile";

/** `hubsellmobile://channels?...` — route /channels của app (màn Gian hàng). */
export function appChannelsUrl(params: Record<string, string>): string {
  return `${APP_MOBILE_SCHEME}://channels?${new URLSearchParams(params).toString()}`;
}

/**
 * Đọc dấu `client` từ state KHÔNG kiểm chữ ký — chỉ dùng để chọn ĐÍCH chuyển
 * hướng (web hay app), không cấp quyền gì: state giả mạo cùng lắm làm trình
 * duyệt mở app với một thông báo lỗi. Danh tính chủ shop vẫn qua verify.
 */
export function decodeOauthStateClient(token: string | null | undefined): "app" | null {
  if (!token) return null;
  try {
    const payload = jwt.decode(token) as jwt.JwtPayload | null;
    return payload && payload.client === "app" ? "app" : null;
  } catch {
    return null;
  }
}

/** State TikTok là chuỗi ngẫu nhiên (không ký) — app đánh dấu bằng tiền tố. */
export const TIKTOK_APP_STATE_PREFIX = "app_";
