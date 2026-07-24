// ============================================================
// SHOPEE — TẦNG NGHIỆP VỤ (có truy cập DB)
//
// client.ts là các hàm API THUẦN. File này ghép chúng với Prisma:
//   1) signOauthState/verifyOauthState — mang ownerId xuyên qua Shopee an toàn.
//   2) getValidShopeeAccessToken()     — tự refresh access_token khi sắp hết hạn.
//   3) handleShopeeCallback()          — đổi code → token → lưu/ cập nhật Channel.
// ============================================================

import jwt from "jsonwebtoken";
import type { Channel, Prisma } from "@prisma/client";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { CHANNEL_LABEL, PLATFORM_FEE_RATE } from "../../mockMarketplace";
import {
  getAccessToken,
  getOrderDetail,
  getOrderList,
  getShopInfo,
  refreshAccessToken,
  shopeeChannelSku,
  type ShopeeOrderDetail,
} from "./client";

// Refresh khi access_token còn <5 phút là hết hạn (chừa biên cho call nối tiếp).
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Refresh_token của Shopee sống 30 ngày — hết thì buộc uỷ quyền lại.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const STATE_SECRET = process.env.JWT_SECRET ?? "hubsell_dev_jwt_secret_change_me";

// ---------- State chống CSRF + mang ownerId ----------
//
// Callback Shopee là endpoint CÔNG KHAI (không JWT) nên không tự biết đang kết nối
// cho chủ shop nào. Ta ký ownerId vào `state` (JWT ngắn hạn) lúc sinh URL uỷ quyền,
// Shopee trả lại nguyên vẹn ở callback để khôi phục ownerId — vừa định danh vừa
// chống giả mạo.

export function signOauthState(ownerId: string): string {
  return jwt.sign({ ownerId, purpose: "shopee_oauth" }, STATE_SECRET, { expiresIn: "10m" });
}

export function verifyOauthState(token: string): string | null {
  try {
    const payload = jwt.verify(token, STATE_SECRET) as jwt.JwtPayload;
    if (payload.purpose !== "shopee_oauth" || !payload.ownerId) return null;
    return String(payload.ownerId);
  } catch {
    return null;
  }
}

// ---------- Tự refresh access_token ----------

export interface ShopeeAccessContext {
  accessToken: string;
  shopId: string;
}

/**
 * Trả access_token còn hạn cho một gian Shopee, TỰ refresh nếu sắp/đã hết hạn rồi
 * lưu token mới xuống DB. Gọi NGAY TRƯỚC mọi lượt gọi API nghiệp vụ Shopee.
 */
export async function getValidShopeeAccessToken(
  channel: Channel
): Promise<ShopeeAccessContext> {
  if (channel.channelName !== ChannelName.SHOPEE) {
    throw new Error("Gian hàng này không phải Shopee");
  }
  if (!channel.apiToken || !channel.refreshToken || !channel.externalShopId) {
    throw new Error("Gian hàng chưa uỷ quyền Shopee (thiếu token/shop_id)");
  }

  const now = Date.now();
  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;
  if (accessExp - now > REFRESH_BUFFER_MS) {
    return { accessToken: channel.apiToken, shopId: channel.externalShopId };
  }

  const refreshExp = channel.refreshTokenExpireAt?.getTime() ?? 0;
  if (refreshExp && refreshExp < now) {
    throw new Error("Phiên uỷ quyền Shopee đã hết hạn (refresh_token). Vui lòng kết nối lại.");
  }

  const t = await refreshAccessToken(channel.refreshToken, channel.externalShopId);
  if (!t.access_token || !t.refresh_token) {
    throw new Error("Shopee không trả token khi refresh");
  }
  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      apiToken: t.access_token,
      refreshToken: t.refresh_token,
      accessTokenExpireAt: new Date(now + (t.expire_in ?? 0) * 1000),
      refreshTokenExpireAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  });
  return { accessToken: t.access_token, shopId: channel.externalShopId };
}

// ---------- Xử lý callback: đổi token + lưu Channel ----------

export interface ShopeeConnectResult {
  id: string;
  channelName: ChannelName;
  shopName: string;
  externalShopId: string | null;
  status: string;
}

/**
 * Đổi `code`+`shop_id` (Shopee trả ở callback) lấy token, lấy tên gian rồi
 * tạo mới / cập nhật Channel cho chủ shop `ownerId`. Định danh gian theo
 * (userId, channelName=SHOPEE, externalShopId=shop_id) — idempotent khi kết nối lại.
 */
