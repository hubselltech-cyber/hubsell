// ============================================================
// TIKTOK ADS — CẤU HÌNH APP TRÊN TIKTOK MARKETING API (TikTok API for Business)
//
// Đây là HỆ THỨ HAI của TikTok, tách hẳn khỏi TikTok Shop Partner API ở
// integrations/tiktok/ (đơn hàng, sản phẩm, quyết toán):
//   · Cổng riêng business-api.tiktok.com, app riêng (App ID / Secret riêng).
//   · Chủ shop ủy quyền TÀI KHOẢN QUẢNG CÁO (advertiser), không phải gian hàng.
//   · access_token DÀI HẠN: không hết hạn, không refresh — chỉ chết khi nhà
//     quảng cáo hủy ủy quyền (docs Authentication, đọc 17/09/2026).
// Quảng cáo GMV Max (report từng video, loại video kém) chỉ có ở hệ này.
//
// App "Hubsell" (developer CÔNG TY TNHH CÔNG NGHỆ HUBSELL) được duyệt 17/09/2026,
// scope chỉ đọc + loại video: Ad account information, GMV Max › Store management
// + Identity and video, Reporting › GMV Max reports. CHƯA xin nhóm Campaign.
//
// Env:
//   TIKTOK_ADS_APP_ID / TIKTOK_ADS_SECRET — bắt buộc để bật.
//   TIKTOK_ADS_REDIRECT_URI — phải TRÙNG KHỚP Redirect URL khai trên portal;
//                             bỏ trống = https://app.hubsell.tech/ads/tiktok/callback.
// ============================================================

export const TIKTOK_ADS_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const TIKTOK_ADS_AUTHORIZE_URL = "https://business-api.tiktok.com/portal/auth";
const DEFAULT_REDIRECT_URI = "https://app.hubsell.tech/ads/tiktok/callback";

export interface TiktokAdsConfig {
  appId: string;
  secret: string;
  redirectUri: string;
}

/** true khi đã điền App ID + Secret của app Marketing API. */
export function isTiktokAdsConfigured(): boolean {
  return Boolean(process.env.TIKTOK_ADS_APP_ID && process.env.TIKTOK_ADS_SECRET);
}

export function getTiktokAdsConfig(): TiktokAdsConfig {
  const appId = process.env.TIKTOK_ADS_APP_ID;
  const secret = process.env.TIKTOK_ADS_SECRET;
  const missing: string[] = [];
  if (!appId) missing.push("TIKTOK_ADS_APP_ID");
  if (!secret) missing.push("TIKTOK_ADS_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `Thiếu cấu hình TikTok Ads trong .env: ${missing.join(", ")}. ` +
        "Lấy ở business-api.tiktok.com → My Apps → Hubsell → Basic Information."
    );
  }
  return {
    appId: appId!,
    secret: secret!,
    redirectUri: process.env.TIKTOK_ADS_REDIRECT_URI || DEFAULT_REDIRECT_URI,
  };
}

/**
 * URL trang ủy quyền tài khoản quảng cáo. TikTok trả về
 * `<redirect_uri>?auth_code=...&state=...`; auth_code sống 1 giờ, dùng một lần.
 */
export function buildTiktokAdsAuthorizeUrl(state: string, cfg = getTiktokAdsConfig()): string {
  const qs = new URLSearchParams({
    app_id: cfg.appId,
    state,
    redirect_uri: cfg.redirectUri,
  });
  return `${TIKTOK_ADS_AUTHORIZE_URL}?${qs.toString()}`;
}
