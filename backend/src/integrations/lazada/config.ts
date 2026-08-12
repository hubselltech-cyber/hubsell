// ============================================================
// CẤU HÌNH KẾT NỐI LAZADA OPEN PLATFORM
//
// App loại "Seller In-house APP" tạo trên open.lazada.com.
// App Key / App Secret KHÔNG được commit — điền trong backend/.env (đã gitignore).
//
// Callback URL phải TRÙNG KHỚP tuyệt đối với URL khai trong App Console.
// Redirect OAuth chạy trong trình duyệt người bán (Lazada không gọi tới server),
// nên local dùng lại mẹo hosts hubsell.tech → 127.0.0.1 (cổng HTTP phụ :80)
// y hệt luồng Shopee.
//
// LƯU Ý: khung này dựng SẴN CHỜ app được duyệt — endpoint/chữ ký ghi theo tài
// liệu Lazada, CHƯA kiểm chứng bằng request thật. Khi có App Key/Secret phải
// test lại từng bước (như đã làm với sandbox Shopee) trước khi tin.
// ============================================================

export interface LazadaConfig {
  /** App Key của app (client_id trong luồng OAuth). */
  appKey: string;
  /** App Secret — bí mật để ký HMAC-SHA256. */
  appSecret: string;
  /** URL Lazada chuyển hướng về (kèm ?code=) sau khi người bán đồng ý uỷ quyền. */
  redirectUri: string;
}

// Các endpoint cố định của Lazada Open Platform.
export const LAZADA_ENDPOINTS = {
  /** Trang uỷ quyền hiển thị cho người bán (đăng nhập Seller Center rồi đồng ý). */
  authorize: "https://auth.lazada.com/oauth/authorize",
  /** Máy chủ xác thực: đổi code → token và refresh token (path /auth/token/*). */
  auth: "https://auth.lazada.com/rest",
  /** Máy chủ API nghiệp vụ cho thị trường Việt Nam: đơn hàng, sản phẩm, tài chính... */
  api: "https://api.lazada.vn/rest",
} as const;

// Đường dẫn API cố định (path là một phần của chuỗi ký — xem client sau này).
export const LAZADA_PATHS = {
  /** Đổi authorization code → access_token/refresh_token (host auth). */
  tokenCreate: "/auth/token/create",
  /** Làm mới access_token bằng refresh_token (host auth). */
  tokenRefresh: "/auth/token/refresh",
  /** Thông tin gian hàng — dùng làm request "hello world" kiểm chữ ký. */
  sellerGet: "/seller/get",
  /** Danh sách đơn trong khoảng thời gian (phân trang offset/limit ≤100). */
  orderList: "/orders/get",
  /** Chi tiết MỘT đơn theo order_id — dùng cho webhook đơn real-time. */
  orderGet: "/order/get",
  /** Dòng hàng của NHIỀU đơn một lượt (≤50 order_id/lần). */
  orderItemsGet: "/orders/items/get",
  /** Danh sách sản phẩm của shop (phân trang offset/limit ≤50). */
  productsGet: "/products/get",
  /** Sao kê giao dịch tài chính CHI TIẾT theo dòng phí (Finance API, READ-ONLY). */
  transactionDetails: "/finance/transaction/details/get",
  /** Danh sách ĐỢT CHI TIỀN (payout) về ngân hàng theo kỳ sao kê (READ-ONLY). */
  payoutStatus: "/finance/payout/status/get",

  // ── Trợ lý vận hành (CSKH) — path đã ĐỐI CHIẾU tài liệu open.lazada.com 07/08/2026 ──
  /** Đánh giá của MỘT sản phẩm (item_id BẮT BUỘC — Lazada không có list toàn shop). */
  reviewList: "/review/seller/list",
  /** Trả lời một đánh giá (id + content ≤500 ký tự). */
  reviewReplyAdd: "/review/seller/reply/add",
  /** DS hội thoại chat (start_time=now ms, phân trang last_session_id). */
  imSessionList: "/im/session/list",
  /** DS tin nhắn một hội thoại (session_id + start_time=now ms). */
  imMessageList: "/im/message/list",
  /** Gửi tin nhắn (POST; template_id=1 là text). */
  imMessageSend: "/im/message/send",

  // ── Trợ lý quảng cáo — Sponsored Solutions API (đối chiếu docs + PROBE THẬT
  // 12/08/2026 trên 2 shop: app có sẵn quyền, không cần xin thêm ở Console) ──
  /** DS campaign kèm cờ trạng thái (ví cạn/hết ngân sách ngày) + tổng hiệu suất. */
  adsCampaignList: "/sponsor/solutions/campaign/searchCampaignList",
  /** DS adgroup của MỘT campaign — mỗi adgroup là MỘT sản phẩm (có itemId). */
  adsAdgroupList: "/sponsor/solutions/adgroup/searchAdgroupList",
  /** Báo cáo hiệu suất cấp campaign theo KHOẢNG NGÀY (2 rổ store/product). */
  adsReportCampaign: "/sponsor/solutions/report/getDiscoveryReportCampaign",
  /** Báo cáo hiệu suất TỪNG TỪ KHÓA (kèm maxBid) — Shopee KHÔNG có API này. */
  adsReportKeyword: "/sponsor/solutions/report/getDiscoveryReportKeyword",
  /** GHI DUY NHẤT của Trợ lý (GĐ3): bật/tắt campaign + đổi ngân sách ngày.
   *  switchStatus 1:Online 0:Offline — CÓ TRONG DOCS chính thức (khác Shopee
   *  phải probe enum edit_action). */
  adsCampaignUpdate: "/sponsor/solutions/campaign/updateCampaign",
} as const;

