// ============================================================
// LAZADA — TẦNG NGHIỆP VỤ (có truy cập DB)
//
// client.ts là các hàm API THUẦN. File này ghép chúng với Prisma:
//   1) signOauthState/verifyOauthState — mang ownerId xuyên qua Lazada an toàn.
//   2) getValidLazadaAccessToken()     — tự refresh access_token khi sắp hết hạn.
//   3) handleLazadaCallback()          — đổi code → token → lưu/cập nhật Channel.
//
// CHƯA có đồng bộ đơn/sản phẩm — bước này chỉ lo KẾT NỐI gian hàng. Đồng bộ
// nghiệp vụ làm sau khi luồng OAuth đã kiểm chứng chạy thật (như trình tự Shopee).
// ============================================================

import jwt from "jsonwebtoken";
import type { Channel, Prisma } from "@prisma/client";
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { CHANNEL_LABEL, PLATFORM_FEE_RATE } from "../../mockMarketplace";
import {
  createToken,
  getMultipleOrderItems,
  getOrders,
  getSellerInfo,
  getTransactionDetails,
  lazadaChannelSku,
  refreshToken,
  type LazadaOrder,
  type LazadaOrderItem,
  type LazadaTokenData,
  type LazadaTransaction,
} from "./client";

// Refresh khi access_token còn <30 phút là hết hạn. Token Lazada sống 7 ngày
// nên biên rộng hơn Shopee (4h) một chút cũng không tốn thêm lượt refresh nào.
const REFRESH_BUFFER_MS = 30 * 60 * 1000;
// Phòng hờ khi Lazada không trả expires: access 7 ngày / refresh 30 ngày (theo
// cấu hình app trên Console).
const FALLBACK_ACCESS_TTL_S = 7 * 24 * 60 * 60;
const FALLBACK_REFRESH_TTL_S = 30 * 24 * 60 * 60;

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";

// FE của CHÍNH môi trường này. Nhét vào state lúc sinh URL uỷ quyền để callback
// (luôn chạy trên Render vì Lazada bắt https) biết luồng khởi phát từ đâu.
const STATE_FRONTEND_URL = process.env.APP_FRONTEND_URL ?? "http://localhost:3000";

// ---------- State chống CSRF + mang ownerId ----------
//
// Callback Lazada là endpoint CÔNG KHAI (không JWT) nên không tự biết đang kết
// nối cho chủ shop nào. Ta ký ownerId vào `state` (JWT ngắn hạn) lúc sinh URL
// uỷ quyền, Lazada trả lại nguyên vẹn ở callback — vừa định danh vừa chống giả mạo.

export function signOauthState(ownerId: string): string {
  return jwt.sign(
    { ownerId, purpose: "lazada_oauth", fe: STATE_FRONTEND_URL },
    STATE_SECRET,
    { expiresIn: "10m" }
  );
}

export function verifyOauthState(token: string): string | null {
  try {
    const payload = jwt.verify(token, STATE_SECRET) as jwt.JwtPayload;
    if (payload.purpose !== "lazada_oauth" || !payload.ownerId) return null;
    return String(payload.ownerId);
  } catch {
    return null;
  }
}

/**
 * Đọc origin FE từ state mà KHÔNG kiểm chữ ký — dùng khi state do MÔI TRƯỜNG
 * KHÁC ký (dev local ký bằng secret khác nên Render không verify được). Vì
 * không tin được nội dung, chỉ chấp nhận origin localhost để bật code về máy
 * dev; mọi giá trị khác trả null (chặn open-redirect).
 */
export function decodeOauthStateOrigin(token: string): string | null {
  try {
    const payload = jwt.decode(token) as jwt.JwtPayload | null;
    if (!payload || payload.purpose !== "lazada_oauth") return null;
    const fe = typeof payload.fe === "string" ? payload.fe : "";
    return /^https?:\/\/localhost(:\d+)?$/.test(fe) ? fe : null;
  } catch {
    return null;
  }
}

// ---------- Tự refresh access_token ----------

/**
 * Trả access_token còn hạn cho một gian Lazada, TỰ refresh nếu sắp/đã hết hạn
 * rồi lưu token mới xuống DB. Gọi NGAY TRƯỚC mọi lượt gọi API nghiệp vụ Lazada.
 */
