// ============================================================
// SHOPEE OPEN PLATFORM API CLIENT (v2)
//
// Gói phần "khó" của tích hợp Shopee vào một chỗ:
//   1) Ký request (HMAC-SHA256) — Shopee có 2 kiểu ký:
//        · Public API : base = partner_id + path + timestamp
//        · Shop API   : base = partner_id + path + timestamp + access_token + shop_id
//   2) Dựng URL uỷ quyền (auth_partner).
//   3) Đổi code → access_token/refresh_token, và làm mới token.
//   4) Lấy thông tin gian hàng (get_shop_info).
// ============================================================

import crypto from "crypto";
import {
  getShopeeConfig,
  SHOPEE_PATHS,
  type ShopeeConfig,
} from "./config";

// ---------- Ký request ----------

/** Chữ ký cho PUBLIC API: HMAC-SHA256(partner_key, partner_id + path + timestamp). */
export function signPublic(
  partnerKey: string,
  partnerId: string,
  path: string,
  timestamp: number
): string {
  const base = `${partnerId}${path}${timestamp}`;
  return crypto.createHmac("sha256", partnerKey).update(base).digest("hex");
}

/** Chữ ký cho SHOP API: base public + access_token + shop_id. */
export function signShop(
  partnerKey: string,
  partnerId: string,
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: string
): string {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey).update(base).digest("hex");
}

// ---------- URL uỷ quyền ----------

/**
 * Dựng URL trang uỷ quyền Shopee. `redirect` là URL đầy đủ (đã kèm state của
 * mình) mà Shopee sẽ chuyển hướng về, gắn thêm `?code=...&shop_id=...`.
 */
export function buildAuthorizeUrl(
  redirect: string,
  cfg: ShopeeConfig = getShopeeConfig()
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublic(cfg.partnerKey, cfg.partnerId, SHOPEE_PATHS.authPartner, timestamp);
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    sign,
    redirect,
  }).toString();
  return `${cfg.apiBase}${SHOPEE_PATHS.authPartner}?${qs}`;
}

// ---------- Kiểu dữ liệu Shopee trả về ----------

/** Bao ngoài chuẩn của Shopee: `error` rỗng ("") là thành công. */
interface ShopeeEnvelope {
  error?: string;
  message?: string;
  request_id?: string;
  warning?: string;
}

export interface ShopeeTokenData extends ShopeeEnvelope {
  access_token?: string;
  refresh_token?: string;
  /** Thời hạn access_token tính bằng GIÂY kể từ hiện tại (thường 14400 = 4h). */
  expire_in?: number;
}

export interface ShopeeShopInfo extends ShopeeEnvelope {
  shop_name?: string;
  region?: string;
  status?: string;
}

function ensureOk<T extends ShopeeEnvelope>(json: T, ctx: string): T {
  if (json.error) {
    throw new Error(`Shopee ${ctx} lỗi: ${json.error} — ${json.message || "không rõ"}`);
  }
  return json;
}

// ---------- Gọi PUBLIC API (POST, ký partner_id+path+timestamp) ----------

