// ============================================================
// CẤU HÌNH KẾT NỐI SHOPEE OPEN PLATFORM (API v2)
//
// App loại "Seller In House System" tạo trên Shopee Open Platform.
// Partner Key KHÔNG được commit — điền trong backend/.env (đã gitignore).
//
// Redirect URI phải nằm dưới ĐÚNG DOMAIN đã đăng ký trên Shopee Console (Shopee
// chỉ kiểm domain của redirect, không kiểm full path). Mặc định suy ra động từ
// URL gốc backend (BACKEND_URL / RENDER_EXTERNAL_URL — xem backend-url.ts) nên
// deploy Render là tự đúng; chỉ đặt SHOPEE_REDIRECT_URI khi cần ghi đè (vd
// sandbox local dùng trick hosts http://hubsell.tech).
// ============================================================

import { getBackendBaseUrl } from "../../backend-url";

export interface ShopeeConfig {
  /** partner_id của app (giữ dạng chuỗi để ghép chữ ký / query). */
  partnerId: string;
  /** partner_key — bí mật để ký HMAC-SHA256. */
  partnerKey: string;
  /** URL Shopee chuyển hướng về sau khi người bán đồng ý uỷ quyền. */
  redirectUri: string;
  /** Host API theo môi trường (sandbox / production). */
  apiBase: string;
  env: "sandbox" | "production";
}

// Host API của Shopee theo môi trường.
// LƯU Ý: domain sandbox cũ `partner.test-stable.shopeemobile.com` ĐÃ BỊ KHAI TỬ
// (mọi request ký đúng vẫn trả error_sign). Sandbox mới là openplatform.sandbox.
// test-stable.shopee.cn — đã kiểm chứng chữ ký qua (trả invalid_code cho code giả).
const SHOPEE_HOSTS = {
  sandbox: "https://openplatform.sandbox.test-stable.shopee.cn",
  production: "https://partner.shopeemobile.com",
} as const;

// URL trang uỷ quyền MỚI (developer-guide/20, Shopee xác nhận qua ticket 08/2026):
// URL cố định, KHÔNG ký sign/timestamp, tham số auth_type=seller. Trang cũ
// /api/v2/shop/auth_partner đá seller sang cổng developer nên khách không tự
// liên kết được — đó chính là bug đã report.
export const SHOPEE_AUTH_URLS = {
  sandbox: "https://open.sandbox.test-stable.shopee.com/auth",
  production: "https://open.shopee.com/auth",
} as const;

