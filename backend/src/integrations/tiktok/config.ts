// ============================================================
// CẤU HÌNH KẾT NỐI TIKTOK SHOP API (bản 202309)
//
// App "Dịch vụ tùy chỉnh" (self/custom app) tạo trên TikTok Shop Partner Center.
// App Key / App Secret KHÔNG được commit — điền trong backend/.env (đã gitignore).
//
// Redirect URI phải TRÙNG KHỚP tuyệt đối với cấu hình trên Partner Center, kể cả
// dấu "/". Ở local: https://localhost:3000/channels/tiktok/callback
// ============================================================

export interface TikTokConfig {
  appKey: string;
  appSecret: string;
  /** service_id của app — dùng để dựng URL uỷ quyền phía người bán. */
  serviceId: string;
  /** URL TikTok chuyển hướng về sau khi người bán bấm "Uỷ quyền". */
  redirectUri: string;
}

// Các endpoint cố định của TikTok Shop Open Platform.
export const TIKTOK_ENDPOINTS = {
  /**
   * Trang uỷ quyền hiển thị cho người bán (Seller authorization page).
   *
   * Với shop nội địa VN, TikTok tự route về
   * `seller-vn.tiktok.com/services/market/custom-authorize/{service_id}`.
   *
   * LƯU Ý: lỗi "không khả dụng tại khu vực" KHÔNG do URL này quyết định. TikTok
   * chèn `region_check=1` + `shop_region=VN` + `target_countries=...` (thị trường
   * app cấu hình ở Partner Center) rồi tự so — nếu VN không nằm trong
   * `target_countries` thì chặn. Đây là cấu hình app, không sửa được từ code.
   */
  authorize: "https://services.tiktokshop.com/open/authorize",
  /** Máy chủ xác thực: đổi auth_code → token và refresh token. */
  auth: "https://auth.tiktok-shops.com",
  /** Máy chủ API nghiệp vụ: đơn hàng, tài chính, sản phẩm... */
  api: "https://open-api.tiktokglobalshop.com",
} as const;

/**
 * Đọc cấu hình TikTok từ biến môi trường. Ném lỗi rõ ràng nếu thiếu — để lỗi
 * cấu hình lộ ra ngay lúc bấm Kết nối, thay vì đẻ ra chữ ký sai khó truy vết.
 */
export function getTikTokConfig(): TikTokConfig {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const serviceId = process.env.TIKTOK_SERVICE_ID;
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ??
    "https://localhost:3000/channels/tiktok/callback";

  const missing: string[] = [];
  if (!appKey) missing.push("TIKTOK_APP_KEY");
  if (!appSecret) missing.push("TIKTOK_APP_SECRET");
  if (!serviceId) missing.push("TIKTOK_SERVICE_ID");

  if (missing.length > 0) {
    throw new Error(
      `Thiếu cấu hình TikTok Shop trong .env: ${missing.join(", ")}. ` +
        "Điền App Key / App Secret / Service ID lấy từ Partner Center."
    );
  }

  return {
    appKey: appKey!,
    appSecret: appSecret!,
    serviceId: serviceId!,
    redirectUri,
  };
}

/**
 * Dựng URL trang uỷ quyền hiển thị cho người bán. Redirect URI KHÔNG truyền ở
 * đây — TikTok lấy đúng URI đã đăng ký trong Partner Center. `state` là chuỗi
 * ngẫu nhiên chống CSRF, sẽ được TikTok trả lại nguyên vẹn ở callback để đối chiếu.
 *
 * `service_id` định danh app; `app_type=custom` đánh dấu luồng Custom App. Việc
 * shop VN uỷ quyền được hay không phụ thuộc `target_countries` của app ở Partner
 * Center (phải chứa Vietnam), KHÔNG phụ thuộc các tham số dựng ở đây.
 */
export function buildAuthorizeUrl(
  state: string,
  cfg: TikTokConfig = getTikTokConfig()
): string {
  const qs = new URLSearchParams({
    service_id: cfg.serviceId,
    app_type: "custom",
    state,
  }).toString();
  return `${TIKTOK_ENDPOINTS.authorize}?${qs}`;
}

/**
 * TikTok trả thời hạn token dưới dạng SỐ GIÂY. Field có thể là mốc tuyệt đối
 * (epoch) hoặc khoảng thời gian tính từ hiện tại tuỳ phiên bản — phân biệt bằng
 * ngưỡng 10^9 (mọi epoch hợp lệ đều lớn hơn, mọi khoảng ~ vài ngày đều nhỏ hơn).
 */
export function expireToDate(seconds: number): Date {
  const epochSeconds =
    seconds > 1_000_000_000 ? seconds : Math.floor(Date.now() / 1000) + seconds;
  return new Date(epochSeconds * 1000);
}

/** true nếu đã cấu hình đủ để chạy luồng thật (dùng để bật/tắt nút ở API). */
export function isTikTokConfigured(): boolean {
  return Boolean(
    process.env.TIKTOK_APP_KEY &&
      process.env.TIKTOK_APP_SECRET &&
      process.env.TIKTOK_SERVICE_ID
  );
}
