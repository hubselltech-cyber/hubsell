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
  SHOPEE_AUTH_URLS,
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
 * Dựng URL trang uỷ quyền Shopee theo luồng MỚI (developer-guide/20): URL cố
 * định + auth_type=seller, KHÔNG ký sign/timestamp → link không hết hạn 5 phút.
 * `state` đi qua tham số chuẩn, Shopee trả nguyên vẹn về `redirect_uri` kèm
 * `code` + `shop_id` (hoặc `main_account_id` nếu seller đăng nhập main account).
 * Domain của `redirect_uri` phải khớp Live Redirect URL Domain khai trên Console.
 */
export function buildAuthorizeUrl(
  redirectUri: string,
  state: string,
  cfg: ShopeeConfig = getShopeeConfig()
): string {
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    auth_type: "seller",
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  }).toString();
  return `${SHOPEE_AUTH_URLS[cfg.env]}?${qs}`;
}

// ---------- Kiểu dữ liệu Shopee trả về ----------

/** Bao ngoài chuẩn của Shopee: `error` rỗng ("") là thành công. */
export interface ShopeeEnvelope {
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
 *
 * `extraParams` là MẢNG cặp [key, value] (không phải object) để hỗ trợ tham số
 * LẶP như `item_status` của get_item_list. Chữ ký shop KHÔNG gồm các tham số
 * nghiệp vụ nên thêm bao nhiêu param cũng không ảnh hưởng sign.
 */
async function callShopGet<T extends ShopeeEnvelope>(
  path: string,
  accessToken: string,
  shopId: string,
  extraParams: Array<[string, string | number]>,
  ctx: string,
  cfg: ShopeeConfig
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShop(cfg.partnerKey, cfg.partnerId, path, timestamp, accessToken, shopId);
  const params: Array<[string, string]> = [
    ["partner_id", cfg.partnerId],
    ["timestamp", String(timestamp)],
    ["access_token", accessToken],
    ["shop_id", shopId],
    ["sign", sign],
    ...extraParams.map(([k, v]) => [k, String(v)] as [string, string]),
  ];
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${cfg.apiBase}${path}?${qs}`, { method: "GET" });
  return ensureOk((await res.json()) as T, ctx);
}

/**
 * Helper gọi một SHOP API dạng POST (update_stock...): chữ ký y hệt GET (base
 * string KHÔNG gồm body), tham số định danh nằm trên query, nghiệp vụ trong body.
 */
async function callShopPost<T extends ShopeeEnvelope>(
  path: string,
  accessToken: string,
  shopId: string,
  body: Record<string, unknown>,
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
  }).toString();
  const res = await fetch(`${cfg.apiBase}${path}?${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    [],
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
    [
      ["time_range_field", params.timeRangeField ?? "create_time"],
      ["time_from", params.timeFrom],
      ["time_to", params.timeTo],
      ["page_size", params.pageSize ?? 100],
      ...(params.cursor ? ([["cursor", params.cursor]] as [string, string][]) : []),
    ],
    "get_order_list",
    cfg
  );
}

export interface ShopeeOrderItem {
  item_id?: number;
  item_name?: string;
  item_sku?: string;
  model_id?: number;
  model_name?: string;
  model_sku?: string;
  model_quantity_purchased?: number;
  model_discounted_price?: number;
  model_original_price?: number;
}

/**
 * Sinh KHOÁ SKU CHUẨN cho một dòng hàng Shopee — DÙNG CHUNG cho cả đồng bộ sản
 * phẩm lẫn đồng bộ đơn, để hai luồng luôn khớp khoá.
 *
 * PHÂN LOẠI (có model_id): khoá = model_sku của CHÍNH phân loại đó. KHÔNG mượn
 * item_sku — item_sku dùng chung cho mọi phân loại nên mượn nó sẽ gộp nhầm các
 * phân loại khác nhau (vd 3 màu để trống SKU đều thành 1). Trống model_sku → khoá
 * tổng hợp `SPE-{item}-{model}` để mỗi phân loại một dòng. Người bán cố tình đặt
 * CÙNG model_sku cho nhiều phân loại thì vẫn gộp — đúng ý (một SKU bán).
 *
 * SẢN PHẨM ĐƠN (không model_id): dùng item_sku; trống thì `SPE-{item}`.
 */
export function shopeeChannelSku(opts: {
  itemId?: number;
  modelId?: number;
  itemSku?: string;
  modelSku?: string;
}): string {
  if (opts.modelId) {
    return opts.modelSku?.trim() || `SPE-${opts.itemId}-${opts.modelId}`;
  }
  return opts.itemSku?.trim() || `SPE-${opts.itemId}`;
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
  /** Tên hãng vận chuyển sàn gán cho đơn (vd "SPX Express") — map sang enum Carrier. */
  shipping_carrier?: string;
}

export interface ShopeeOrderDetailData extends ShopeeEnvelope {
  response?: { order_list?: ShopeeOrderDetail[] };
}

// Các trường chi tiết cần Shopee trả về (mặc định API chỉ trả tối thiểu).
const ORDER_DETAIL_FIELDS =
  "order_status,create_time,update_time,pay_time,total_amount,currency,buyer_username,recipient_address,item_list,shipping_carrier";

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
    [
      ["order_sn_list", orderSnList.join(",")],
      ["response_optional_fields", ORDER_DETAIL_FIELDS],
    ],
    "get_order_detail",
    cfg
  );
  return data.response?.order_list ?? [];
}

// ---------- Đơn hoàn (Returns API v2) + mã vận đơn (Logistics) ----------

