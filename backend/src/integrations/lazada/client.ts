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

// ---------- Đơn hàng (Order API) ----------

/** Một đơn trong danh sách /orders/get (chỉ các trường Hubsell dùng). */
export interface LazadaOrder {
  order_id?: number | string;
  /** Mã đơn hiển thị cho người bán — Hubsell dùng làm orderCode. */
  order_number?: number | string;
  /** Lazada trả MẢNG trạng thái (đơn nhiều kiện có thể lệch nhau). */
  statuses?: string[];
  /** Tổng tiền đơn — Lazada trả CHUỖI ("259000.00"). */
  price?: string;
  created_at?: string; // ISO 8601 kèm múi giờ, vd "2026-07-28T17:49:00+0700"
  updated_at?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  address_shipping?: { first_name?: string; last_name?: string; phone?: string };
  items_count?: number;
}

interface LazadaOrderListData extends LazadaEnvelope {
  data?: { count?: number; orders?: LazadaOrder[] };
}

export interface LazadaOrderListParams {
  accessToken: string;
  /** Mốc ISO 8601 — chỉ lấy đơn TẠO sau thời điểm này. */
  createdAfter: string;
  offset?: number;
  /** Tối đa 100 đơn/trang theo giới hạn Lazada. */
  limit?: number;
}

/** Lấy một trang danh sách đơn tạo sau mốc `createdAfter`. */
export async function getOrders(
  params: LazadaOrderListParams,
  cfg: LazadaConfig = getLazadaConfig()
): Promise<{ count: number; orders: LazadaOrder[] }> {
  const data = await callLazada<LazadaOrderListData>(
    LAZADA_ENDPOINTS.api,
    LAZADA_PATHS.orderList,
    {
      access_token: params.accessToken,
      created_after: params.createdAfter,
      offset: String(params.offset ?? 0),
      limit: String(params.limit ?? 100),
      sort_by: "created_at",
      sort_direction: "ASC",
    },
    "orders/get",
    cfg
  );
  return { count: data.data?.count ?? 0, orders: data.data?.orders ?? [] };
}

/**
 * Một dòng hàng trong /orders/items/get. LƯU Ý đặc thù Lazada: MỖI DÒNG LÀ MỘT
 * ĐƠN VỊ SẢN PHẨM (khách mua 3 cái = 3 dòng lặp), không có trường quantity —
 * tầng sync phải tự đếm số dòng trùng SKU.
 */
export interface LazadaOrderItem {
  order_item_id?: number | string;
  name?: string;
  /** SKU người bán tự đặt (SellerSku) — khoá liên kết kho Hubsell. */
  sku?: string;
  /** SKU hệ thống Lazada sinh (đuôi định danh sàn). */
  shop_sku?: string;
  variation?: string;
  /** Giá khách thực trả cho đơn vị này (sau khuyến mãi người bán). */
  paid_price?: number | string;
  item_price?: number | string;
  status?: string;
  product_main_image?: string;
  product_id?: number | string;
}

interface LazadaMultiOrderItemsData extends LazadaEnvelope {
  data?: {
    order_id?: number | string;
    order_number?: number | string;
    order_items?: LazadaOrderItem[];
  }[];
}

/** Lấy dòng hàng của NHIỀU đơn (≤50 order_id/lần) — trả map theo order_id. */
export async function getMultipleOrderItems(
  accessToken: string,
  orderIds: (number | string)[],
  cfg: LazadaConfig = getLazadaConfig()
): Promise<Map<string, LazadaOrderItem[]>> {
  const data = await callLazada<LazadaMultiOrderItemsData>(
    LAZADA_ENDPOINTS.api,
    LAZADA_PATHS.orderItemsGet,
    {
      access_token: accessToken,
      // Lazada nhận mảng JSON trong query: order_ids=[123,456]
      order_ids: `[${orderIds.map((id) => String(id)).join(",")}]`,
    },
    "orders/items/get",
    cfg
  );
  const bySn = new Map<string, LazadaOrderItem[]>();
  for (const row of data.data ?? []) {
    if (row.order_id == null) continue;
    bySn.set(String(row.order_id), row.order_items ?? []);
  }
  return bySn;
}

// ---------- Sản phẩm (Product API) ----------

