// ============================================================
// TIKTOK SHOP API CLIENT (bản 202309)
//
// Gói toàn bộ phần "khó" của tích hợp TikTok Shop vào một chỗ:
//   1) Ký request (HMAC-SHA256) — mọi call API nghiệp vụ đều phải ký đúng.
//   2) Đổi auth_code → access_token / refresh_token (OAuth2).
//   3) Lấy danh sách gian hàng đã uỷ quyền + shop_cipher.
//   4) KHUNG kéo Đơn hàng & Đối soát (chưa ghi vào DB — để phiên sau).
//
// Route và phần còn lại của hệ thống chỉ gọi các hàm ở đây, không tự dựng
// chữ ký hay ghép URL — giữ một nguồn sự thật duy nhất cho quy tắc ký của TikTok.
// ============================================================

import crypto from "crypto";
import { getTikTokConfig, TIKTOK_ENDPOINTS, type TikTokConfig } from "./config";

// ---------- Kiểu dữ liệu TikTok trả về ----------

/** Bao ngoài chuẩn của mọi phản hồi TikTok Shop: code=0 là thành công. */
interface TikTokEnvelope<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

export interface TikTokTokenData {
  access_token: string;
  /** Thời điểm access_token hết hạn — GIÂY kể từ epoch (Unix seconds). */
  access_token_expire_in: number;
  refresh_token: string;
  refresh_token_expire_in: number;
  open_id?: string;
  seller_name?: string;
}

export interface TikTokAuthorizedShop {
  id: string; // shop_id phía TikTok
  name: string; // tên gian hàng
  region: string; // ví dụ: VN
  seller_type?: string;
  /** shop_cipher — BẮT BUỘC gửi kèm mọi request API 202309 của gian này. */
  cipher: string;
  code?: string;
}

// ---------- Ký request ----------

/**
 * Sinh chữ ký HMAC-SHA256 theo đúng thuật toán của TikTok Shop Open API:
 *   1. Loại 2 tham số `sign` và `access_token` khỏi danh sách query.
 *   2. Sắp xếp các tham số còn lại theo tên (a→z).
 *   3. Nối liền: path + (key+value cho từng tham số đã sắp xếp).
 *   4. Với body JSON (POST/PUT): nối tiếp chuỗi body thô vào cuối.
 *   5. Bọc hai đầu bằng app_secret rồi HMAC-SHA256 bằng chính app_secret → hex.
 *
 * `path` là đường dẫn API (vd "/authorization/202309/shops"), KHÔNG kèm host.
 */
export function signRequest(
  appSecret: string,
  path: string,
  query: Record<string, string | number>,
  body?: string
): string {
  const keys = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();

  let input = path;
  for (const k of keys) input += k + query[k];
  if (body) input += body;

  const wrapped = `${appSecret}${input}${appSecret}`;
  return crypto.createHmac("sha256", appSecret).update(wrapped).digest("hex");
}