// Đường dẫn API cố định (dùng để ghép chữ ký — path là một phần của base string).
export const SHOPEE_PATHS = {
  /** Đổi code → access_token/refresh_token (public API). */
  tokenGet: "/api/v2/auth/token/get",
  /** Làm mới access_token bằng refresh_token (public API). */
  accessTokenGet: "/api/v2/auth/access_token/get",
  /** Lấy thông tin gian hàng (shop API, ký thêm access_token+shop_id). */
  shopInfo: "/api/v2/shop/get_shop_info",
  /** Danh sách đơn (order_sn) trong một khoảng thời gian (≤15 ngày/lần). */
  orderList: "/api/v2/order/get_order_list",
  /** Chi tiết đơn theo order_sn (≤50 sn/lần). */
  orderDetail: "/api/v2/order/get_order_detail",
  /** Danh sách item_id của shop (phân trang offset, lọc theo item_status). */
  itemList: "/api/v2/product/get_item_list",
  /** Thông tin cơ bản của item theo item_id (≤50 id/lần). */
  itemBaseInfo: "/api/v2/product/get_item_base_info",
  /** Danh sách phân loại (model) của một item — SKU thật nằm ở cấp model. */
  modelList: "/api/v2/product/get_model_list",
  /** Cập nhật tồn kho của item/model lên sàn (shop API, POST). */
  updateStock: "/api/v2/product/update_stock",
  /** DS đơn ĐÃ GIẢI NGÂN ký quỹ trong khoảng release_time (payment API). */
  escrowList: "/api/v2/payment/get_escrow_list",
  /** Chi tiết thu nhập ký quỹ (order_income) của MỘT đơn theo order_sn. */
  escrowDetail: "/api/v2/payment/get_escrow_detail",
  /** Lịch sử giao dịch ví sàn (rút tiền, phí, giải ngân...) — shop API, READ-ONLY. */
  walletTransactionList: "/api/v2/payment/get_wallet_transaction_list",
  /** Hiệu suất quảng cáo CPC toàn shop theo NGÀY (expense = tiền ads đã tiêu).
   *  LƯU Ý: Ads API có thể cần bật quyền riêng trên Console — lỗi permission
   *  thì liên hệ Shopee mở module Ads cho app. */
  adsAllCpcDaily: "/api/v2/ads/get_all_cpc_ads_daily_performance",

  // ── Trợ lý quảng cáo (GĐ1: toàn bộ READ-ONLY, không có endpoint ghi) ──
  /** DS campaign_id quảng cáo sản phẩm của shop (phân trang offset/limit). */
  adsCampaignIdList: "/api/v2/ads/get_product_level_campaign_id_list",
  /** Cấu hình campaign theo lô ≤100 id (info_type: 1 common, 3 auto bidding). */
  adsCampaignSettingInfo: "/api/v2/ads/get_product_level_campaign_setting_info",
  /** Hiệu suất THEO NGÀY của từng campaign (lô ≤100 id, direct/broad GMV-ROI). */
  adsCampaignDailyPerf: "/api/v2/ads/get_product_campaign_daily_performance",
  /** Hiệu suất THEO GIỜ của từng campaign trong MỘT ngày (cho quy tắc spike GĐ2). */
  adsCampaignHourlyPerf: "/api/v2/ads/get_product_campaign_hourly_performance",
  /** Số dư ví quảng cáo real-time. */
  adsTotalBalance: "/api/v2/ads/get_total_balance",
  /** GĐ3 — endpoint GHI DUY NHẤT: sửa Manual Product Ads (edit_action pause...).
   *  ⚠ enum edit_action CHƯA xác minh từ docs — chỉ gọi ở mode live sau khi
   *  probe trên shop thật xác nhận; mọi lệnh đều ghi sổ AdsActionLog. */
  adsEditManualProductAds: "/api/v2/ads/edit_manual_product_ads",

  // ── Trợ lý vận hành (CSKH): chat + đánh giá ──
  // LƯU Ý: module Chat (sellerchat) có thể cần bật quyền riêng trên Shopee
  // Console giống Ads — lỗi permission trả về nguyên văn để chủ shop biết
  // đường xin mở module.
  /** DS hội thoại chat của shop (phân trang cursor). */
  chatConversationList: "/api/v2/sellerchat/get_conversation_list",
  /** DS tin nhắn của một hội thoại. */
  chatMessages: "/api/v2/sellerchat/get_message",
  /** Gửi tin nhắn tới người mua (POST). */
  chatSendMessage: "/api/v2/sellerchat/send_message",
  /** Upload ảnh chat lên file server Shopee (POST multipart) — lấy url rồi mới send_message kiểu image. */
  chatUploadImage: "/api/v2/sellerchat/upload_image",
  /** DS đánh giá (comment) của shop — item_id bỏ trống là lấy toàn shop. */
  productComments: "/api/v2/product/get_comment",
  /** Trả lời đánh giá (POST, gửi được nhiều comment một lượt). */
  productReplyComment: "/api/v2/product/reply_comment",

  // ── Đối soát đơn hoàn (Returns API + Logistics) ──
  /** DS yêu cầu Trả hàng/Hoàn tiền (return_sn) — lọc được theo update_time.
   *  Đây là nguồn DUY NHẤT thấy được yêu cầu hoàn trên đơn đã COMPLETED
   *  (không đổi order_status nên get_order_list trục update KHÔNG thấy). */
  returnList: "/api/v2/returns/get_return_list",
  /** Mã vận đơn CHIỀU ĐI của một đơn (order detail v2 không còn trả tracking). */
  trackingNumber: "/api/v2/logistics/get_tracking_number",
} as const;

/**
 * Đọc cấu hình Shopee từ biến môi trường. Ném lỗi rõ ràng nếu thiếu — để lộ lỗi
 * cấu hình ngay lúc bấm Kết nối thay vì đẻ ra chữ ký sai khó truy.
 */
export function getShopeeConfig(): ShopeeConfig {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  // Không hardcode host: suy từ URL gốc backend (Render tự bơm RENDER_EXTERNAL_URL)
  // → production trỏ thẳng về domain Render mà không cần đặt env riêng.
  const redirectUri =
    process.env.SHOPEE_REDIRECT_URI ??
    `${getBackendBaseUrl()}/api/auth/shopee/callback`;
  const env: "sandbox" | "production" =
    process.env.SHOPEE_ENV === "production" ? "production" : "sandbox";
  // Cho phép ghi đè host tường minh (nếu Console cấp host khác với mặc định).
  const apiBase = process.env.SHOPEE_API_BASE || SHOPEE_HOSTS[env];

  const missing: string[] = [];
  if (!partnerId) missing.push("SHOPEE_PARTNER_ID");
  if (!partnerKey) missing.push("SHOPEE_PARTNER_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Thiếu cấu hình Shopee trong .env: ${missing.join(", ")}. ` +
        "Điền Partner ID / Partner Key lấy từ Shopee Open Platform Console."
    );
  }

  return { partnerId: partnerId!, partnerKey: partnerKey!, redirectUri, apiBase, env };
}

/** true nếu đã cấu hình đủ để chạy luồng thật (dùng để bật/tắt nút ở API). */
export function isShopeeConfigured(): boolean {
  return Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);
}
