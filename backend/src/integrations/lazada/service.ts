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
  lazadaChannelSku,
  refreshToken,
  type LazadaOrder,
  type LazadaOrderItem,
  type LazadaTokenData,
} from "./client";

// Refresh khi access_token còn <30 phút là hết hạn. Token Lazada sống 7 ngày
// nên biên rộng hơn Shopee (4h) một chút cũng không tốn thêm lượt refresh nào.
const REFRESH_BUFFER_MS = 30 * 60 * 1000;
// Phòng hờ khi Lazada không trả expires: access 7 ngày / refresh 30 ngày (theo
// cấu hình app trên Console).
const FALLBACK_ACCESS_TTL_S = 7 * 24 * 60 * 60;
const FALLBACK_REFRESH_TTL_S = 30 * 24 * 60 * 60;

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";

// ---------- State chống CSRF + mang ownerId ----------
//
// Callback Lazada là endpoint CÔNG KHAI (không JWT) nên không tự biết đang kết
// nối cho chủ shop nào. Ta ký ownerId vào `state` (JWT ngắn hạn) lúc sinh URL
// uỷ quyền, Lazada trả lại nguyên vẹn ở callback — vừa định danh vừa chống giả mạo.

export function signOauthState(ownerId: string): string {
  return jwt.sign({ ownerId, purpose: "lazada_oauth" }, STATE_SECRET, { expiresIn: "10m" });
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
  const mappings = skus.length
    ? await tx.channelProduct.findMany({
        where: { channelId: channel.id, channelSku: { in: skus }, productId: { not: null } },
        select: { channelSku: true, productId: true, product: { select: { costPrice: true } } },
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
        costPriceAtSale: String(mp?.product?.costPrice ?? 0),
      },
    });
  }

  return { created: true, itemsCreated: lines.length };
}