/**
 * XÁC THỰC CHỮ KÝ WEBHOOK của TikTok Shop (khác cách ký request API ở trên).
 *
 * TikTok ký payload webhook bằng: HMAC-SHA256( app_key + rawBody , app_secret ) → hex,
 * đặt trong header `Authorization`. Ta tính lại trên THÂN REQUEST THÔ (nguyên văn
 * chuỗi JSON nhận được — không được serialize lại vì thứ tự/khoảng trắng đổi là
 * sai chữ ký) rồi so khớp theo kiểu hằng-thời-gian để chống dò chữ ký.
 *
 * @param rawBody chuỗi body thô đúng nguyên văn TikTok gửi.
 * @param signature giá trị header `Authorization`.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  cfg: TikTokConfig = getTikTokConfig()
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", cfg.appSecret)
    .update(`${cfg.appKey}${rawBody}`)
    .digest("hex");

  // So khớp hằng-thời-gian; timingSafeEqual ném lỗi nếu độ dài lệch nên bọc try.
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------- Gọi máy chủ xác thực (token) ----------
// Các endpoint token KHÔNG cần chữ ký — chỉ cần app_key + app_secret trong query.

async function callAuth<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${TIKTOK_ENDPOINTS.auth}${path}?${qs}`;
  const res = await fetch(url, { method: "GET" });
  const json = (await res.json()) as TikTokEnvelope<T>;
  if (json.code !== 0) {
    throw new Error(
      `TikTok auth lỗi (code ${json.code}): ${json.message || "không rõ"}`
    );
  }
  return json.data;
}

/** Đổi auth_code (nhận được sau khi người bán uỷ quyền) lấy bộ token. */
export async function getAccessToken(
  authCode: string,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokTokenData> {
  return callAuth<TikTokTokenData>("/api/v2/token/get", {
    app_key: cfg.appKey,
    app_secret: cfg.appSecret,
    auth_code: authCode,
    grant_type: "authorized_code",
  });
}

/** Làm mới access_token bằng refresh_token trước khi nó hết hạn. */
export async function refreshAccessToken(
  refreshToken: string,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokTokenData> {
  return callAuth<TikTokTokenData>("/api/v2/token/refresh", {
    app_key: cfg.appKey,
    app_secret: cfg.appSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

// ---------- Gọi máy chủ API nghiệp vụ (có ký) ----------

interface ApiCallOptions {
  method?: "GET" | "POST" | "PUT";
  path: string; // vd "/order/202309/orders/search"
  accessToken: string;
  shopCipher?: string; // đa số API 202309 bắt buộc
  /** Tham số query nghiệp vụ (ngoài app_key/timestamp/sign/shop_cipher). */
  query?: Record<string, string | number>;
  /** Payload body cho POST/PUT — sẽ được JSON.stringify và ký kèm. */
  body?: unknown;
}

/**
 * Gọi một endpoint API nghiệp vụ của TikTok Shop: tự ghép app_key, timestamp,
 * shop_cipher, ký chữ ký, gắn header access_token rồi bóc lớp bao chuẩn.
 */
export async function callApi<T>(
  opts: ApiCallOptions,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<T> {
  const method = opts.method ?? "GET";
  const timestamp = Math.floor(Date.now() / 1000);

  const query: Record<string, string | number> = {
    app_key: cfg.appKey,
    timestamp,
    ...(opts.shopCipher ? { shop_cipher: opts.shopCipher } : {}),
    ...(opts.query ?? {}),
  };

  const bodyStr =
    opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

  query.sign = signRequest(cfg.appSecret, opts.path, query, bodyStr);

  const qs = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)] as [string, string])
  ).toString();
  const url = `${TIKTOK_ENDPOINTS.api}${opts.path}?${qs}`;

  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-tts-access-token": opts.accessToken,
    },
    body: bodyStr,
  });

  const json = (await res.json()) as TikTokEnvelope<T>;
  if (json.code !== 0) {
    throw new Error(
      `TikTok API lỗi (code ${json.code}): ${json.message || "không rõ"}`
    );
  }
  return json.data;
}

// ---------- Sau uỷ quyền: lấy gian hàng + shop_cipher ----------

/**
 * Lấy danh sách gian hàng mà access_token này được phép thao tác, kèm
 * shop_cipher của từng gian. Gọi NGAY sau khi có token vì mọi API nghiệp vụ
 * về sau đều cần shop_cipher.
 */
