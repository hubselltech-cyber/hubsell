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
    [
      ["order_sn_list", orderSnList.join(",")],
      ["response_optional_fields", ORDER_DETAIL_FIELDS],
    ],
    "get_order_detail",
    cfg
  );
  return data.response?.order_list ?? [];
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
      ["page_no", params.pageNo ?? 0],
      ["page_size", params.pageSize ?? 100],
      ["create_time_from", params.createTimeFrom],
      ["create_time_to", params.createTimeTo],
    ],
    "get_wallet_transaction_list",
    cfg
  );
}