/**
 * bizCode bắt buộc của mọi API Sponsored Solutions. Docs chỉ công bố duy nhất
 * "sponsoredSearch" (phủ placement N Sponsored Search + J Sponsored Product);
 * format Sponsored Max mới của Lazada CHƯA chắc lộ qua Open API — xem ghi chú
 * khảo sát 12/08/2026 trong memory hubsell-ads-assistant.
 */
export const LAZADA_ADS_BIZ_CODE = "sponsoredSearch";

/**
 * Đọc cấu hình Lazada từ biến môi trường. Ném lỗi rõ ràng nếu thiếu — để lỗi
 * cấu hình lộ ra ngay lúc bấm Kết nối, thay vì đẻ ra chữ ký sai khó truy vết.
 */
export function getLazadaConfig(): LazadaConfig {
  const appKey = process.env.LAZADA_APP_KEY;
  const appSecret = process.env.LAZADA_APP_SECRET;
  const redirectUri =
    process.env.LAZADA_REDIRECT_URI ??
    "http://hubsell.tech/api/auth/lazada/callback";

  const missing: string[] = [];
  if (!appKey) missing.push("LAZADA_APP_KEY");
  if (!appSecret) missing.push("LAZADA_APP_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Thiếu cấu hình Lazada trong .env: ${missing.join(", ")}. ` +
        "Điền App Key / App Secret lấy từ Lazada Open Platform Console."
    );
  }

  return { appKey: appKey!, appSecret: appSecret!, redirectUri };
}

/**
 * Dựng URL trang uỷ quyền cho người bán. `state` là chuỗi ngẫu nhiên chống
 * CSRF, Lazada trả lại nguyên vẹn ở callback để đối chiếu. `force_auth=true`
 * buộc hiện màn đồng ý kể cả khi người bán đã uỷ quyền trước đó — tiện khi
 * nối lại gian hàng.
 */
export function buildAuthorizeUrl(
  state: string,
  cfg: LazadaConfig = getLazadaConfig()
): string {
  const qs = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: cfg.redirectUri,
    client_id: cfg.appKey,
    state,
  }).toString();
  return `${LAZADA_ENDPOINTS.authorize}?${qs}`;
}

/** true nếu đã cấu hình đủ để chạy luồng thật (dùng để bật/tắt nút ở API). */
export function isLazadaConfigured(): boolean {
  return Boolean(process.env.LAZADA_APP_KEY && process.env.LAZADA_APP_SECRET);
}