export async function handleShopeeCallback(
  ownerId: string,
  code: string,
  shopId: string
): Promise<ShopeeConnectResult> {
  const token = await getAccessToken(code, shopId);
  if (!token.access_token || !token.refresh_token) {
    throw new Error("Shopee không trả access_token/refresh_token");
  }

  // Lấy tên gian để hiển thị — lỗi ở bước này không được làm hỏng cả kết nối.
  let externalShopName: string | null = null;
  try {
    const info = await getShopInfo(token.access_token, shopId);
    externalShopName = info.shop_name?.trim() || null;
  } catch {
    externalShopName = null;
  }

  const now = Date.now();
  const tokenData = {
    apiToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpireAt: new Date(now + (token.expire_in ?? 0) * 1000),
    refreshTokenExpireAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    externalShopName,
    status: "ACTIVE",
  };

  const existing = await prisma.channel.findFirst({
    where: {
      userId: ownerId,
      channelName: ChannelName.SHOPEE,
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

  // Tên gian mặc định = tên phía Shopee, tránh trùng tên gian đã có trong cùng sàn.
  let shopName = externalShopName || `${CHANNEL_LABEL[ChannelName.SHOPEE]} ${shopId}`;
  const clash = await prisma.channel.findFirst({
    where: { userId: ownerId, channelName: ChannelName.SHOPEE, shopName },
    select: { id: true },
  });
  if (clash) shopName = `${shopName} (${shopId.slice(-4)})`;

  const created = await prisma.channel.create({
    data: {
      userId: ownerId,
      channelName: ChannelName.SHOPEE,
      shopName,
      externalShopId: shopId,
      feeRate: PLATFORM_FEE_RATE[ChannelName.SHOPEE],
      ...tokenData,
    },
  });
  return toResult(created);
}

function toResult(c: Channel): ShopeeConnectResult {
  return {
    id: c.id,
    channelName: c.channelName,
    shopName: c.shopName,
    externalShopId: c.externalShopId,
    status: c.status,
  };
}

// ============================================================
// ĐỒNG BỘ ĐƠN HÀNG SHOPEE — kéo đơn thật → upsert vào DB
//
// Cấu trúc mirror TikTok: phân trang, upsert idempotent theo (channelId, orderCode),
// snapshot giá vốn qua mapping SKU. CỐ Ý KHÔNG trừ tồn kho (đồng bộ lô chạy lặp) —
// việc trừ kho là của luồng webhook "đơn mới" riêng.
// ============================================================

const ORDER_LIST_PAGE_SIZE = 100;
const ORDER_DETAIL_BATCH = 50; // Shopee cho tối đa 50 order_sn/lần lấy chi tiết
const WINDOW_SEC = 15 * 24 * 60 * 60; // Shopee giới hạn ≤15 ngày mỗi lần get_order_list
const MAX_PAGES = 100; // chốt chặn phân trang vô tận

/** Ánh xạ trạng thái đơn Shopee → vòng đời của Hubsell. */
function mapShopeeStatus(status?: string): ShippingStatus {
  switch (status) {
    case "UNPAID":
    case "READY_TO_SHIP":
    case "INVOICE_PENDING":
      return ShippingStatus.PENDING;
    case "PROCESSED":
      return ShippingStatus.PROCESSED;
    case "SHIPPED":
    case "TO_CONFIRM_RECEIVE":
      return ShippingStatus.SHIPPING;
    case "COMPLETED":
    case "TO_RETURN":
      return ShippingStatus.DELIVERED;
    case "IN_CANCEL":
    case "CANCELLED":
      return ShippingStatus.CANCELLED;
    default:
      return ShippingStatus.PENDING;
  }
}

/** Gộp item_list theo SKU người bán, cộng dồn số lượng. */
function aggregateShopeeItems(order: ShopeeOrderDetail) {
  const agg = new Map<
    string,
    { channelSku: string; productName: string; price: number; quantity: number }
  >();
  for (const it of order.item_list ?? []) {
    // Cùng hàm sinh khoá với đồng bộ sản phẩm → đơn luôn khớp đúng ChannelProduct,
    // kể cả khi người bán để trống SKU (tách theo model) hay đặt chung SKU (gộp).
    const sku = shopeeChannelSku({
      itemId: it.item_id,
      modelId: it.model_id,
      itemSku: it.item_sku,
      modelSku: it.model_sku,
    });
    const qty = it.model_quantity_purchased ?? 1;
    const price = Number(it.model_discounted_price ?? it.model_original_price ?? 0) || 0;
    const name = [it.item_name, it.model_name].filter(Boolean).join(" - ") || sku;
    const ex = agg.get(sku);
    if (ex) ex.quantity += qty;
    else agg.set(sku, { channelSku: sku, productName: name, price, quantity: qty });
  }
  return [...agg.values()];
}

export interface SyncShopeeOrdersOptions {
  /** Lấy đơn tạo trong bao nhiêu ngày gần nhất. Mặc định 90 (chia cửa sổ 15 ngày). */
  daysBack?: number;
  maxPages?: number;
}

export interface SyncShopeeOrdersResult {
  fetched: number;
  created: number;
  updated: number;
  itemsCreated: number;
  pages: number;
}

/**
 * Kéo đơn hàng thật từ Shopee và upsert vào DB (idempotent theo (channelId,
 * order_sn)). Shopee giới hạn get_order_list ≤15 ngày/lần nên phải chia cửa sổ.
 */
export async function syncShopeeOrders(
  channel: Channel,
  opts: SyncShopeeOrdersOptions = {}
): Promise<SyncShopeeOrdersResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

  const nowSec = Math.floor(Date.now() / 1000);
  const daysBack = opts.daysBack ?? 90;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const startFrom = nowSec - daysBack * 24 * 60 * 60;

  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.SHOPEE];

  const result: SyncShopeeOrdersResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    itemsCreated: 0,
    pages: 0,
  };

  // Chia [startFrom, now] thành các cửa sổ ≤15 ngày.
  for (let winFrom = startFrom; winFrom < nowSec && result.pages < maxPages; winFrom += WINDOW_SEC) {
    const winTo = Math.min(winFrom + WINDOW_SEC, nowSec);
    let cursor: string | undefined;

    do {
      const list = await getOrderList({
        accessToken,
        shopId,
        timeFrom: winFrom,
        timeTo: winTo,
        pageSize: ORDER_LIST_PAGE_SIZE,
        cursor,
      });
      result.pages++;

      const sns = (list.response?.order_list ?? []).map((o) => o.order_sn);
      // Lấy chi tiết theo lô ≤50 rồi upsert từng đơn.
      for (let i = 0; i < sns.length; i += ORDER_DETAIL_BATCH) {
        const batch = sns.slice(i, i + ORDER_DETAIL_BATCH);
        const details = await getOrderDetail(accessToken, shopId, batch);
        for (const d of details) {
          result.fetched++;
          const outcome = await prisma.$transaction((tx) =>
            upsertShopeeOrderTx(tx, channel, d, feeRate)
          );
          if (outcome.created) {
            result.created++;
            result.itemsCreated += outcome.itemsCreated;
          } else {
            result.updated++;
          }
        }
      }

      cursor = list.response?.more ? list.response?.next_cursor || undefined : undefined;
    } while (cursor && result.pages < maxPages);
  }

  return result;
}