export async function getValidLazadaAccessToken(channel: Channel): Promise<string> {
  if (channel.channelName !== ChannelName.LAZADA) {
    throw new Error("Gian hàng này không phải Lazada");
  }
  if (!channel.apiToken || !channel.refreshToken) {
    throw new Error("Gian hàng chưa uỷ quyền Lazada (thiếu token)");
  }

  const now = Date.now();
  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;
  if (accessExp - now > REFRESH_BUFFER_MS) {
    return channel.apiToken;
  }

  const refreshExp = channel.refreshTokenExpireAt?.getTime() ?? 0;
  if (refreshExp && refreshExp < now) {
    throw new Error("Phiên uỷ quyền Lazada đã hết hạn (refresh_token). Vui lòng kết nối lại.");
  }

  const t = await refreshToken(channel.refreshToken);
  if (!t.access_token || !t.refresh_token) {
    throw new Error("Lazada không trả token khi refresh");
  }
  await prisma.channel.update({
    where: { id: channel.id },
    data: tokenFields(t, now),
  });
  return t.access_token;
}

/** Các cột token của Channel tính từ payload token Lazada. */
function tokenFields(t: LazadaTokenData, nowMs: number) {
  return {
    apiToken: t.access_token,
    refreshToken: t.refresh_token,
    accessTokenExpireAt: new Date(nowMs + (t.expires_in ?? FALLBACK_ACCESS_TTL_S) * 1000),
    refreshTokenExpireAt: new Date(
      nowMs + (t.refresh_expires_in ?? FALLBACK_REFRESH_TTL_S) * 1000
    ),
  };
}

// ---------- Xử lý callback: đổi token + lưu Channel ----------

export interface LazadaConnectResult {
  id: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  status: string;
}

/**
 * Đổi `code` (Lazada trả ở callback) lấy token, lấy seller_id + tên gian rồi
 * tạo mới / cập nhật Channel cho chủ shop `ownerId`. Định danh gian theo
 * (userId, channelName=LAZADA, externalShopId=seller_id) — idempotent khi kết
 * nối lại. Lazada KHÔNG kiểm redirect_uri ở bước đổi token nên hàm này dùng
 * được cho cả callback tự động (Render) lẫn luồng dán code thủ công (local).
 */
export async function handleLazadaCallback(
  ownerId: string,
  code: string
): Promise<LazadaConnectResult> {
  const token = await createToken(code);
  if (!token.access_token || !token.refresh_token) {
    throw new Error("Lazada không trả access_token/refresh_token");
  }

  // seller_id ưu tiên lấy từ payload token (thị trường VN); thiếu thì hỏi
  // /seller/get. Tên gian lấy từ /seller/get — lỗi ở bước lấy tên không được
  // làm hỏng cả kết nối.
  let sellerId =
    token.country_user_info?.find((c) => (c.country ?? "").toLowerCase() === "vn")
      ?.seller_id ??
    token.country_user_info?.[0]?.seller_id ??
    null;
  let externalShopName: string | null = null;
  try {
    const info = await getSellerInfo(token.access_token);
    externalShopName = info.name?.trim() || null;
    if (!sellerId && info.seller_id != null) sellerId = String(info.seller_id);
  } catch {
    externalShopName = null;
  }
  if (!sellerId) {
    throw new Error("Lazada không trả seller_id — không định danh được gian hàng");
  }
  const shopId = String(sellerId);

  const now = Date.now();
  const tokenData = {
    ...tokenFields(token, now),
    externalShopName,
    status: "ACTIVE",
  };

  const existing = await prisma.channel.findFirst({
    where: {
      userId: ownerId,
      channelName: ChannelName.LAZADA,
      externalShopId: shopId,
    },
  });

  if (existing) {
    const updated = await prisma.channel.update({
      where: { id: existing.id },
      data: tokenData,
    });
    return toResult(updated);
  }

  // Tên gian mặc định = tên phía Lazada, tránh trùng tên gian đã có trong cùng sàn.
  let shopName = externalShopName || `${CHANNEL_LABEL[ChannelName.LAZADA]} ${shopId}`;
  const clash = await prisma.channel.findFirst({
    where: { userId: ownerId, channelName: ChannelName.LAZADA, shopName },
    select: { id: true },
  });
  if (clash) shopName = `${shopName} (${shopId.slice(-4)})`;

  const created = await prisma.channel.create({
    data: {
      userId: ownerId,
      channelName: ChannelName.LAZADA,
      shopName,
      externalShopId: shopId,
      feeRate: PLATFORM_FEE_RATE[ChannelName.LAZADA],
      ...tokenData,
    },
  });
  return toResult(created);
}