/**
 * MỘT yêu cầu Trả hàng/Hoàn tiền (đọc phòng thủ — chỉ khai trường Hubsell dùng,
 * trường lạ giữ nguyên qua index signature để soi log khi cần).
 */
export interface ShopeeReturnEntry {
  return_sn?: string;
  order_sn?: string;
  /** REQUESTED / PROCESSING / JUDGING / ACCEPTED / COMPLETED / CANCELLED / CLOSED... */
  status?: string;
  /** Mã vận đơn CHIỀU HOÀN (kiện khách gửi trả) — thứ kho quét trên tem. */
  tracking_number?: string;
  reason?: string;
  text_reason?: string;
  create_time?: number;
  update_time?: number;
  /** Tổng tiền sàn hoàn cho khách trên yêu cầu này (pending hoặc đã chốt). */
  refund_amount?: number;
  /** 0 = Return and Refund (hàng về seller), 1 = Refund Only (khách giữ hàng). */
  return_solution?: number;
  /** true = kiện phải gửi về seller (có/không tích hợp vận chuyển). */
  needs_logistics?: boolean;
  /** Dòng hàng trong yêu cầu hoàn — `amount` = SỐ LƯỢNG trả của dòng. */
  item?: ShopeeReturnItem[];
  [k: string]: unknown;
}

export interface ShopeeReturnItem {
  item_id?: number;
  model_id?: number;
  item_sku?: string;
  variation_sku?: string;
  amount?: number;
  item_price?: number;
  /** Tiền hoàn riêng dòng (chỉ shop whitelist Partial Qty RR; không có thì dùng item_price). */
  refund_amount?: number;
}

/** get_return_detail: thêm trạng thái vận chuyển CHIỀU HOÀN so với list. */
export interface ShopeeReturnDetail extends ShopeeReturnEntry {
  /** Trạng thái kiện hoàn mới (docs 11/2025): LOGISTICS_DELIVERY_DONE = đã về tay seller;
   *  với In-transit RR / Return-on-the-Spot là chữ "Delivered". */
  reverse_logistics_status?: string;
  /** Tên field trong response example của docs (số ít) — đọc cả hai cho chắc. */
  reverse_logistic_status?: string;
  /** Legacy, chỉ phản ánh Normal RR. */
  logistics_status?: string;
}

export interface ShopeeReturnDetailData extends ShopeeEnvelope {
  response?: ShopeeReturnDetail;
}

