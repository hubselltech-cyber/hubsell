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
// KHUNG KÉO DỮ LIỆU — phiên sau nối vào DB.
// Chữ ký + endpoint đã sẵn sàng; hiện chỉ trả nguyên phản hồi TikTok để test.
// ============================================================

export interface FetchOrdersParams {
  accessToken: string;
  shopCipher: string;
  /** Lọc theo thời gian tạo đơn (Unix seconds). */
  createTimeGe?: number;
  createTimeLt?: number;
  pageSize?: number;
  /** Con trỏ phân trang TikTok trả về ở lần gọi trước. */
  pageToken?: string;
}

/**
 * KHUNG: tìm đơn hàng của gian. Endpoint /order/202309/orders/search là POST,
 * bộ lọc nằm trong body. Phiên sau: ánh xạ kết quả sang model Order + ghi DB.
 */
export async function fetchOrders(
  params: FetchOrdersParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<unknown> {
  const query: Record<string, string | number> = { page_size: params.pageSize ?? 50 };
  if (params.pageToken) query.page_token = params.pageToken;

  const body: Record<string, unknown> = {};
  if (params.createTimeGe) body.create_time_ge = params.createTimeGe;
  if (params.createTimeLt) body.create_time_lt = params.createTimeLt;

  return callApi<unknown>(
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

export interface FetchSettlementsParams {
  accessToken: string;
  shopCipher: string;
  pageSize?: number;
  pageToken?: string;
}

/**
 * KHUNG: kéo bản kê đối soát/dòng tiền (statements) để dựng Báo cáo dòng tiền
 * bằng SỐ THẬT thay cho mockSettlement. Phiên sau: ánh xạ sang settlement của đơn.
 */
export async function fetchSettlements(
  params: FetchSettlementsParams,
  cfg: TikTokConfig = getTikTokConfig()
): Promise<unknown> {
  const query: Record<string, string | number> = {
    page_size: params.pageSize ?? 50,
    sort_field: "statement_time",
  };
  if (params.pageToken) query.page_token = params.pageToken;

  return callApi<unknown>(
    {
      path: "/finance/202309/statements",
      accessToken: params.accessToken,
      shopCipher: params.shopCipher,
      query,
    },
    cfg
  );
}