/**
 * Tạo mới / cập nhật MỘT đơn Shopee trong transaction. Tạo mới kèm OrderItem +
 * snapshot giá vốn; đã tồn tại thì chỉ cập nhật trường biến động (trạng thái,
 * tổng tiền) — không đụng OrderItem để giữ nguyên snapshot.
 */
async function upsertShopeeOrderTx(
  tx: Prisma.TransactionClient,
  channel: Channel,
  order: ShopeeOrderDetail,
  feeRate: number
): Promise<{ created: boolean; itemsCreated: number }> {
  const orderCode = order.order_sn;
  const totalAmount = Number(order.total_amount ?? 0) || 0;
  const shippingStatus = mapShopeeStatus(order.order_status);
  const paymentStatus = order.order_status === "UNPAID" ? "UNPAID" : "PAID";
  const customerName =
    order.recipient_address?.name?.trim() || order.buyer_username?.trim() || "Khách Shopee";
  const customerPhone = order.recipient_address?.phone?.trim() || null;

  const existing = await tx.order.findUnique({
    where: { channelId_orderCode: { channelId: channel.id, orderCode } },
    select: { id: true },
  });

  if (existing) {
    await tx.order.update({
      where: { id: existing.id },
      data: { shippingStatus, paymentStatus, totalAmount },
    });
    return { created: false, itemsCreated: 0 };
  }

  const lines = aggregateShopeeItems(order);
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
      itemCount: lines.length,
      createdAt: order.create_time ? new Date(order.create_time * 1000) : undefined,
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