function toResult(c: Channel): LazadaConnectResult {
  return {
    id: c.id,
    channelName: c.channelName,
    shopName: c.shopName,
    externalShopId: c.externalShopId,
    status: c.status,
  };
}

// ============================================================
// ĐỒNG BỘ ĐƠN HÀNG LAZADA — kéo đơn thật → upsert vào DB
//
// Cấu trúc mirror Shopee: phân trang, upsert idempotent theo (channelId,
// orderCode), snapshot giá vốn qua mapping SKU. CỐ Ý KHÔNG trừ tồn kho (đồng bộ
// lô chạy lặp) — trừ kho real-time là việc của luồng webhook sau này (nếu làm).
// ============================================================

const ORDER_LIST_PAGE_SIZE = 100; // Lazada cho tối đa 100 đơn/trang orders/get
const ORDER_ITEMS_BATCH = 50; // tối đa 50 order_id/lần orders/items/get
const MAX_PAGES = 100; // chốt chặn phân trang vô tận

/**
 * Ánh xạ trạng thái đơn Lazada → vòng đời của Hubsell. Lazada trả trạng thái
 * theo TỪNG KIỆN (mảng statuses); tầng gọi đã chọn trạng thái đại diện.
 */
function mapLazadaStatus(status?: string): ShippingStatus {
  switch (status) {
    case "unpaid":
    case "pending":
      return ShippingStatus.PENDING;
    case "packed":
    case "repacked":
    case "ready_to_ship":
    case "ready_to_ship_pending":
      return ShippingStatus.PROCESSED;
    case "shipped":
    case "shipping":
      return ShippingStatus.SHIPPING;
    case "delivered":
    case "confirmed":
    case "returned": // hàng đã giao rồi mới hoàn — trục hoàn xử lý riêng bên dưới
      return ShippingStatus.DELIVERED;
    case "canceled":
    case "cancelled":
    case "failed":
    case "failed_delivery":
      return ShippingStatus.CANCELLED;
    default:
      return ShippingStatus.PENDING;
  }
}

/**
 * Đơn Lazada đang HOÀN/TRẢ → cờ trên trục returnStatus (độc lập shippingStatus).
 * Nhận diện mọi trạng thái chứa "return" (returned / return_initiated /
 * shipped_back...). CHỈ nhận diện, KHÔNG tự cộng kho — cộng kho khi hàng về là
 * của luồng nhận hàng hoàn ở kho (như Shopee).
 */
function lazadaReturnStatus(status?: string): ReturnStatus | null {
  return status && status.includes("return") ? ReturnStatus.AWAITING : null;
}

/**
 * Chọn TRẠNG THÁI ĐẠI DIỆN cho đơn từ mảng statuses theo kiện: ưu tiên trạng
 * thái "đi xa nhất" trong vòng đời để đơn giao một phần không bị tụt về PENDING;
 * riêng đơn toàn kiện huỷ mới coi là huỷ.
 */
function pickLazadaStatus(statuses?: string[]): string | undefined {
  const list = (statuses ?? []).filter(Boolean);
  if (list.length === 0) return undefined;
  const rank = (s: string): number => {
    if (s.includes("return")) return 5;
    switch (mapLazadaStatus(s)) {
      case ShippingStatus.DELIVERED:
        return 4;
      case ShippingStatus.SHIPPING:
        return 3;
      case ShippingStatus.PROCESSED:
        return 2;
      case ShippingStatus.PENDING:
        return 1;
      case ShippingStatus.CANCELLED:
        return 0; // huỷ chỉ thắng khi MỌI kiện đều huỷ (min rank)
    }
  };
  const allCancelled = list.every((s) => mapLazadaStatus(s) === ShippingStatus.CANCELLED);
  if (allCancelled) return list[0];
  const active = list.filter((s) => mapLazadaStatus(s) !== ShippingStatus.CANCELLED);
  return active.sort((a, b) => rank(b) - rank(a))[0];
}

/**
 * Gộp dòng hàng theo SKU người bán. ĐẶC THÙ LAZADA: mỗi dòng item là MỘT ĐƠN VỊ
 * (khách mua 3 = 3 dòng lặp, không có trường quantity) → quantity = số dòng
 * trùng SKU, giá lấy paid_price của từng đơn vị.
 */