/** Một biến thể (SKU) trong /products/get — tên trường của Lazada viết HOA đầu. */
export interface LazadaProductSku {
  SkuId?: number | string;
  SellerSku?: string;
  ShopSku?: string;
  quantity?: number;
  price?: number | string;
  special_price?: number | string;
  Status?: string; // active / inactive / deleted
  Images?: string[];
  /** Chuỗi thuộc tính phân loại, vd "Đỏ, XL" (saleProp gộp sẵn). */
  Variation?: string;
}

export interface LazadaProduct {
  item_id?: number | string;
  status?: string;
  attributes?: { name?: string };
  images?: string[];
  skus?: LazadaProductSku[];
}

interface LazadaProductListData extends LazadaEnvelope {
  data?: { total_products?: number; products?: LazadaProduct[] };
}

/** Lấy một trang sản phẩm (filter=all để không sót hàng ẩn/hết lượt bán). */
export async function getProducts(
  accessToken: string,
  offset: number,
  limit: number,
  cfg: LazadaConfig = getLazadaConfig()
): Promise<{ total: number; products: LazadaProduct[] }> {
  const data = await callLazada<LazadaProductListData>(
    LAZADA_ENDPOINTS.api,
    LAZADA_PATHS.productsGet,
    {
      access_token: accessToken,
      filter: "all",
      offset: String(offset),
      limit: String(limit),
    },
    "products/get",
    cfg
  );
  return {
    total: data.data?.total_products ?? 0,
    products: data.data?.products ?? [],
  };
}

/**
 * Sinh KHOÁ SKU CHUẨN cho một dòng hàng/biến thể Lazada — DÙNG CHUNG cho cả
 * đồng bộ sản phẩm lẫn đồng bộ đơn để hai luồng luôn khớp khoá (như Shopee).
 * Ưu tiên SellerSku người bán tự đặt; trống thì dựng khoá tổng hợp từ id sàn.
 */
export function lazadaChannelSku(opts: {
  sellerSku?: string;
  shopSku?: string;
  itemId?: number | string;
  skuId?: number | string;
}): string {
  const seller = opts.sellerSku?.trim();
  if (seller) return seller;
  const shop = opts.shopSku?.trim();
  if (shop) return shop;
  return `LZD-${opts.itemId ?? "0"}-${opts.skuId ?? "0"}`;
}

// ---------- Tài chính (Finance API) ----------

/**
 * MỘT DÒNG PHÍ trong sao kê /finance/transaction/details/get. Mỗi đơn quyết
 * toán sinh NHIỀU dòng: tiền hàng (+), hoa hồng (−), phí thanh toán (−), phí
 * vận chuyển (±), voucher (±)... `amount` là CHUỖI CÓ DẤU ("−" là sàn trừ shop).
 * Tên trường Lazada trả không đồng nhất giữa bản docs (snake/camel) — tầng
 * service đọc phòng thủ cả hai kiểu.
 */
export interface LazadaTransaction {
  order_no?: number | string;
  orderNo?: number | string;
  fee_name?: string;
  feeName?: string;
  transaction_type?: string;
  transactionType?: string;
  amount?: string | number;
  paid_status?: string;
  paidStatus?: string;
  transaction_date?: string;
  transactionDate?: string;
  statement?: string;
  [k: string]: unknown;
}

interface LazadaTransactionData extends LazadaEnvelope {
  data?: LazadaTransaction[];
}

export interface LazadaTransactionParams {
  accessToken: string;
  /** Mốc đầu/cuối dạng YYYY-MM-DD — Lazada giới hạn mỗi lần gọi ≤30 ngày. */
  startTime: string;
  endTime: string;
  offset?: number;
  /** Tối đa 500 dòng/trang theo giới hạn Lazada. */
  limit?: number;
}

/** Lấy một trang sao kê giao dịch tài chính (mọi loại — trans_type=-1). */
export async function getTransactionDetails(
  params: LazadaTransactionParams,
  cfg: LazadaConfig = getLazadaConfig()
): Promise<LazadaTransaction[]> {
  const data = await callLazada<LazadaTransactionData>(
    LAZADA_ENDPOINTS.api,
    LAZADA_PATHS.transactionDetails,
    {
      access_token: params.accessToken,
      trans_type: "-1",
      start_time: params.startTime,
      end_time: params.endTime,
      offset: String(params.offset ?? 0),
      limit: String(params.limit ?? 500),
    },
    "finance/transaction/details/get",
    cfg
  );
  return data.data ?? [];
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
