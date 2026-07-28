// ============================================================
// LAZADA OPEN PLATFORM API CLIENT
//
// Gói phần "khó" của tích hợp Lazada vào một chỗ:
//   1) Ký request (HMAC-SHA256) — MỘT kiểu ký cho mọi API:
//        base = apiPath + concat(key+value của MỌI param, sort theo ASCII)
//        sign = HMAC-SHA256(app_secret, base) → hex CHỮ HOA
//      Khác Shopee: timestamp tính bằng MILI-GIÂY, access_token nằm trong
//      params thường (cũng bị ký) chứ không có kiểu ký riêng cho shop API.
//   2) Đổi code → access_token/refresh_token, và làm mới token (host auth).
//   3) Lấy thông tin người bán (/seller/get) — request "hello world" kiểm chữ ký.
// ============================================================

import crypto from "crypto";
import {
  getLazadaConfig,
  LAZADA_ENDPOINTS,
  LAZADA_PATHS,
  type LazadaConfig,
} from "./config";

// ---------- Ký request ----------

/**
 * Chữ ký Lazada: sort MỌI param (common + nghiệp vụ) theo khoá ASCII, nối
 * key+value liền nhau, thêm apiPath phía trước rồi HMAC-SHA256 → hex CHỮ HOA.
 */
export function signLazada(
  appSecret: string,
  apiPath: string,
  params: Record<string, string>
): string {
  const base =
    apiPath +
    Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join("");
  return crypto
    .createHmac("sha256", appSecret)
    .update(base)
    .digest("hex")
    .toUpperCase();
}

// ---------- Kiểu dữ liệu Lazada trả về ----------

/** Bao ngoài chuẩn của Lazada: `code` "0" là thành công. */
interface LazadaEnvelope {
  code?: string;
  type?: string;
  message?: string;
  request_id?: string;
}

/** Payload token (cả create lẫn refresh) — các trường nằm Ở NGOÀI, không bọc data. */
export interface LazadaTokenData extends LazadaEnvelope {
  access_token?: string;
  refresh_token?: string;
  /** Thời hạn access_token tính bằng GIÂY kể từ hiện tại (app này: 7 ngày). */
  expires_in?: number;
  /** Thời hạn refresh_token tính bằng GIÂY kể từ hiện tại (app này: 30 ngày). */
  refresh_expires_in?: number;
  /** Nước + seller_id của từng thị trường mà tài khoản uỷ quyền. */
  country_user_info?: {
    country?: string;
    user_id?: string;
    seller_id?: string;
    short_code?: string;
  }[];
  /** Email/tài khoản Seller Center đã uỷ quyền. */
  account?: string;
  country?: string;
}

export interface LazadaSellerInfo {
  seller_id?: number | string;
  name?: string;
  short_code?: string;
  email?: string;
  location?: string;
  status?: string;
}

interface LazadaSellerData extends LazadaEnvelope {
  data?: LazadaSellerInfo;
}

function ensureOk<T extends LazadaEnvelope>(json: T, ctx: string): T {
  // Lazada trả code "0" (chuỗi) khi thành công; mã khác kèm type/message.
  if (json.code && json.code !== "0") {
    throw new Error(
      `Lazada ${ctx} lỗi: ${json.code} — ${json.message || json.type || "không rõ"}`
    );
  }
  return json;
}

// ---------- Gọi API (chung cho host auth lẫn host nghiệp vụ) ----------

/**
 * Helper gọi một API Lazada dạng GET: tự ghép common params (app_key,
 * timestamp ms, sign_method) + params truyền vào, ký rồi bóc lớp bao.
 * `host` phân biệt máy chủ xác thực (auth.lazada.com/rest) với máy chủ
 * nghiệp vụ (api.lazada.vn/rest) — path token nằm bên auth.
 */
async function callLazada<T extends LazadaEnvelope>(
  host: string,
  path: string,
  params: Record<string, string>,
  ctx: string,
  cfg: LazadaConfig
): Promise<T> {
  const all: Record<string, string> = {
    ...params,
    app_key: cfg.appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()), // Lazada dùng MILI-GIÂY (khác Shopee dùng giây)
  };
  const sign = signLazada(cfg.appSecret, path, all);
  const qs = new URLSearchParams({ ...all, sign }).toString();
  const res = await fetch(`${host}${path}?${qs}`, { method: "GET" });
  return ensureOk((await res.json()) as T, ctx);
}

// ---------- Token ----------

/** Đổi `code` (nhận ở callback) lấy access_token/refresh_token. */
export async function createToken(
  code: string,
  cfg: LazadaConfig = getLazadaConfig()
): Promise<LazadaTokenData> {
  return callLazada<LazadaTokenData>(
    LAZADA_ENDPOINTS.auth,
    LAZADA_PATHS.tokenCreate,
    { code },
    "đổi token",
    cfg
  );
}

/** Làm mới access_token bằng refresh_token trước khi hết hạn. */
export async function refreshToken(
  refresh: string,
  cfg: LazadaConfig = getLazadaConfig()
): Promise<LazadaTokenData> {
  return callLazada<LazadaTokenData>(
    LAZADA_ENDPOINTS.auth,
    LAZADA_PATHS.tokenRefresh,
    { refresh_token: refresh },
    "refresh token",
    cfg
  );
}

// ---------- Thông tin người bán ----------

/** Lấy thông tin gian hàng (tên, seller_id...) để hiển thị + định danh gian. */
export async function getSellerInfo(
  accessToken: string,
  cfg: LazadaConfig = getLazadaConfig()
): Promise<LazadaSellerInfo> {
  const data = await callLazada<LazadaSellerData>(
    LAZADA_ENDPOINTS.api,
    LAZADA_PATHS.sellerGet,
    { access_token: accessToken },
    "seller/get",
    cfg
  );
  return data.data ?? {};
}