async function callPublicPost<T extends ShopeeEnvelope>(
  path: string,
  body: Record<string, unknown>,
  cfg: ShopeeConfig
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublic(cfg.partnerKey, cfg.partnerId, path, timestamp);
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    sign,
  }).toString();
  const res = await fetch(`${cfg.apiBase}${path}?${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/** Đổi `code` (nhận ở callback) + shop_id lấy access_token/refresh_token. */
export async function getAccessToken(
  code: string,
  shopId: string,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeTokenData> {
  const json = await callPublicPost<ShopeeTokenData>(
    SHOPEE_PATHS.tokenGet,
    { code, shop_id: Number(shopId), partner_id: Number(cfg.partnerId) },
    cfg
  );
  return ensureOk(json, "đổi token");
}

/** Làm mới access_token bằng refresh_token trước khi hết hạn. */
export async function refreshAccessToken(
  refreshToken: string,
  shopId: string,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeTokenData> {
  const json = await callPublicPost<ShopeeTokenData>(
    SHOPEE_PATHS.accessTokenGet,
    { refresh_token: refreshToken, shop_id: Number(shopId), partner_id: Number(cfg.partnerId) },
    cfg
  );
  return ensureOk(json, "refresh token");
}

// ---------- Gọi SHOP API (GET, ký thêm access_token+shop_id) ----------

/**
 * Helper gọi một SHOP API dạng GET: tự ghép partner_id/timestamp/access_token/
 * shop_id + chữ ký shop, kèm các tham số nghiệp vụ, rồi bóc lớp bao (ném nếu error).
 */
async function callShopGet<T extends ShopeeEnvelope>(
  path: string,
  accessToken: string,
  shopId: string,
  extraQuery: Record<string, string | number>,
  ctx: string,
  cfg: ShopeeConfig
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShop(cfg.partnerKey, cfg.partnerId, path, timestamp, accessToken, shopId);
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: shopId,
    sign,
    ...Object.fromEntries(Object.entries(extraQuery).map(([k, v]) => [k, String(v)])),
  }).toString();
  const res = await fetch(`${cfg.apiBase}${path}?${qs}`, { method: "GET" });
  return ensureOk((await res.json()) as T, ctx);
}

/** Lấy thông tin gian hàng (tên, khu vực...) để hiển thị. */
export async function getShopInfo(
  accessToken: string,
  shopId: string,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeShopInfo> {
  return callShopGet<ShopeeShopInfo>(
    SHOPEE_PATHS.shopInfo,
    accessToken,
    shopId,
    {},
    "get_shop_info",
    cfg
  );
}

// ---------- Kéo đơn hàng (Order API v2) ----------

export interface ShopeeOrderListParams {
  accessToken: string;
  shopId: string;
  /** Mốc thời gian (Unix seconds). Shopee giới hạn khoảng ≤ 15 ngày mỗi lần gọi. */
  timeFrom: number;
  timeTo: number;
  pageSize?: number;
  /** Con trỏ phân trang Shopee trả về ở lần gọi trước. */
  cursor?: string;
  /** create_time | update_time */
  timeRangeField?: "create_time" | "update_time";
}

export interface ShopeeOrderListData extends ShopeeEnvelope {
  response?: {
    order_list?: { order_sn: string; order_status?: string }[];
    more?: boolean;
    next_cursor?: string;
  };
}

/** Lấy danh sách order_sn trong một khoảng thời gian (một trang). */
export async function getOrderList(
  params: ShopeeOrderListParams,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeOrderListData> {
  return callShopGet<ShopeeOrderListData>(
    SHOPEE_PATHS.orderList,
    params.accessToken,
    params.shopId,
    {
      time_range_field: params.timeRangeField ?? "create_time",
      time_from: params.timeFrom,
      time_to: params.timeTo,
      page_size: params.pageSize ?? 100,
      ...(params.cursor ? { cursor: params.cursor } : {}),
    },
    "get_order_list",
    cfg
  );
}

export interface ShopeeOrderItem {
  item_id?: number;
  item_name?: string;
  item_sku?: string;
  model_name?: string;
  model_sku?: string;
  model_quantity_purchased?: number;
  model_discounted_price?: number;
  model_original_price?: number;
}

export interface ShopeeOrderDetail {
  order_sn: string;
  order_status?: string;
  create_time?: number;
  update_time?: number;
  pay_time?: number;
  /** Tổng tiền đơn (Shopee trả SỐ, không phải chuỗi). */
  total_amount?: number;
  currency?: string;
  buyer_username?: string;
  recipient_address?: { name?: string; phone?: string };
  item_list?: ShopeeOrderItem[];
}

export interface ShopeeOrderDetailData extends ShopeeEnvelope {
  response?: { order_list?: ShopeeOrderDetail[] };
}

// Các trường chi tiết cần Shopee trả về (mặc định API chỉ trả tối thiểu).
const ORDER_DETAIL_FIELDS =
  "order_status,create_time,update_time,pay_time,total_amount,currency,buyer_username,recipient_address,item_list";

/** Lấy chi tiết nhiều đơn theo order_sn (tối đa 50 sn/lần). */
export async function getOrderDetail(
  accessToken: string,
  shopId: string,
  orderSnList: string[],
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeOrderDetail[]> {
  const data = await callShopGet<ShopeeOrderDetailData>(
    SHOPEE_PATHS.orderDetail,
    accessToken,
    shopId,
    {
      order_sn_list: orderSnList.join(","),
      response_optional_fields: ORDER_DETAIL_FIELDS,
    },
    "get_order_detail",
    cfg
  );
  return data.response?.order_list ?? [];
}
