// ============================================================
// HUBSELL ADS — CẤU HÌNH APP "ADS SERVICE" RIÊNG TRÊN SHOPEE OPEN PLATFORM
//
// Vì sao có app thứ hai (10/09/2026, hồ sơ ISV docs/SHOPEE-ISV-HO-SO.md mục 2):
// app chính 2040029 khi lên ISV đổi thành loại ERP System = "All API except
// Chat API and Ads API". Shopee yêu cầu Ads API phải đi qua app loại Ads
// Service riêng → partner_id / partner_key thứ hai, tên đăng ký "Hubsell Ads".
//
// Nguyên tắc tách:
//   · Toàn bộ credential, ủy quyền, token của app này nằm trong thư mục
//     integrations/hubsell-ads/ — KHÔNG trộn vào integrations/shopee/config.ts.
//   · Dùng lại client Shopee (ký chữ ký, gọi Ads API) bằng cách truyền `cfg`
//     của Hubsell Ads vào — client vốn nhận ShopeeConfig làm tham số.
//   · CHƯA đặt env HUBSELL_ADS_PARTNER_ID/KEY = chưa kích hoạt: Trợ lý quảng
//     cáo tiếp tục chạy bằng token app chính như trước (fallback trong
//     token.ts). Đặt env là bật, gian nào cũng phải ủy quyền thêm Hubsell Ads.
//
// Env:
//   HUBSELL_ADS_PARTNER_ID / HUBSELL_ADS_PARTNER_KEY  — bắt buộc để bật.
//   HUBSELL_ADS_ENV       — sandbox | production; bỏ trống = theo SHOPEE_ENV.
//                          (Cho phép app Ads chạy sandbox trong khi app chính
//                          đã production — giai đoạn chờ Go-Live app Ads.)
//   HUBSELL_ADS_API_BASE  — ghi đè host API (hiếm khi cần).
//   HUBSELL_ADS_REDIRECT_URI — ghi đè callback; bỏ trống = <backend>/api/auth/
//                          hubsell-ads/callback (đăng ký đúng domain trên Console).
// ============================================================

import { getBackendBaseUrl } from "../../lib/backend-url";
import { SHOPEE_HOSTS, type ShopeeConfig } from "../shopee/config";

/** Tên app đăng ký trên Shopee Open Platform — cũng là nhãn hiển thị cho seller. */
export const HUBSELL_ADS_APP_LABEL = "Hubsell Ads";

/** Đường callback OAuth của Hubsell Ads (public, không JWT — xem routes/hubsell-ads.ts). */
export const HUBSELL_ADS_CALLBACK_PATH = "/api/auth/hubsell-ads/callback";

/** true khi đã điền partner_id + partner_key của app Hubsell Ads → chế độ app riêng BẬT. */
export function isHubsellAdsConfigured(): boolean {
  return Boolean(process.env.HUBSELL_ADS_PARTNER_ID && process.env.HUBSELL_ADS_PARTNER_KEY);
}

/** Môi trường của app Hubsell Ads — mặc định theo app chính (SHOPEE_ENV). */
export function getHubsellAdsEnv(): "sandbox" | "production" {
  const raw = process.env.HUBSELL_ADS_ENV || process.env.SHOPEE_ENV;
  return raw === "production" ? "production" : "sandbox";
}

/**
 * Cấu hình Hubsell Ads dưới đúng khuôn ShopeeConfig để truyền thẳng vào client
 * Shopee (getAccessToken / refreshAccessToken / getAds*). Ném lỗi rõ khi thiếu.
 */
export function getHubsellAdsConfig(): ShopeeConfig {
  const partnerId = process.env.HUBSELL_ADS_PARTNER_ID;
  const partnerKey = process.env.HUBSELL_ADS_PARTNER_KEY;
  const missing: string[] = [];
  if (!partnerId) missing.push("HUBSELL_ADS_PARTNER_ID");
  if (!partnerKey) missing.push("HUBSELL_ADS_PARTNER_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Thiếu cấu hình ${HUBSELL_ADS_APP_LABEL} trong .env: ${missing.join(", ")}. ` +
        "Điền Partner ID / Partner Key của app Ads Service lấy từ Shopee Open Platform Console."
    );
  }
  const env = getHubsellAdsEnv();
  return {
    partnerId: partnerId!,
    partnerKey: partnerKey!,
    env,
    apiBase: process.env.HUBSELL_ADS_API_BASE || SHOPEE_HOSTS[env],
    redirectUri:
      process.env.HUBSELL_ADS_REDIRECT_URI ??
      `${getBackendBaseUrl()}${HUBSELL_ADS_CALLBACK_PATH}`,
  };
}