function aggregateLazadaItems(items: LazadaOrderItem[]) {
  const agg = new Map<
    string,
    { channelSku: string; productName: string; price: number; quantity: number }
  >();
  for (const it of items) {
    const sku = lazadaChannelSku({
      sellerSku: it.sku,
      shopSku: it.shop_sku,
      itemId: it.product_id,
      skuId: it.order_item_id,
    });
    const price = Number(it.paid_price ?? it.item_price ?? 0) || 0;
    const name = [it.name, it.variation].filter(Boolean).join(" - ") || sku;
    const ex = agg.get(sku);
    if (ex) ex.quantity += 1;
    else agg.set(sku, { channelSku: sku, productName: name, price, quantity: 1 });
  }
  return [...agg.values()];
}

export interface SyncLazadaOrdersOptions {
  /** Lấy đơn tạo trong bao nhiêu ngày gần nhất. Mặc định 90. */
  daysBack?: number;
  maxPages?: number;
}

export interface SyncLazadaOrdersResult {
  fetched: number;
  created: number;
  updated: number;
  itemsCreated: number;
  pages: number;
}

/**
 * Kéo đơn hàng thật từ Lazada và upsert vào DB (idempotent theo (channelId,
 * order_number)). orders/get phân trang offset; dòng hàng lấy theo lô ≤50 đơn.
 */
export async function syncLazadaOrders(
  channel: Channel,
  opts: SyncLazadaOrdersOptions = {}
): Promise<SyncLazadaOrdersResult> {
  const accessToken = await getValidLazadaAccessToken(channel);

  const daysBack = opts.daysBack ?? 90;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const createdAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.LAZADA];

  const result: SyncLazadaOrdersResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    itemsCreated: 0,
    pages: 0,
  };

  // (1) Gom toàn bộ đơn qua phân trang offset.
  const orders: LazadaOrder[] = [];
  let offset = 0;
  for (;;) {
    const page = await getOrders({ accessToken, createdAfter, offset, limit: ORDER_LIST_PAGE_SIZE });
    result.pages++;
    orders.push(...page.orders);
    offset += page.orders.length;
    if (page.orders.length < ORDER_LIST_PAGE_SIZE || result.pages >= maxPages) break;
  }

  // (2) Lấy dòng hàng theo lô ≤50 order_id rồi upsert từng đơn.
  const withId = orders.filter((o) => o.order_id != null);
  for (let i = 0; i < withId.length; i += ORDER_ITEMS_BATCH) {
    const batch = withId.slice(i, i + ORDER_ITEMS_BATCH);
    const itemsByOrder = await getMultipleOrderItems(
      accessToken,
      batch.map((o) => o.order_id!)
    );
    for (const order of batch) {
      result.fetched++;
      const items = itemsByOrder.get(String(order.order_id)) ?? [];
      const outcome = await prisma.$transaction((tx) =>
        upsertLazadaOrderTx(tx, channel, order, items, feeRate)
      );
      if (outcome.created) {
        result.created++;
        result.itemsCreated += outcome.itemsCreated;
      } else {
        result.updated++;
      }
    }
  }

  return result;
}

/**
 * Tạo mới / cập nhật MỘT đơn Lazada trong transaction. Tạo mới kèm OrderItem +
 * snapshot giá vốn; đã tồn tại thì chỉ cập nhật trường biến động (trạng thái,
 * tổng tiền) — không đụng OrderItem để giữ nguyên snapshot. Mirror Shopee.
 */
