// ============================================================
// CẤU HÌNH KẾT NỐI SHOPEE OPEN PLATFORM (API v2)
//
// App loại "Seller In House System" tạo trên Shopee Open Platform.
// Partner Key KHÔNG được commit — điền trong backend/.env (đã gitignore).
//
// Redirect URI phải nằm dưới ĐÚNG DOMAIN đã đăng ký trên Shopee Console (Shopee
// chỉ kiểm domain của redirect, không kiểm full path). Sandbox đăng ký:
// http://hubsell.tech → thực chạy phải trỏ domain đó về backend này.
// ============================================================

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

// Đường dẫn API cố định (dùng để ghép chữ ký — path là một phần của base string).
export const SHOPEE_PATHS = {
  /** Trang uỷ quyền cho người bán (public API, ký partner_id+path+timestamp). */
  authPartner: "/api/v2/shop/auth_partner",
  /** Đổi code → access_token/refresh_token (public API). */
  tokenGet: "/api/v2/auth/token/get",
  /** Làm mới access_token bằng refresh_token (public API). */
  accessTokenGet: "/api/v2/auth/access_token/get",
  /** Lấy thông tin gian hàng (shop API, ký thêm access_token+shop_id). */
  shopInfo: "/api/v2/shop/get_shop_info",
} as const;

/**
 * Đọc cấu hình Shopee từ biến môi trường. Ném lỗi rõ ràng nếu thiếu — để lộ lỗi
 * cấu hình ngay lúc bấm Kết nối thay vì đẻ ra chữ ký sai khó truy.
 */
export function getShopeeConfig(): ShopeeConfig {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  const redirectUri =
    process.env.SHOPEE_REDIRECT_URI ??
    "http://localhost:4000/api/auth/shopee/callback";
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