export async function getAuthorizedShops(
  accessToken: string,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokAuthorizedShop[]> {
  const data = await callApi<{ shops: TikTokAuthorizedShop[] }>(
    { path: "/authorization/202309/shops", accessToken },
    cfg
  );
  return data.shops ?? [];
}

// ============================================================
// KÉO ĐƠN HÀNG (Order API 202309)
//
// Tên trường ĐÃ ĐỐI CHIẾU với payload thật của shop and.not.or ngày 16/09/2026
// (log "[TikTok] Hình dạng đơn"): trạng thái nằm ở `status` (KHÔNG phải
// `order_status` như bản nháp theo docs); mỗi line_item là MỘT đơn vị (không có
// quantity); phí ship/giảm giá nằm trong `payment`; kiện hàng ở `packages`.
// ============================================================

/** Một dòng hàng trong đơn TikTok — 202309 mỗi phần tử là MỘT đơn vị. */
export interface TikTokLineItem {
  id: string;
  product_id?: string;
  product_name?: string;
  sku_id?: string;
  seller_sku?: string;
  /** Tên phân loại ("Đen, XL") — ghép sau tên sản phẩm như model_name Shopee. */
  sku_name?: string;
  sku_type?: string;
  sku_image?: string;
  /** Giá bán một đơn vị (chuỗi số). */
  sale_price?: string;
  original_price?: string;
  seller_discount?: string;
  platform_discount?: string;
  currency?: string;
  /** Trạng thái riêng của dòng (UNPAID/AWAITING_SHIPMENT/…/CANCELLED). */
  display_status?: string;
  package_id?: string;
  package_status?: string;
  tracking_number?: string;
  shipping_provider_id?: string;
  shipping_provider_name?: string;
  is_gift?: boolean;
  /** Không có trong payload thật 16/09 — giữ để tương thích nếu sàn thêm sau. */
  quantity?: number;
}

export interface TikTokOrderPayment {
  currency?: string;
  /** Khách trả tổng cộng (đã gồm ship, trừ giảm giá). */
  total_amount?: string;
  sub_total?: string;
  original_total_product_price?: string;
  /** Phí ship khách trả sau giảm. */
  shipping_fee?: string;
  original_shipping_fee?: string;
  shipping_fee_seller_discount?: string;
  shipping_fee_platform_discount?: string;
  shipping_fee_cofunded_discount?: string;
  /** Giảm giá do SHOP chịu (voucher shop) / do SÀN chịu. */
  seller_discount?: string;
  platform_discount?: string;
  tax?: string;
}

export interface TikTokRecipientAddress {
  name?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  full_address?: string;
  address_detail?: string;
  address_line1?: string;
  postal_code?: string;
  region_code?: string;
  district_info?: { address_level_name?: string; address_name?: string; address_level?: string }[];
}

export interface TikTokOrder {
  id: string;
  /** Trạng thái đơn — TÊN THẬT là `status` (UNPAID / ON_HOLD / AWAITING_SHIPMENT /
   *  AWAITING_COLLECTION / PARTIALLY_SHIPPING / IN_TRANSIT / DELIVERED /
   *  COMPLETED / CANCELLED). `order_status` chỉ có trong payload WEBHOOK. */
  status?: string;
  order_status?: string;
  create_time?: number; // Unix seconds
  update_time?: number;
  paid_time?: number;
  delivery_time?: number;
  collection_time?: number;
  rts_time?: number;
  /** Hạn SÀN bắt bàn giao (Unix seconds) — quá là đơn bị hủy/phạt. */
  shipping_due_time?: number;
  collection_due_time?: number;
  rts_sla_time?: number;
  tts_sla_time?: number;
  cancel_order_sla_time?: number;
  cancel_reason?: string;
  cancel_time?: number;
  cancellation_initiator?: string;
  payment?: TikTokOrderPayment;
  payment_method_name?: string;
  is_cod?: boolean;
  is_on_hold_order?: boolean;
  is_sample_order?: boolean;
  is_replacement_order?: boolean;
  buyer_message?: string;
  buyer_email?: string;
  user_id?: string;
  recipient_address?: TikTokRecipientAddress;
  tracking_number?: string;
  shipping_provider?: string;
  shipping_provider_id?: string;
  /** "TIKTOK" = sàn điều vận (platform logistics) / "SELLER" = shop tự giao. */
  shipping_type?: string;
  fulfillment_type?: string;
  /** Tên phương thức giao người mua chọn ("Standard shipping", "Hỏa tốc",
   *  "Giao Trong Ngày"…) — nguồn DUY NHẤT nhận diện hỏa tốc khi hãng là J&T
   *  giao thường (payload thật 16/09: "Standard shipping" + "J&T Express"). */
  delivery_option_name?: string;
  delivery_option_id?: string;
  delivery_type?: string;
  warehouse_id?: string;
  /** Kiện hàng — id dùng cho API in vận đơn (fulfillment/202309/packages). */
  packages?: { id: string }[];
  line_items?: TikTokLineItem[];
}

export interface TikTokOrderSearchData {
  total_count?: number;
  next_page_token?: string;
  orders?: TikTokOrder[];
}

export interface FetchOrdersParams {
  accessToken: string;
  shopCipher: string;
  /** Lọc theo thời gian tạo đơn (Unix seconds). */
  createTimeGe?: number;
  createTimeLt?: number;
  /** Lọc theo thời gian CẬP NHẬT (Unix seconds) — worker quét tự động dùng trục
   *  này để bắt cả đơn cũ vừa đổi trạng thái (hủy/hoàn), như Shopee/Lazada. */
  updateTimeGe?: number;
  updateTimeLt?: number;
  pageSize?: number;
  /** Con trỏ phân trang TikTok trả về ở lần gọi trước. */
  pageToken?: string;
}

/**
 * Tìm đơn hàng của gian. Endpoint /order/202309/orders/search là POST, bộ lọc
 * thời gian nằm trong body; page_size/page_token nằm trên query.
 */
export async function fetchOrders(
  params: FetchOrdersParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokOrderSearchData> {
  const query: Record<string, string | number> = { page_size: params.pageSize ?? 50 };
  if (params.pageToken) query.page_token = params.pageToken;

  const body: Record<string, unknown> = {};
  if (params.createTimeGe) body.create_time_ge = params.createTimeGe;
  if (params.createTimeLt) body.create_time_lt = params.createTimeLt;
  if (params.updateTimeGe) body.update_time_ge = params.updateTimeGe;
  if (params.updateTimeLt) body.update_time_lt = params.updateTimeLt;

  return callApi<TikTokOrderSearchData>(
    {
      method: "POST",
      path: "/order/202309/orders/search",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query,
      body,
    },
    cfg
  );
}

export interface FetchOrderDetailParams {
  accessToken: string;
  shopCipher: string;
  /** Tối đa 50 id/lần theo giới hạn TikTok. */
  orderIds: string[];
}

/**
 * Lấy CHI TIẾT đầy đủ của một/nhiều đơn theo id. Webhook đổi trạng thái chỉ gửi
 * order_id + trạng thái mới, nên phải gọi hàm này để có line_items/địa chỉ… rồi
 * mới upsert được như luồng đồng bộ.
 *
 * Endpoint GET /order/202309/orders nhận `ids` là danh sách ngăn cách bằng dấu phẩy.
 */
export async function getOrderDetail(
  params: FetchOrderDetailParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokOrder[]> {
  const data = await callApi<TikTokOrderSearchData>(
    {
      path: "/order/202309/orders",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query: { ids: params.orderIds.join(",") },
    },
    cfg
  );
  return data.orders ?? [];
}

// ============================================================
// KÉO ĐỐI SOÁT / DÒNG TIỀN (Finance API 202309)
//
// Hai tầng: statements (bản kê giải ngân theo đợt) → statement_transactions
// (chi tiết TỪNG ĐƠN trong một bản kê, có order_id + settlement_amount).
// ============================================================

export interface TikTokStatement {
  id: string;
  statement_time?: number; // Unix seconds
  currency?: string;
  settlement_amount?: string;
  revenue_amount?: string;
  fee_amount?: string;
  adjustment_amount?: string;
  payment_status?: string;
}

export interface TikTokStatementListData {
  next_page_token?: string;
  total_count?: number;
  statements?: TikTokStatement[];
}

export interface TikTokStatementTransaction {
  id?: string;
  order_id?: string;
  order_create_time?: number;
  type?: string;
  currency?: string;
  /** Doanh thu ghi nhận cho đơn (chuỗi số). */
  revenue_amount?: string;
  /** Phí TikTok khấu trừ — thường là số ÂM. */
  fee_amount?: string;
  shipping_cost_amount?: string;
  /** Tiền THỰC NHẬN về ví cho đơn này. */
  settlement_amount?: string;
  adjustment_amount?: string;
}

export interface TikTokStatementTransactionData {
  next_page_token?: string;
  statement_transactions?: TikTokStatementTransaction[];
}

export interface FetchSettlementsParams {
  accessToken: string;
  shopCipher: string;
  /** Chỉ lấy bản kê từ mốc này (Unix seconds) — worker giờ quét cửa sổ hẹp. */
  statementTimeGe?: number;
  statementTimeLt?: number;
  pageSize?: number;
  pageToken?: string;
}

/**
 * Kéo danh sách bản kê giải ngân (statements). Từng bản kê sau đó được bóc chi
 * tiết theo đơn qua {@link fetchStatementTransactions}.
 */
export async function fetchSettlements(
  params: FetchSettlementsParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokStatementListData> {
  const query: Record<string, string | number> = {
    page_size: params.pageSize ?? 50,
    sort_field: "statement_time",
  };
  if (params.statementTimeGe) query.statement_time_ge = params.statementTimeGe;
  if (params.statementTimeLt) query.statement_time_lt = params.statementTimeLt;
  if (params.pageToken) query.page_token = params.pageToken;

  return callApi<TikTokStatementListData>(
    {
      path: "/finance/202309/statements",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query,
    },
    cfg
  );
}

export interface FetchStatementTransactionsParams {
  accessToken: string;
  shopCipher: string;
  statementId: string;
  pageSize?: number;
  pageToken?: string;
}

/**
 * Bóc chi tiết TỪNG ĐƠN trong một bản kê — đây là nơi có `order_id` +
 * `settlement_amount` để cập nhật số quyết toán thực tế cho từng Order.
 */
export async function fetchStatementTransactions(
  params: FetchStatementTransactionsParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokStatementTransactionData> {
  // sort_field BẮT BUỘC (lỗi thật 36009004 ngày 16/09: "SortField is a required
  // field") — sắp theo thời điểm tạo đơn để phân trang ổn định.
  const query: Record<string, string | number> = {
    page_size: params.pageSize ?? 50,
    sort_field: "order_create_time",
    sort_order: "DESC",
  };
  if (params.pageToken) query.page_token = params.pageToken;

  return callApi<TikTokStatementTransactionData>(
    {
      path: `/finance/202309/statements/${params.statementId}/statement_transactions`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query,
    },
    cfg
  );
}

// ============================================================
// BẢN KÊ THEO ĐƠN (Finance API 202309) — bóc tách phí từng đơn
//
// GET /finance/202309/orders/{order_id}/statement_transactions: trả các dòng
// giao dịch của MỘT đơn kèm breakdown doanh thu / phí / ship (tên trường con
// đối chiếu qua log "[TikTok] Hình dạng" khi chạy thật — parser phòng thủ).
// ============================================================

export interface TikTokOrderStatementTransaction extends TikTokStatementTransaction {
  revenue_breakdown?: Record<string, string | undefined>;
  fee_breakdown?: Record<string, string | undefined>;
  shipping_cost_breakdown?: Record<string, string | undefined>;
  [k: string]: unknown;
}

export async function getOrderStatementTransactions(
  params: { accessToken: string; shopCipher: string; orderId: string },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokOrderStatementTransaction[]> {
  const data = await callApi<{ statement_transactions?: TikTokOrderStatementTransaction[] }>(
    {
      path: `/finance/202309/orders/${params.orderId}/statement_transactions`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
    },
    cfg
  );
  return data.statement_transactions ?? [];
}

// ============================================================
// ĐỢT CHI TIỀN VỀ NGÂN HÀNG (Finance API 202309 — payments)
//
// GET /finance/202309/payments: mỗi dòng = một lần TikTok chuyển tiền về tài
// khoản ngân hàng của shop (status PROCESSING/PAID/FAILED). Read-only.
// ============================================================

export interface TikTokPayment {
  id: string;
  create_time?: number; // Unix seconds
  paid_time?: number;
  status?: string; // PROCESSING | PAID | FAILED
  amount?: { value?: string; currency?: string };
  settlement_amount?: { value?: string; currency?: string };
  reserve_amount?: { value?: string; currency?: string };
  payment_amount_before_exchange?: { value?: string; currency?: string };
  bank_account?: string;
  [k: string]: unknown;
}

export interface FetchPaymentsParams {
  accessToken: string;
  shopCipher: string;
  createTimeGe?: number;
  createTimeLt?: number;
  pageSize?: number;
  pageToken?: string;
}

export async function fetchPayments(
  params: FetchPaymentsParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<{ payments: TikTokPayment[]; next_page_token?: string }> {
  const query: Record<string, string | number> = {
    page_size: params.pageSize ?? 50,
    sort_field: "create_time",
    sort_order: "DESC",
  };
  if (params.createTimeGe) query.create_time_ge = params.createTimeGe;
  if (params.createTimeLt) query.create_time_lt = params.createTimeLt;
  if (params.pageToken) query.page_token = params.pageToken;
  return callApi<{ payments?: TikTokPayment[]; next_page_token?: string }>(
    {
      path: "/finance/202309/payments",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query,
    },
    cfg
  ).then((d) => ({ payments: d.payments ?? [], next_page_token: d.next_page_token }));
}

// ============================================================
// HOÀN / TRẢ (Return & Refund API 202309) — READ-ONLY
//
// POST /return_refund/202309/returns/search: yêu cầu hoàn/trả của shop (khách
// mở sau khi nhận hàng hoặc đang giao). Mỗi return_line_item = MỘT đơn vị
// hàng (cùng quy ước line_items của đơn). Enum return_status theo docs:
// RETURN_OR_REFUND_REQUEST_PENDING, REFUND_OR_RETURN_REQUEST_REJECT,
// AWAITING_BUYER_SHIP, BUYER_SHIPPED_ITEM, REJECT_RECEIVE_PACKAGE,
// RETURN_OR_REFUND_REQUEST_SUCCESS, RETURN_OR_REFUND_REQUEST_CANCEL,
// RETURN_OR_REFUND_REQUEST_COMPLETE, REPLACEMENT_REQUEST_PENDING… — tầng
// returns-sync chỉ nhận diện CHẾT qua REJECT/CANCEL, XONG qua SUCCESS/COMPLETE.
// ============================================================

export interface TikTokRefundAmount {
  currency?: string;
  refund_total?: string;
  refund_subtotal?: string;
  refund_shipping_fee?: string;
  refund_tax?: string;
  [k: string]: unknown;
}

export interface TikTokReturnLineItem {
  return_line_item_id?: string;
  order_line_item_id?: string;
  sku_id?: string;
  seller_sku?: string;
  product_name?: string;
  sku_name?: string;
  product_image?: { url?: string };
  refund_amount?: TikTokRefundAmount;
  [k: string]: unknown;
}

export interface TikTokReturnOrder {
  return_id: string;
  order_id?: string;
  /** REFUND | RETURN_AND_REFUND | REPLACEMENT */
  return_type?: string;
  return_status?: string;
  return_reason?: string;
  return_reason_text?: string;
  /** BUYER | SELLER | SYSTEM — ai mở yêu cầu. */
  role?: string;
  create_time?: number;
  update_time?: number;
  refund_amount?: TikTokRefundAmount;
  return_line_items?: TikTokReturnLineItem[];
  return_tracking_number?: string;
  return_provider_name?: string;
  return_provider_id?: string;
  shipment_type?: string;
  [k: string]: unknown;
}

export interface SearchReturnsParams {
  accessToken: string;
  shopCipher: string;
  updateTimeGe?: number;
  updateTimeLt?: number;
  createTimeGe?: number;
  createTimeLt?: number;
  orderIds?: string[];
  pageSize?: number;
  pageToken?: string;
}

export async function searchReturns(
  params: SearchReturnsParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<{ return_orders: TikTokReturnOrder[]; next_page_token?: string }> {
  const query: Record<string, string | number> = {
    page_size: params.pageSize ?? 50,
    sort_field: "update_time",
    sort_order: "DESC",
  };
  if (params.pageToken) query.page_token = params.pageToken;
  const body: Record<string, unknown> = {};
  if (params.updateTimeGe) body.update_time_ge = params.updateTimeGe;
  if (params.updateTimeLt) body.update_time_lt = params.updateTimeLt;
  if (params.createTimeGe) body.create_time_ge = params.createTimeGe;
  if (params.createTimeLt) body.create_time_lt = params.createTimeLt;
  if (params.orderIds?.length) body.order_ids = params.orderIds;
  const d = await callApi<{ return_orders?: TikTokReturnOrder[]; next_page_token?: string }>(
    {
      method: "POST",
      path: "/return_refund/202309/returns/search",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query,
      body,
    },
    cfg
  );
  return { return_orders: d.return_orders ?? [], next_page_token: d.next_page_token };
}

// ============================================================
// THEO DÕI HÀNH TRÌNH GIAO (Fulfillment API 202309)
//
// GET /fulfillment/202309/orders/{order_id}/tracking: mốc vận chuyển của đơn
// (mô tả + thời điểm ms). Nguồn bắt "giao thất bại từng lượt" cho Cứu đơn.
// ============================================================

export interface TikTokTrackingEvent {
  update_time_millis?: number;
  description?: string;
  tracking_event_type?: string;
  [k: string]: unknown;
}

export async function getOrderTracking(
  params: { accessToken: string; shopCipher: string; orderId: string },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokTrackingEvent[]> {
  const d = await callApi<{ tracking?: TikTokTrackingEvent[] }>(
    {
      path: `/fulfillment/202309/orders/${params.orderId}/tracking`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
    },
    cfg
  );
  return d.tracking ?? [];
}

// ============================================================
// KIỆN HÀNG — SẮP XẾP VẬN CHUYỂN + VẬN ĐƠN (Fulfillment API 202309)
// ============================================================

export interface TikTokPackageDetail {
  package_id?: string;
  package_status?: string;
  tracking_number?: string;
  shipping_provider_id?: string;
  shipping_provider_name?: string;
  order_line_item_ids?: string[];
  orders?: { id?: string; skus?: { id?: string; quantity?: number }[] }[];
  create_time?: number;
  update_time?: number;
  [k: string]: unknown;
}

export async function getPackageDetail(
  params: { accessToken: string; shopCipher: string; packageId: string },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokPackageDetail> {
  return callApi<TikTokPackageDetail>(
    {
      path: `/fulfillment/202309/packages/${params.packageId}`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
    },
    cfg
  );
}

export interface TikTokHandoverSlot {
  start_time?: number;
  end_time?: number;
  avaliable?: boolean;
  available?: boolean;
  [k: string]: unknown;
}

/** Khung giờ LSP tới lấy hàng cho một kiện (pickup). */
export async function getHandoverTimeSlots(
  params: { accessToken: string; shopCipher: string; packageId: string },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<{ can_pickup?: boolean; drop_off_option?: boolean; handover_time_slots?: TikTokHandoverSlot[] }> {
  return callApi(
    {
      path: `/fulfillment/202309/packages/${params.packageId}/handover_time_slots`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
    },
    cfg
  );
}

/**
 * Sắp xếp vận chuyển cho MỘT kiện: PICKUP (LSP tới lấy, kèm khung giờ) hoặc
 * DROP_OFF (seller tự mang ra bưu cục). Sàn cấp tracking_number ngay hoặc vài
 * giây sau — adapter probe lại qua getPackageDetail.
 */
export async function shipPackage(
  params: {
    accessToken: string;
    shopCipher: string;
    packageId: string;
    handoverMethod: "PICKUP" | "DROP_OFF";
    pickupSlot?: { start_time: number; end_time: number };
  },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { handover_method: params.handoverMethod };
  if (params.pickupSlot) body.pickup_slot = params.pickupSlot;
  return callApi<Record<string, unknown>>(
    {
      method: "POST",
      path: `/fulfillment/202309/packages/${params.packageId}/ship`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      body,
    },
    cfg
  );
}

/** Vận đơn PDF chính chủ của sàn (A6) — chỉ kiện "TikTok Shipping" đã ship. */
export async function getShippingDocument(
  params: {
    accessToken: string;
    shopCipher: string;
    packageId: string;
    documentType?: "SHIPPING_LABEL" | "PACKING_SLIP" | "SHIPPING_LABEL_AND_PACKING_SLIP";
    documentSize?: "A5" | "A6";
  },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<{ doc_url?: string; [k: string]: unknown }> {
  return callApi(
    {
      path: `/fulfillment/202309/packages/${params.packageId}/shipping_documents`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query: {
        document_type: params.documentType ?? "SHIPPING_LABEL",
        document_size: params.documentSize ?? "A6",
      },
    },
    cfg
  );
}

// ============================================================
// SẢN PHẨM & TỒN KHO (Product API 202309)
//
// POST /product/202309/products/search: danh sách sản phẩm + SKU (seller_sku,
// giá, tồn theo kho). GET /product/202309/products/{id}: chi tiết đủ ảnh +
// thuộc tính phân loại. POST /product/202309/products/{id}/inventory/update:
// ghi tồn TUYỆT ĐỐI theo (sku, warehouse). GET /logistics/202309/warehouses:
// kho bán hàng của shop (mặc định = kho đẩy tồn).
// ============================================================

export interface TikTokProductSku {
  id: string;
  seller_sku?: string;
  price?: { sale_price?: string; tax_exclusive_price?: string; currency?: string; [k: string]: unknown };
  inventory?: { warehouse_id?: string; quantity?: number }[];
  sales_attributes?: { id?: string; name?: string; value_id?: string; value_name?: string; sku_img?: { url?: string } }[];
  [k: string]: unknown;
}

export interface TikTokProduct {
  id: string;
  title?: string;
  status?: string; // ACTIVATE | DEACTIVATE | ... (docs 202309: ALL/DRAFT/PENDING/FAILED/ACTIVATE/SELLER_DEACTIVATED/PLATFORM_DEACTIVATED/FREEZE/DELETED)
  skus?: TikTokProductSku[];
  main_images?: { url?: string; urls?: string[]; thumb_urls?: string[] }[];
  create_time?: number;
  update_time?: number;
  [k: string]: unknown;
}

export interface SearchProductsParams {
  accessToken: string;
  shopCipher: string;
  /** Lọc trạng thái — bỏ trống = tất cả. */
  status?: string;
  pageSize?: number;
  pageToken?: string;
}

export async function searchProducts(
  params: SearchProductsParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<{ products: TikTokProduct[]; next_page_token?: string; total_count?: number }> {
  const query: Record<string, string | number> = { page_size: params.pageSize ?? 100 };
  if (params.pageToken) query.page_token = params.pageToken;
  const body: Record<string, unknown> = {};
  if (params.status) body.status = params.status;
  const d = await callApi<{ products?: TikTokProduct[]; next_page_token?: string; total_count?: number }>(
    {
      method: "POST",
      path: "/product/202309/products/search",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query,
      body,
    },
    cfg
  );
  return { products: d.products ?? [], next_page_token: d.next_page_token, total_count: d.total_count };
}

export async function getProduct(
  params: { accessToken: string; shopCipher: string; productId: string },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokProduct> {
  return callApi<TikTokProduct>(
    {
      path: `/product/202309/products/${params.productId}`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
    },
    cfg
  );
}

export interface TikTokWarehouse {
  id: string;
  name?: string;
  effect_status?: string; // ENABLED | DISABLED
  type?: string; // SALES_WAREHOUSE | RETURN_WAREHOUSE
  sub_type?: string; // DOMESTIC_WAREHOUSE | ...
  is_default?: boolean;
  [k: string]: unknown;
}

export async function getWarehouses(
  params: { accessToken: string; shopCipher: string },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<TikTokWarehouse[]> {
  const d = await callApi<{ warehouses?: TikTokWarehouse[] }>(
    {
      path: "/logistics/202309/warehouses",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
    },
    cfg
  );
  return d.warehouses ?? [];
}

/**
 * Ghi tồn TUYỆT ĐỐI cho một SKU tại một kho. Sàn trả code=0 khi nhận; lỗi
 * (SKU không thuộc sản phẩm, kho sai, thiếu quyền) ném Error để worker retry
 * theo lịch riêng.
 */
export async function updateTiktokInventory(
  params: {
    accessToken: string;
    shopCipher: string;
    productId: string;
    skuId: string;
    warehouseId: string;
    quantity: number;
  },
  cfg: TikTokConfig = getTikTokConfig()
): Promise<void> {
  await callApi(
    {
      method: "POST",
      path: `/product/202309/products/${params.productId}/inventory/update`,
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      body: {
        skus: [
          {
            id: params.skuId,
            inventory: [{ warehouse_id: params.warehouseId, quantity: Math.max(0, Math.trunc(params.quantity)) }],
          },
        ],
      },
    },
    cfg
  );
}