/** Chi tiết MỘT yêu cầu hoàn — cần để biết kiện hoàn đã về tay seller chưa. */
export async function getReturnDetail(
  accessToken: string,
  shopId: string,
  returnSn: string,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeReturnDetail | null> {
  const data = await callShopGet<ShopeeReturnDetailData>(
    SHOPEE_PATHS.returnDetail,
    accessToken,
    shopId,
    [["return_sn", returnSn]],
    "get_return_detail",
    cfg
  );
  return data.response ?? null;
}

export interface ShopeeReturnListData extends ShopeeEnvelope {
  response?: {
    // Docs đặt tên mảng là "return" (từ khoá xấu nhưng là tên thật của sàn).
    return?: ShopeeReturnEntry[];
    more?: boolean;
  };
}

export interface ShopeeReturnListParams {
  accessToken: string;
  shopId: string;
  /** Trang/offset bắt đầu từ 0 (docs get_return_list: Default is 0; khác get_order_list dùng cursor). */
  pageNo: number;
  pageSize?: number;
  /** Lọc theo BIẾN ĐỘNG — bắt cả yêu cầu mới tạo lẫn đổi trạng thái/thêm tracking. */
  updateTimeFrom?: number;
  updateTimeTo?: number;
}

/**
 * DS yêu cầu Trả hàng/Hoàn tiền của shop. Nguồn duy nhất nhìn thấy yêu cầu hoàn
 * trên đơn đã COMPLETED (order_status không đổi nên mọi luồng quét đơn đều mù).
 */
export async function getReturnList(
  params: ShopeeReturnListParams,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeReturnListData> {
  return callShopGet<ShopeeReturnListData>(
    SHOPEE_PATHS.returnList,
    params.accessToken,
    params.shopId,
    [
      ["page_no", params.pageNo],
      ["page_size", params.pageSize ?? 50],
      ...(params.updateTimeFrom != null
        ? ([["update_time_from", params.updateTimeFrom]] as [string, number][])
        : []),
      ...(params.updateTimeTo != null
        ? ([["update_time_to", params.updateTimeTo]] as [string, number][])
        : []),
    ],
    "get_return_list",
    cfg
  );
}

interface ShopeeTrackingNumberData extends ShopeeEnvelope {
  response?: { tracking_number?: string; plp_number?: string };
}

/**
 * Mã vận đơn CHIỀU ĐI của một đơn — get_order_detail v2 không còn trả tracking
 * nên phải hỏi endpoint logistics riêng (1 call / 1 đơn, dùng có tiết chế).
 * Đơn chưa phát sinh vận đơn (chưa arrange shipment) trả chuỗi rỗng → null.
 */
export async function getTrackingNumber(
  accessToken: string,
  shopId: string,
  orderSn: string,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<string | null> {
  const data = await callShopGet<ShopeeTrackingNumberData>(
    SHOPEE_PATHS.trackingNumber,
    accessToken,
    shopId,
    [["order_sn", orderSn]],
    "get_tracking_number",
    cfg
  );
  return data.response?.tracking_number?.trim() || null;
}

// ---------- Kéo sản phẩm (Product API v2) ----------

/** Các trạng thái item — get_item_list mặc định chỉ trả NORMAL, phải khai đủ. */
export const ALL_ITEM_STATUSES = ["NORMAL", "UNLIST", "BANNED", "DELETED"] as const;

export interface ShopeeItemListParams {
  accessToken: string;
  shopId: string;
  offset: number;
  pageSize?: number;
  /** Mặc định lấy đủ mọi trạng thái để không sót item mới đăng/đang chờ. */
  itemStatus?: readonly string[];
}

export interface ShopeeItemListData extends ShopeeEnvelope {
  response?: {
    item?: { item_id: number; item_status?: string; update_time?: number }[];
    total_count?: number;
    has_next_page?: boolean;
    next_offset?: number;
  };
}

/** Lấy một trang item_id (lọc theo item_status). */
export async function getItemList(
  params: ShopeeItemListParams,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeItemListData> {
  const statuses = params.itemStatus ?? ALL_ITEM_STATUSES;
  return callShopGet<ShopeeItemListData>(
    SHOPEE_PATHS.itemList,
    params.accessToken,
    params.shopId,
    [
      ["offset", params.offset],
      ["page_size", params.pageSize ?? 100],
      // item_status là tham số LẶP: item_status=NORMAL&item_status=UNLIST&...
      ...statuses.map((s) => ["item_status", s] as [string, string]),
    ],
    "get_item_list",
    cfg
  );
}

/** Cấu trúc tồn kho v2 Shopee trả kèm item/model (get_item_base_info / get_model_list). */
export interface ShopeeStockInfoV2 {
  summary_info?: {
    total_reserved_stock?: number;
    total_available_stock?: number;
  };
  seller_stock?: { location_id?: string; stock?: number }[];
}

/**
 * Đọc SỐ TỒN NGƯỜI BÁN từ stock_info_v2 — đối chiếu được với số ta đẩy qua
 * update_stock (cũng là seller_stock). Trả null nếu payload không có dữ liệu
 * tồn (để tầng gọi phân biệt "không đọc được" với "tồn = 0").
 */
export function shopeeSellerStock(info?: ShopeeStockInfoV2): number | null {
  if (!info) return null;
  const list = info.seller_stock;
  if (list && list.length > 0) {
    return list.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);
  }
  const total = info.summary_info?.total_available_stock;
  return typeof total === "number" ? total : null;
}

export interface ShopeeItemBaseInfo {
  item_id: number;
  item_name?: string;
  item_sku?: string;
  item_status?: string;
  has_model?: boolean;
  image?: { image_url_list?: string[] };
  price_info?: { current_price?: number; original_price?: number }[];
  stock_info_v2?: ShopeeStockInfoV2;
  /** Mô tả sản phẩm — item dùng mô tả mở rộng thì text nằm trong description_info. */
  description?: string;
  description_info?: {
    extended_description?: { field_list?: { field_type?: string; text?: string }[] };
  };
  /** Thuộc tính seller khai trên sàn (Chất liệu, Xuất xứ…) — ngữ cảnh AI Copilot. */
  attribute_list?: {
    original_attribute_name?: string;
    attribute_value_list?: { original_value_name?: string }[];
  }[];
}

export interface ShopeeItemBaseData extends ShopeeEnvelope {
  response?: { item_list?: ShopeeItemBaseInfo[] };
}

/** Lấy thông tin cơ bản của nhiều item (≤50 id/lần). */
export async function getItemBaseInfo(
  accessToken: string,
  shopId: string,
  itemIds: number[],
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeItemBaseInfo[]> {
  const data = await callShopGet<ShopeeItemBaseData>(
    SHOPEE_PATHS.itemBaseInfo,
    accessToken,
    shopId,
    [["item_id_list", itemIds.join(",")]],
    "get_item_base_info",
    cfg
  );
  return data.response?.item_list ?? [];
}

export interface ShopeeModel {
  model_id: number;
  model_name?: string;
  model_sku?: string;
  price_info?: { current_price?: number }[];
  stock_info_v2?: ShopeeStockInfoV2;
}

export interface ShopeeModelData extends ShopeeEnvelope {
  response?: { model?: ShopeeModel[] };
}

/** Lấy danh sách phân loại (model) của một item — SKU thật thường ở cấp model. */
export async function getModelList(
  accessToken: string,
  shopId: string,
  itemId: number,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeModel[]> {
  const data = await callShopGet<ShopeeModelData>(
    SHOPEE_PATHS.modelList,
    accessToken,
    shopId,
    [["item_id", itemId]],
    "get_model_list",
    cfg
  );
  return data.response?.model ?? [];
}

// ---------- Cập nhật tồn kho lên sàn ----------

export interface ShopeeUpdateStockData extends ShopeeEnvelope {
  response?: {
    failure_list?: { model_id?: number; failed_reason?: string }[];
    success_list?: { model_id?: number }[];
  };
}

/**
 * Đẩy tồn kho MỚI của một item/model lên Shopee (update_stock v2).
 * `modelId` bỏ trống/0 = sản phẩm đơn không phân loại (Shopee quy ước model_id 0).
 * Shopee có thể trả 200 nhưng kèm failure_list từng model → ném lỗi để tầng
 * gọi retry, không được coi là thành công một nửa.
 */
export async function updateShopeeStock(
  accessToken: string,
  shopId: string,
  itemId: number,
  stock: number,
  modelId?: number,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<void> {
  const data = await callShopPost<ShopeeUpdateStockData>(
    SHOPEE_PATHS.updateStock,
    accessToken,
    shopId,
    {
      item_id: itemId,
      stock_list: [
        {
          model_id: modelId ?? 0,
          // seller_stock: tồn của kho mặc định (không khai location_id).
          seller_stock: [{ stock }],
        },
      ],
    },
    "update_stock",
    cfg
  );
  const failed = data.response?.failure_list ?? [];
  if (failed.length > 0) {
    throw new Error(
      `Shopee update_stock từ chối item ${itemId}: ${failed
        .map((f) => f.failed_reason || `model ${f.model_id}`)
        .join("; ")}`
    );
  }
}

// ---------- Chat với người mua (SellerChat API) ----------
// Path theo tài liệu Shopee OpenAPI v2 (module sellerchat). Module này có thể
// cần bật quyền riêng trên Console — lỗi permission nổi nguyên văn lên tầng gọi.

/** Một hội thoại trong get_conversation_list. */
export interface ShopeeConversation {
  conversation_id?: number | string;
  to_id?: number; // user_id người mua — dùng làm to_id khi gửi tin
  to_name?: string;
  to_avatar?: string;
  shop_id?: number;
  unread_count?: number;
  latest_message_content?: { text?: string } | null;
  latest_message_type?: string;
  last_message_timestamp?: number; // NANO giây ở một số region — chuẩn hoá ở tầng gọi
  latest_message_from_id?: number;
}

export interface ShopeeConversationListData extends ShopeeEnvelope {
  // Tuỳ version API, mảng hội thoại nằm TRONG page_result hoặc NGANG HÀNG
  // với nó — khai cả hai, tầng gọi đọc phòng thủ.
  response?: {
    conversations?: ShopeeConversation[];
    page_result?: {
      page_size?: number;
      conversations?: ShopeeConversation[];
      next_cursor?: { next_message_time_nano?: string; conversation_id?: string };
    };
  };
}

/**
 * DS hội thoại của shop (một trang). Docs sellerchat bị Shopee khoá quyền xem
 * nên `direction` + mốc phân trang để hở cho tầng gọi thử nghiệm — xem
 * fetchShopeeConversationsSmart bên routes/operations.ts (tự chọn biến thể
 * trả về hội thoại MỚI nhất).
 */
export async function getConversationList(
  params: {
    accessToken: string;
    shopId: string;
    pageSize?: number;
    /** "latest" | "older" — hành vi thật khác nhau theo version API. */
    direction?: string;
    nextTimestampNano?: string;
    nextConversationId?: string;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeConversationListData> {
  return callShopGet<ShopeeConversationListData>(
    SHOPEE_PATHS.chatConversationList,
    params.accessToken,
    params.shopId,
    [
      ["direction", params.direction ?? "latest"],
      ["type", "all"],
      ["page_size", params.pageSize ?? 25],
      ...(params.nextTimestampNano
        ? ([["next_timestamp_nano", params.nextTimestampNano]] as [string, string][])
        : []),
      ...(params.nextConversationId
        ? ([["conversation_id", params.nextConversationId]] as [string, string][])
        : []),
    ],
    "get_conversation_list",
    cfg
  );
}

/** Một tin nhắn trong get_message. */
export interface ShopeeChatMessage {
  message_id?: string;
  message_type?: string; // text / image / sticker / order / product...
  from_id?: number;
  from_shop_id?: number;
  to_id?: number;
  // Tin kiểu image: tuỳ region trả image_url / url / thumb_url — đọc phòng thủ
  content?: {
    text?: string;
    item_id?: number;
    order_sn?: string;
    image_url?: string;
    url?: string;
    thumb_url?: string;
    /** bundle_message ("Lịch sử hỏi đáp" với bot): id các tin con — đã probe
     *  14/08: sàn KHÔNG cho lấy nội dung tin con qua get_message (mọi cách
     *  phân trang/offset đều rỗng), chỉ đếm được số lượt. */
    messages?: string[];
  };
  /** faq_liveagent: sàn đính kèm SP/đơn khách đang xem lúc bấm "Chat với
   *  Người bán" — nguồn ngữ cảnh duy nhất thay cho nội dung hỏi đáp bị giấu. */
  source_content?: { item_id?: number; order_sn?: string };
  created_timestamp?: number; // epoch giây
}

export interface ShopeeChatMessagesData extends ShopeeEnvelope {
  response?: {
    messages?: ShopeeChatMessage[];
    page_result?: { next_offset?: string };
  };
}

/** DS tin nhắn của một hội thoại (mới nhất trước; một trang). */
export async function getChatMessages(
  params: {
    accessToken: string;
    shopId: string;
    conversationId: string;
    pageSize?: number;
    offset?: string;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeChatMessagesData> {
  return callShopGet<ShopeeChatMessagesData>(
    SHOPEE_PATHS.chatMessages,
    params.accessToken,
    params.shopId,
    [
      ["conversation_id", params.conversationId],
      ["page_size", params.pageSize ?? 25],
      ...(params.offset ? ([["offset", params.offset]] as [string, string][]) : []),
    ],
    "get_message",
    cfg
  );
}

export interface ShopeeSendMessageData extends ShopeeEnvelope {
  response?: { message_id?: string };
}

/**
 * Gửi MỘT tin nhắn văn bản tới người mua. `toId` là user_id người mua (trường
 * to_id của hội thoại). Ảnh/voucher làm sau; thẻ sản phẩm xem sendChatItemMessage.
 */
export async function sendChatMessage(
  params: { accessToken: string; shopId: string; toId: number; text: string },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeSendMessageData> {
  return callShopPost<ShopeeSendMessageData>(
    SHOPEE_PATHS.chatSendMessage,
    params.accessToken,
    params.shopId,
    {
      to_id: params.toId,
      message_type: "text",
      content: { text: params.text },
    },
    "send_message",
    cfg
  );
}

/**
 * Gửi THẺ SẢN PHẨM chuẩn sàn (message_type "item" + item_id) — trên app Shopee
 * khách thấy đúng card sản phẩm bấm mua được, không phải link text.
 */
export async function sendChatItemMessage(
  params: { accessToken: string; shopId: string; toId: number; itemId: number },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeSendMessageData> {
  return callShopPost<ShopeeSendMessageData>(
    SHOPEE_PATHS.chatSendMessage,
    params.accessToken,
    params.shopId,
    {
      to_id: params.toId,
      message_type: "item",
      content: { item_id: params.itemId },
    },
    "send_message",
    cfg
  );
}

export interface ShopeeUploadImageData extends ShopeeEnvelope {
  // Tên trường url tuỳ version docs — đọc phòng thủ ở tầng gọi
  response?: {
    url?: string;
    image_url?: string;
    file_server_url?: string;
    thumbnail?: string;
    thumb_width?: number;
    thumb_height?: number;
  };
}

/**
 * Upload MỘT ảnh lên file server chat của Shopee — bước bắt buộc trước khi
 * send_message kiểu image (content.image_url phải là url do Shopee cấp,
 * link ngoài bị từ chối). Multipart field tên "file"; chữ ký shop y hệt
 * callShopPost (base string không gồm body).
 */
export async function uploadChatImage(
  params: {
    accessToken: string;
    shopId: string;
    buffer: Buffer;
    filename: string;
    mime: string;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<string> {
  const path = SHOPEE_PATHS.chatUploadImage;
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShop(
    cfg.partnerKey,
    cfg.partnerId,
    path,
    timestamp,
    params.accessToken,
    params.shopId
  );
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: params.accessToken,
    shop_id: params.shopId,
    sign,
  }).toString();
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(params.buffer)], { type: params.mime }),
    params.filename
  );
  const res = await fetch(`${cfg.apiBase}${path}?${qs}`, {
    method: "POST",
    body: form,
  });
  const data = ensureOk(
    (await res.json()) as ShopeeUploadImageData,
    "upload_image"
  );
  const url =
    data.response?.url ?? data.response?.image_url ?? data.response?.file_server_url;
  if (!url) {
    throw new Error("Shopee upload_image không trả url ảnh");
  }
  return url;
}

/** Gửi tin nhắn ẢNH — imageUrl phải là url Shopee cấp từ uploadChatImage. */
export async function sendChatImageMessage(
  params: { accessToken: string; shopId: string; toId: number; imageUrl: string },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeSendMessageData> {
  return callShopPost<ShopeeSendMessageData>(
    SHOPEE_PATHS.chatSendMessage,
    params.accessToken,
    params.shopId,
    {
      to_id: params.toId,
      message_type: "image",
      content: { image_url: params.imageUrl },
    },
    "send_message",
    cfg
  );
}

// ---------- Đánh giá sản phẩm (get_comment / reply_comment) ----------

/** Một đánh giá trong get_comment. */
export interface ShopeeComment {
  comment_id?: number;
  comment?: string;
  buyer_username?: string;
  item_id?: number;
  model_id?: number;
  order_sn?: string;
  rating_star?: number; // 1..5
  create_time?: number; // epoch giây
  comment_reply?: { reply?: string; hidden?: boolean } | null;
}

export interface ShopeeCommentListData extends ShopeeEnvelope {
  response?: {
    item_comment_list?: ShopeeComment[];
    more?: boolean;
    next_cursor?: string;
  };
}

/**
 * DS đánh giá của shop (một trang, cursor rỗng = trang đầu). Không truyền
 * item_id để lấy TOÀN SHOP — đúng nhu cầu màn "Phản hồi đánh giá".
 */
export async function getComments(
  params: {
    accessToken: string;
    shopId: string;
    cursor?: string;
    pageSize?: number;
    itemId?: number;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeCommentListData> {
  return callShopGet<ShopeeCommentListData>(
    SHOPEE_PATHS.productComments,
    params.accessToken,
    params.shopId,
    [
      ["cursor", params.cursor ?? ""],
      ["page_size", params.pageSize ?? 50],
      ...(params.itemId ? ([["item_id", params.itemId]] as [string, number][]) : []),
    ],
    "get_comment",
    cfg
  );
}

export interface ShopeeReplyCommentData extends ShopeeEnvelope {
  response?: {
    result_list?: { comment_id?: number; fail_error?: string; fail_message?: string }[];
  };
}

/** Trả lời MỘT đánh giá. Shopee có thể trả 200 kèm fail per-comment → ném lỗi rõ. */
export async function replyComment(
  params: { accessToken: string; shopId: string; commentId: number; reply: string },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<void> {
  const data = await callShopPost<ShopeeReplyCommentData>(
    SHOPEE_PATHS.productReplyComment,
    params.accessToken,
    params.shopId,
    { comment_list: [{ comment_id: params.commentId, comment: params.reply }] },
    "reply_comment",
    cfg
  );
  const failed = (data.response?.result_list ?? []).filter((r) => r.fail_error);
  if (failed.length > 0) {
    throw new Error(
      `Shopee reply_comment từ chối: ${failed
        .map((f) => f.fail_message || f.fail_error)
        .join("; ")}`
    );
  }
}

// ---------- Ký quỹ / đối soát (Payment API, READ-ONLY) ----------

/** Một dòng của get_escrow_list — đơn đã được sàn GIẢI NGÂN trong khoảng lọc. */
export interface ShopeeEscrowListRow {
  order_sn?: string;
  payout_amount?: number;
  escrow_release_time?: number; // epoch giây — thời điểm sàn giải ngân
}

export interface ShopeeEscrowListData extends ShopeeEnvelope {
  response?: { escrow_list?: ShopeeEscrowListRow[]; more?: boolean };
}

/**
 * DS đơn ĐÃ GIẢI NGÂN ký quỹ theo khoảng release_time. Đây là tín hiệu
 * "quyết toán thật" duy nhất — get_escrow_detail trả được cả số ƯỚC TÍNH cho
 * đơn chưa giải ngân, nên KHÔNG được dùng riêng nó để đánh dấu isSettled.
 */
export async function getEscrowList(
  params: {
    accessToken: string;
    shopId: string;
    releaseTimeFrom: number; // epoch giây
    releaseTimeTo: number;
    pageNo?: number; // Shopee đánh số từ 1
    pageSize?: number;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeEscrowListData> {
  return callShopGet<ShopeeEscrowListData>(
    SHOPEE_PATHS.escrowList,
    params.accessToken,
    params.shopId,
    [
      ["release_time_from", params.releaseTimeFrom],
      ["release_time_to", params.releaseTimeTo],
      ["page_no", params.pageNo ?? 1],
      ["page_size", params.pageSize ?? 100],
    ],
    "get_escrow_list",
    cfg
  );
}

/**
 * Bảng thu nhập ký quỹ (order_income) của một đơn — mọi trường là SỐ DƯƠNG
 * (magnitude); chiều thu/chi do ngữ nghĩa từng trường quyết định. Chỉ khai
 * những trường Hubsell dùng; API còn nhiều trường khác (bỏ qua an toàn).
 */
export interface ShopeeOrderIncome {
  // Giá trị hàng & tiền về
  order_selling_price?: number;
  escrow_amount?: number; // tiền THỰC về ví (sau mọi cấn trừ)
  // Phí sàn
  commission_fee?: number;
  service_fee?: number;
  seller_transaction_fee?: number;
  credit_card_transaction_fee?: number;
  campaign_fee?: number;
  delivery_seller_protection_fee_premium_amount?: number;
  /** Phí "dịch vụ PiShip" (bảo hiểm giao hàng) — Seller Center VN tách dòng riêng. */
  shipping_seller_protection_fee_amount?: number;
  order_ams_commission_fee?: number; // hoa hồng quảng cáo affiliate (AMS)
  // Voucher / xu
  voucher_from_seller?: number;
  seller_coin_cash_back?: number;
  voucher_from_shopee?: number;
  coins?: number; // xu người mua dùng — sàn hoàn lại cho shop
  /** Sàn GIẢM TRỰC TIẾP vào giá bán và BÙ LẠI cho shop trong escrow — khoản
   * trợ giá sàn DUY NHẤT thực sự vào payout (đối chiếu đơn 260728T943X8PX). */
  shopee_discount?: number;
  original_shopee_discount?: number;
  /** Đơn hoàn: sàn hoàn tiền hàng cho khách (số ÂM) — escrow âm là vì đây. */
  seller_return_refund?: number;
  // Vận chuyển
  estimated_shipping_fee?: number; // cước sàn báo lúc đặt đơn
  actual_shipping_fee?: number;
  buyer_paid_shipping_fee?: number;
  shopee_shipping_rebate?: number;
  shipping_fee_discount_from_3pl?: number;
  final_shipping_fee?: number; // điều chỉnh ship ròng vào payout (có dấu)
  reverse_shipping_fee?: number;
  // Thuế sàn thu hộ. Đơn VN thật (đối chiếu 05/08/2026, đơn 2607303CGEHBCA)
  // KHÔNG dùng escrow_tax/withholding_tax mà tách 2 field VAT/PIT riêng.
  escrow_tax?: number;
  withholding_tax?: number;
  withholding_vat_tax?: number; // Thuế GTGT sàn thu hộ
  withholding_pit_tax?: number; // Thuế TNCN sàn thu hộ
}

export interface ShopeeEscrowDetailData extends ShopeeEnvelope {
  response?: {
    order_sn?: string;
    buyer_user_name?: string;
    return_order_sn_list?: string[];
    order_income?: ShopeeOrderIncome;
  };
}

/** Chi tiết thu nhập ký quỹ của MỘT đơn theo order_sn (read-only). */
export async function getEscrowDetail(
  params: { accessToken: string; shopId: string; orderSn: string },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeEscrowDetailData> {
  return callShopGet<ShopeeEscrowDetailData>(
    SHOPEE_PATHS.escrowDetail,
    params.accessToken,
    params.shopId,
    [["order_sn", params.orderSn]],
    "get_escrow_detail",
    cfg
  );
}

// ---------- Ví sàn (READ-ONLY) ----------

/** Một dòng giao dịch ví Shopee (rút tiền / giải ngân / phí…). */
export interface ShopeeWalletTxn {
  transaction_id?: number | string;
  status?: string; // vd COMPLETED / SUCCESS / PENDING / FAILED
  amount?: number; // âm/dương tuỳ money_flow; ta lấy trị tuyệt đối cho lệnh rút
  transaction_type?: string; // vd WITHDRAWAL_CREATED / WITHDRAWAL_COMPLETED
  create_time?: number; // epoch giây
  reason?: string;
  /// SỐ DƯ VÍ ngay SAU giao dịch này — Shopee không có API số dư riêng, nên
  /// current_balance của giao dịch MỚI NHẤT chính là số dư ví thật hiện tại.
  current_balance?: number;
  money_flow?: string; // MONEY_IN / MONEY_OUT
}

export interface ShopeeWalletTxnData extends ShopeeEnvelope {
  response?: { transaction_list?: ShopeeWalletTxn[]; more?: boolean };
}

export interface WalletTxnParams {
  accessToken: string;
  shopId: string;
  /** Khoảng thời gian (epoch giây) — Shopee giới hạn cửa sổ, chia lô ở tầng sync. */
  createTimeFrom: number;
  createTimeTo: number;
  pageNo?: number;
  pageSize?: number;
}

/**
 * Lấy LỊCH SỬ GIAO DỊCH VÍ (read-only). Dùng để đối soát dòng tiền rút về ngân
 * hàng. KHÔNG thực hiện bất kỳ thao tác chuyển tiền nào — chỉ đọc.
 */
export async function getWalletTransactionList(
  params: WalletTxnParams,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeWalletTxnData> {
  return callShopGet<ShopeeWalletTxnData>(
    SHOPEE_PATHS.walletTransactionList,
    params.accessToken,
    params.shopId,
    [
      // Trần page_size của endpoint này là 40 (nhỏ hơn các API khác) — truyền
      // quá trần sàn trả lỗi tham số, từng làm cron rút ví câm lặng 0 bản ghi.
      ["page_no", params.pageNo ?? 0],
      ["page_size", Math.min(params.pageSize ?? 40, 40)],
      ["create_time_from", params.createTimeFrom],
      ["create_time_to", params.createTimeTo],
    ],
    "get_wallet_transaction_list",
    cfg
  );
}

// ---------- Chi phí quảng cáo (Ads API, READ-ONLY) ----------

/** Một ngày hiệu suất quảng cáo CPC toàn shop — chỉ quan tâm expense (chi tiêu). */
export interface ShopeeAdsDailyPerformance {
  date?: string; // "DD-MM-YYYY"
  expense?: number;
  impression?: number;
  clicks?: number;
  broad_gmv?: number;
  direct_gmv?: number;
}

export interface ShopeeAdsDailyPerfData extends ShopeeEnvelope {
  // Shopee từng trả cả dạng mảng thẳng lẫn dạng bọc — parse phòng thủ ở tầng sync.
  response?:
    | ShopeeAdsDailyPerformance[]
    | { performance_list?: ShopeeAdsDailyPerformance[] };
}

export interface AdsDailyPerfParams {
  accessToken: string;
  shopId: string;
  /** Định dạng Shopee yêu cầu: "DD-MM-YYYY". */
  startDate: string;
  endDate: string;
}

/**
 * Lấy CHI TIÊU QUẢNG CÁO CPC toàn shop theo ngày (read-only). Ads API có thể
 * cần bật quyền riêng trên Console — lỗi permission ném ra để tầng sync log.
 */
export async function getAdsDailyPerformance(
  params: AdsDailyPerfParams,
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeAdsDailyPerfData> {
  return callShopGet<ShopeeAdsDailyPerfData>(
    SHOPEE_PATHS.adsAllCpcDaily,
    params.accessToken,
    params.shopId,
    [
      ["start_date", params.startDate],
      ["end_date", params.endDate],
    ],
    "get_all_cpc_ads_daily_performance",
    cfg
  );
}

// ---------- Trợ lý quảng cáo (Ads API cấp campaign, READ-ONLY) ----------
//
// GĐ1 chỉ dùng nhóm ĐỌC: danh sách campaign + cấu hình + hiệu suất ngày/giờ +
// số dư ví ads. Docs Shopee từng trả response lúc là object lúc là mảng bọc
// shop_id (đa shop) → mọi kiểu dưới đây khai phòng thủ, tầng sync tự bóc.

/** Một campaign trong danh sách id (chưa có tên — tên nằm ở setting_info). */
export interface ShopeeAdsCampaignRef {
  campaign_id?: number;
  ad_type?: string; // "auto" | "manual"
}

export interface ShopeeAdsCampaignIdListData extends ShopeeEnvelope {
  response?: {
    shop_id?: number;
    region?: string;
    has_next_page?: boolean;
    campaign_list?: ShopeeAdsCampaignRef[];
  };
}

/** DS campaign_id quảng cáo sản phẩm (phân trang offset/limit, ad_type "all"). */
export async function getAdsCampaignIdList(
  params: {
    accessToken: string;
    shopId: string;
    adType?: string; // "" | "all" | "auto" | "manual"
    offset?: number;
    limit?: number;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeAdsCampaignIdListData> {
  return callShopGet<ShopeeAdsCampaignIdListData>(
    SHOPEE_PATHS.adsCampaignIdList,
    params.accessToken,
    params.shopId,
    [
      ["ad_type", params.adType ?? "all"],
      ["offset", params.offset ?? 0],
      ["limit", params.limit ?? 100],
    ],
    "get_product_level_campaign_id_list",
    cfg
  );
}

/** Cấu hình chung của một campaign (info_type 1). */
export interface ShopeeAdsCampaignCommonInfo {
  ad_type?: string; // "auto" | "manual"
  ad_name?: string;
  campaign_status?: string; // ongoing | scheduled | ended | paused | deleted | closed
  bidding_method?: string; // "auto" | "manual"
  campaign_placement?: string; // search | discovery | all
  campaign_budget?: number; // 0 = không giới hạn
  campaign_duration?: { start_time?: number; end_time?: number }; // epoch giây, end 0 = không hẹn
  item_id_list?: number[];
}

export interface ShopeeAdsCampaignSettingEntry {
  campaign_id?: number;
  common_info?: ShopeeAdsCampaignCommonInfo;
  auto_bidding_info?: { roas_target?: number };
}

export interface ShopeeAdsCampaignSettingData extends ShopeeEnvelope {
  response?: {
    shop_id?: number;
    region?: string;
    campaign_list?: ShopeeAdsCampaignSettingEntry[];
  };
}

/** Cấu hình campaign theo lô ≤100 id. info_type_list "1,3" = common + ROAS target. */
export async function getAdsCampaignSettingInfo(
  params: {
    accessToken: string;
    shopId: string;
    campaignIds: Array<number | string>; // ≤100 — caller tự chia lô
    infoTypeList?: string;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeAdsCampaignSettingData> {
  return callShopGet<ShopeeAdsCampaignSettingData>(
    SHOPEE_PATHS.adsCampaignSettingInfo,
    params.accessToken,
    params.shopId,
    [
      ["info_type_list", params.infoTypeList ?? "1,3"],
      ["campaign_id_list", params.campaignIds.join(",")],
    ],
    "get_product_level_campaign_setting_info",
    cfg
  );
}

/** Một điểm hiệu suất ngày (hoặc giờ — thêm trường hour) của campaign. */
export interface ShopeeAdsCampaignMetricPoint {
  date?: string; // "DD-MM-YYYY"
  hour?: number; // 0-23, chỉ có ở API theo giờ
  impression?: number;
  clicks?: number;
  ctr?: number;
  expense?: number;
  broad_gmv?: number;
  broad_order?: number;
  broad_roi?: number;
  direct_gmv?: number;
  direct_order?: number;
  direct_roi?: number;
  cr?: number;
  cpc?: number;
}

export interface ShopeeAdsCampaignPerfEntry {
  campaign_id?: number;
  ad_type?: string;
  campaign_placement?: string;
  ad_name?: string;
  metrics_list?: ShopeeAdsCampaignMetricPoint[];
}

/** Response hiệu suất: docs mô tả dạng MẢNG bọc theo shop — khai cả hai kiểu. */
export interface ShopeeAdsCampaignPerfData extends ShopeeEnvelope {
  response?:
    | Array<{ shop_id?: number; region?: string; campaign_list?: ShopeeAdsCampaignPerfEntry[] }>
    | { shop_id?: number; region?: string; campaign_list?: ShopeeAdsCampaignPerfEntry[] };
}

/** Hiệu suất THEO NGÀY của từng campaign (lô ≤100 id, cửa sổ start→end). */
export async function getAdsCampaignDailyPerformance(
  params: {
    accessToken: string;
    shopId: string;
    campaignIds: Array<number | string>; // ≤100 — caller tự chia lô
    startDate: string; // "DD-MM-YYYY"
    endDate: string;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeAdsCampaignPerfData> {
  return callShopGet<ShopeeAdsCampaignPerfData>(
    SHOPEE_PATHS.adsCampaignDailyPerf,
    params.accessToken,
    params.shopId,
    [
      ["start_date", params.startDate],
      ["end_date", params.endDate],
      ["campaign_id_list", params.campaignIds.join(",")],
    ],
    "get_product_campaign_daily_performance",
    cfg
  );
}

/** Hiệu suất THEO GIỜ của từng campaign trong MỘT ngày (quy tắc spike GĐ2). */
export async function getAdsCampaignHourlyPerformance(
  params: {
    accessToken: string;
    shopId: string;
    campaignIds: Array<number | string>;
    performanceDate: string; // "DD-MM-YYYY"
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeAdsCampaignPerfData> {
  return callShopGet<ShopeeAdsCampaignPerfData>(
    SHOPEE_PATHS.adsCampaignHourlyPerf,
    params.accessToken,
    params.shopId,
    [
      ["performance_date", params.performanceDate],
      ["campaign_id_list", params.campaignIds.join(",")],
    ],
    "get_product_campaign_hourly_performance",
    cfg
  );
}

export interface ShopeeAdsTotalBalanceData extends ShopeeEnvelope {
  response?: { total_balance?: number; data_timestamp?: number };
}

/**
 * GĐ3 — LỆNH GHI DUY NHẤT của Trợ lý: sửa Manual Product Ads.
 * Trả NGUYÊN VĂN envelope (KHÔNG ensureOk) — caller tự đọc error/message để
 * ghi sổ AdsActionLog và học enum edit_action (docs không công bố, đang xác
 * minh bằng probe). reference_id chống double-fire phía sàn.
 */
export async function editManualProductAdsRaw(
  params: {
    accessToken: string;
    shopId: string;
    campaignId: number | string;
    editAction: string; // "pause" | ... (enum chưa xác minh)
    referenceId: string;
  },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeEnvelope & { response?: unknown }> {
  const path = SHOPEE_PATHS.adsEditManualProductAds;
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShop(
    cfg.partnerKey,
    cfg.partnerId,
    path,
    timestamp,
    params.accessToken,
    params.shopId
  );
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: params.accessToken,
    shop_id: params.shopId,
    sign,
  }).toString();
  const res = await fetch(`${cfg.apiBase}${path}?${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reference_id: params.referenceId,
      campaign_id: Number(params.campaignId),
      edit_action: params.editAction,
    }),
  });
  return (await res.json()) as ShopeeEnvelope & { response?: unknown };
}

/** Số dư ví quảng cáo real-time (read-only) — cảnh báo sắp hết tiền ads. */
export async function getAdsTotalBalance(
  params: { accessToken: string; shopId: string },
  cfg: ShopeeConfig = getShopeeConfig()
): Promise<ShopeeAdsTotalBalanceData> {
  return callShopGet<ShopeeAdsTotalBalanceData>(
    SHOPEE_PATHS.adsTotalBalance,
    params.accessToken,
    params.shopId,
    [],
    "get_total_balance",
    cfg
  );
}