export async function upsertLazadaOrderTx(
  tx: Prisma.TransactionClient,
  channel: Channel,
  order: LazadaOrder,
  items: LazadaOrderItem[],
  feeRate: number
): Promise<{ created: boolean; itemsCreated: number }> {
  const orderCode = String(order.order_number ?? order.order_id);
  const totalAmount = Number(order.price ?? 0) || 0;
  const repStatus = pickLazadaStatus(order.statuses);
  const shippingStatus = mapLazadaStatus(repStatus);
  const returning = lazadaReturnStatus(repStatus);
  const paymentStatus = repStatus === "unpaid" ? "UNPAID" : "PAID";
  const shipName = [order.address_shipping?.first_name, order.address_shipping?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const buyerName = [order.customer_first_name, order.customer_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const customerName = shipName || buyerName || "Khách Lazada";
  const customerPhone = order.address_shipping?.phone?.trim() || null;

  const existing = await tx.order.findUnique({
    where: { channelId_orderCode: { channelId: channel.id, orderCode } },
    select: { id: true, returnStatus: true },
  });

  if (existing) {
    await tx.order.update({
      where: { id: existing.id },
      data: {
        shippingStatus,
        paymentStatus,
        totalAmount,
        // Chỉ TIẾN cờ hoàn NONE → AWAITING; KHÔNG đụng nếu kho đã xử lý xong.
        ...(returning && existing.returnStatus === ReturnStatus.NONE
          ? { returnStatus: returning }
          : {}),
      },
    });
    return { created: false, itemsCreated: 0 };
  }

  const lines = aggregateLazadaItems(items);
  const skus = lines.map((l) => l.channelSku);
  // Lấy CẢ dòng chưa liên kết kho: giá vốn khi đó nằm ở cấp SKU sàn (costPrice
  // của ChannelProduct) — khách không nối kho gốc vẫn tính được lãi/lỗ.
  const mappings = skus.length
    ? await tx.channelProduct.findMany({
        where: { channelId: channel.id, channelSku: { in: skus } },
        select: {
          channelSku: true,
          productId: true,
          costPrice: true,
          product: { select: { costPrice: true } },
        },
      })
    : [];
  const mapBySku = new Map(mappings.map((m) => [m.channelSku, m]));

  const created = await tx.order.create({
    data: {
      channelId: channel.id,
      orderCode,
      customerName,
      customerPhone,
      totalAmount,
      platformFee: Math.round(totalAmount * feeRate), // GĐ1 — tạm tính
      paymentStatus,
      shippingStatus,
      ...(returning ? { returnStatus: returning } : {}),
      itemCount: lines.length,
      createdAt: order.created_at ? new Date(order.created_at) : undefined,
    },
  });

  for (const line of lines) {
    const mp = mapBySku.get(line.channelSku);
    await tx.orderItem.create({
      data: {
        orderId: created.id,
        productId: mp?.productId ?? null,
        channelSku: line.channelSku,
        productName: line.productName,
        quantity: line.quantity,
        price: line.price,
        // Đã nối kho → giá vốn sản phẩm gốc; chưa nối → giá vốn cấp SKU sàn.
        costPriceAtSale: String(mp?.product?.costPrice ?? mp?.costPrice ?? 0),
      },
    });
  }

  return { created: true, itemsCreated: lines.length };
}

// ============================================================
// ĐỒNG BỘ QUYẾT TOÁN LAZADA — kéo SỐ PHÍ THẬT từ Finance API → ghi vào đơn
//
// /finance/transaction/details/get trả sao kê THEO DÒNG PHÍ: mỗi đơn quyết toán
// gồm nhiều dòng — tiền hàng (+), hoa hồng (−), phí thanh toán (−), phí vận
// chuyển (±), voucher (±), thuế thu hộ (−)... Ta gom theo mã đơn (order_no ↔
// Order.orderCode), PHÂN LOẠI theo fee_name rồi ghi vào các cột quyết toán GĐ2
// của Order — từ đó Lãi/Lỗ Thực Hiện và Báo cáo dòng tiền dùng số THẬT thay %
// tạm tính (orderPlatformFee tự chuyển nguồn khi isSettled=true).
//
// NGUYÊN TẮC PHÂN LOẠI (phòng thủ — tên phí Lazada VN không có danh mục đóng):
//   · Khớp từ khoá không phân biệt hoa thường trên fee_name.
//   · Dòng ÂM không nhận diện được → dồn vào serviceFee (nhóm "phí sàn khác")
//     — thà gộp thô còn hơn bỏ sót làm lệch tổng.
//   · Dòng DƯƠNG không phải tiền hàng → platformSubsidy (sàn trợ giá/hoàn phí).
//   · actualPayout = TỔNG ĐẠI SỐ mọi dòng của đơn — luôn đúng bằng tiền về ví
//     bất kể phân loại đúng sai đến đâu.
// ============================================================

/** Cửa sổ tối đa mỗi lần gọi Finance API (giới hạn Lazada ~30 ngày). */
const SETTLE_WINDOW_DAYS = 30;
const SETTLE_PAGE_SIZE = 500;
const SETTLE_MAX_PAGES = 200; // chốt chặn phân trang vô tận toàn lượt chạy

/** Cộng dồn phí của MỘT đơn trong lúc quét sao kê (số CÓ DẤU theo Lazada). */
interface LazadaFeeAcc {
  itemPrice: number; // tiền hàng sàn ghi có (+)
  commission: number; // hoa hồng (Commission...)
  payment: number; // phí thanh toán (Payment Fee)
  affiliate: number; // tiếp thị liên kết (Sponsored Affiliates...)
  voucherNeg: number; // voucher shop chịu (dòng âm)
  voucherPos: number; // voucher sàn bù (dòng dương)
  shipNeg: number; // phí vận chuyển sàn trừ (âm, giữ dấu)
  shipPos: number; // phí vận chuyển khách trả/sàn bù (dương)
  tax: number; // thuế sàn thu hộ (âm)
  otherNeg: number; // phí âm không nhận diện được
  otherPos: number; // khoản dương không nhận diện được
  total: number; // tổng đại số mọi dòng = tiền về ví
  lines: number;
  lastDate?: Date;
}

function emptyAcc(): LazadaFeeAcc {
  return {
    itemPrice: 0, commission: 0, payment: 0, affiliate: 0,
    voucherNeg: 0, voucherPos: 0, shipNeg: 0, shipPos: 0,
    tax: 0, otherNeg: 0, otherPos: 0, total: 0, lines: 0,
  };
}

/**
 * Đọc số tiền từ sao kê Lazada VỀ SỐ CHUẨN. Lazada VN có thể trả "−1.208,00"
 * (chấm ngăn nghìn, phẩy thập phân, dấu trừ unicode) — Number() thuần sẽ ra
 * NaN và nuốt mất phí. Quy tắc: ký tự , hoặc . đứng SAU CÙNG là dấu thập phân.
 */
export function parseLazadaAmount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "")
    .trim()
    .replace(/−/g, "-") // dấu trừ unicode → ASCII
    .replace(/[^0-9,.\-]/g, ""); // bỏ ký hiệu tiền tệ, khoảng trắng
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", "."); // kiểu VN/EU: 1.208,50
  } else {
    s = s.replace(/,/g, ""); // kiểu US: 1,208.50
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Phân loại MỘT dòng sao kê vào bộ cộng dồn của đơn. */
function accumulateLazadaFee(acc: LazadaFeeAcc, trx: LazadaTransaction): void {
  const amount = parseLazadaAmount(trx.amount);
  const name = String(trx.fee_name ?? trx.feeName ?? "").toLowerCase();

  acc.total += amount;
  acc.lines++;
  const d = new Date(String(trx.transaction_date ?? trx.transactionDate ?? ""));
  if (!Number.isNaN(d.getTime()) && (!acc.lastDate || d > acc.lastDate)) {
    acc.lastDate = d;
  }

  if (name.includes("item price")) acc.itemPrice += amount;
  else if (name.includes("commission")) acc.commission += amount;
  else if (name.includes("payment")) acc.payment += amount;
  else if (name.includes("sponsor") || name.includes("affiliate")) acc.affiliate += amount;
  else if (name.includes("voucher")) {
    if (amount < 0) acc.voucherNeg += amount;
    else acc.voucherPos += amount;
  } else if (name.includes("shipping") || name.includes("logistic")) {
    if (amount < 0) acc.shipNeg += amount;
    else acc.shipPos += amount;
  } else if (name.includes("tax") || name.includes("tcs") || name.includes("wht")) {
    acc.tax += amount;
  } else if (amount < 0) acc.otherNeg += amount;
  else acc.otherPos += amount;
}

export interface SyncLazadaSettlementsOptions {
  /** Quét sao kê trong bao nhiêu ngày gần nhất. Mặc định 90 (chia cửa sổ 30 ngày). */
  daysBack?: number;
}

export interface SyncLazadaSettlementsResult {
  transactions: number; // số dòng sao kê đọc được
  ordersUpdated: number; // số Order được ghi số quyết toán thật
  ordersNotFound: number; // sao kê có mã đơn nhưng đơn chưa đồng bộ về Hubsell
}

/**
 * Kéo sao kê tài chính thật của một gian Lazada rồi ghi số quyết toán vào từng
 * đơn. Idempotent: chạy lặp chỉ ghi đè cùng bộ số (sao kê là nguồn sự thật).
 */
export async function syncLazadaSettlements(
  channel: Channel,
  opts: SyncLazadaSettlementsOptions = {}
): Promise<SyncLazadaSettlementsResult> {
  const accessToken = await getValidLazadaAccessToken(channel);
  const daysBack = opts.daysBack ?? 90;

  const result: SyncLazadaSettlementsResult = {
    transactions: 0,
    ordersUpdated: 0,
    ordersNotFound: 0,
  };

  // Gom theo mã đơn trên TOÀN lượt chạy (một đơn có thể nằm vắt qua 2 cửa sổ
  // nếu quyết toán rải ngày) rồi mới ghi DB một thể.
  const byOrder = new Map<string, LazadaFeeAcc>();
  // Thống kê fee_name thật gặp trong lượt chạy — log cuối lượt để đối chiếu bộ
  // phân loại với danh mục phí thực tế của Lazada VN (danh mục không có tài
  // liệu đóng, phải soi từ dữ liệu thật).
  const byFeeName = new Map<string, { count: number; sum: number }>();
  const fmt = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD

  let pages = 0;
  const now = new Date();
  for (
    let winStart = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    winStart < now && pages < SETTLE_MAX_PAGES;
    winStart = new Date(winStart.getTime() + SETTLE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  ) {
    const winEnd = new Date(
      Math.min(winStart.getTime() + SETTLE_WINDOW_DAYS * 24 * 60 * 60 * 1000, now.getTime())
    );

    for (let offset = 0; pages < SETTLE_MAX_PAGES; offset += SETTLE_PAGE_SIZE) {
      pages++;
      const rows = await getTransactionDetails({
        accessToken,
        startTime: fmt(winStart),
        endTime: fmt(winEnd),
        offset,
        limit: SETTLE_PAGE_SIZE,
      });
      for (const trx of rows) {
        const feeName = String(trx.fee_name ?? trx.feeName ?? "?");
        const stat = byFeeName.get(feeName) ?? { count: 0, sum: 0 };
        stat.count++;
        stat.sum += parseLazadaAmount(trx.amount);
        byFeeName.set(feeName, stat);

        const orderNo = String(trx.order_no ?? trx.orderNo ?? "").trim();
        if (!orderNo) continue; // dòng không gắn đơn (phí thuê bao, nạp ví...) — bỏ qua ở cấp đơn
        result.transactions++;
        const acc = byOrder.get(orderNo) ?? emptyAcc();
        accumulateLazadaFee(acc, trx);
        byOrder.set(orderNo, acc);
      }
      if (rows.length < SETTLE_PAGE_SIZE) break; // hết trang của cửa sổ này
    }
  }

  // Log danh mục phí thật gặp được — mỗi lượt chạy một dòng, soi ở log server.
  if (byFeeName.size > 0) {
    console.log(
      `[Lazada Settle] Gian "${channel.shopName}" — fee_name gặp trong sao kê:`,
      JSON.stringify(
        [...byFeeName.entries()].map(([name, s]) => ({ name, ...s }))
      )
    );
  }

  // Ghi số quyết toán vào từng đơn theo (channelId, orderCode).
  for (const [orderNo, acc] of byOrder) {
    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderNo } },
      select: { id: true },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }

    // Đổi từ số CÓ DẤU của Lazada sang các cột LƯU DƯƠNG của Hubsell.
    const shipCharged = -acc.shipNeg; // sàn trừ shop (dương)
    const shipCovered = acc.shipPos; // khách trả/sàn bù (dương)
    await prisma.order.update({
      where: { id: order.id },
      data: {
        isSettled: true,
        settledAt: acc.lastDate ?? new Date(),
        serviceFee: -acc.commission + -acc.otherNeg, // hoa hồng + phí âm chưa nhận diện
        paymentFee: -acc.payment,
        affiliateFee: -acc.affiliate,
        sellerVoucher: -acc.voucherNeg,
        // Chênh lệch ship shop THỰC chịu; sàn bù dư thì phần dư sang trợ giá.
        shippingFeeActual: shipCharged,
        shippingFeeQuoted: shipCovered,
        shippingFeeDiff: Math.max(shipCharged - shipCovered, 0),
        platformSubsidy:
          acc.voucherPos + acc.otherPos + Math.max(shipCovered - shipCharged, 0),
        taxWithheld: Math.max(-acc.tax, 0),
        actualPayout: acc.total,
      },
    });
    result.ordersUpdated++;
  }

  return result;
}
