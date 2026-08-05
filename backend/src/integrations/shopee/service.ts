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
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { CHANNEL_LABEL, PLATFORM_FEE_RATE } from "../../mockMarketplace";
import {
  deductStockTx,
  holdStockTx,
  releaseStockHoldTx,
  restoreStockTx,
  type StockOutcome,
} from "../order-stock";
import type { StockSyncRequest } from "./inventory-sync";
import { SHOPEE_PUSH_CODE, type ShopeePushPayload } from "./webhook";
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

// FE của CHÍNH môi trường này. Nhét vào state lúc sinh URL uỷ quyền để callback
// (chạy trên Render khi redirect đăng ký là domain Render) biết luồng khởi phát
// từ đâu — cùng cơ chế "trạm trung chuyển" với Lazada.
const STATE_FRONTEND_URL = process.env.APP_FRONTEND_URL ?? "http://localhost:3000";

// ---------- State chống CSRF + mang ownerId ----------
//
// Callback Shopee là endpoint CÔNG KHAI (không JWT) nên không tự biết đang kết nối
// cho chủ shop nào. Ta ký ownerId vào `state` (JWT ngắn hạn) lúc sinh URL uỷ quyền,
// Shopee trả lại nguyên vẹn ở callback để khôi phục ownerId — vừa định danh vừa
// chống giả mạo.

export function signOauthState(ownerId: string): string {
  return jwt.sign(
    { ownerId, purpose: "shopee_oauth", fe: STATE_FRONTEND_URL },
    STATE_SECRET,
    { expiresIn: "10m" }
  );
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

/**
 * Đọc origin FE từ state mà KHÔNG kiểm chữ ký — dùng khi state do MÔI TRƯỜNG
 * KHÁC ký (dev local ký bằng secret khác nên Render không verify được). Vì
 * không tin được nội dung, chỉ chấp nhận origin localhost để bật code về máy
 * dev; mọi giá trị khác trả null (chặn open-redirect).
 */
export function decodeOauthStateOrigin(token: string): string | null {
  try {
    const payload = jwt.decode(token) as jwt.JwtPayload | null;
    if (!payload || payload.purpose !== "shopee_oauth") return null;
    const fe = typeof payload.fe === "string" ? payload.fe : "";
    return /^https?:\/\/localhost(:\d+)?$/.test(fe) ? fe : null;
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
 * MUTEX REFRESH THEO TỪNG SHOP. refresh_token của Shopee bị ROTATE mỗi lần
 * refresh (dùng một lần) — hai luồng (webhook + cron sync) cùng refresh một shop
 * thì luồng đến sau cầm refresh_token đã chết → invalid_refresh_token, chủ shop
 * phải uỷ quyền lại. Map giữ promise refresh đang chạy của từng channel: luồng
 * đến sau chờ chung kết quả thay vì bắn thêm request. Khóa trong-process là đủ
 * vì backend chạy MỘT instance Render; nếu sau này scale ngang phải chuyển sang
 * khóa DB (SELECT ... FOR UPDATE) hoặc Redis.
 */
const refreshInFlight = new Map<string, Promise<ShopeeAccessContext>>();

/**
 * Trả access_token còn hạn cho một gian Shopee, TỰ refresh nếu sắp/đã hết hạn rồi
 * lưu token mới xuống DB. Gọi NGAY TRƯỚC mọi lượt gọi API nghiệp vụ Shopee.
 * An toàn khi gọi đồng thời cho cùng một shop (xem refreshInFlight).
 *
 * `minTtlMs` — ngưỡng "còn sống đủ lâu": mặc định 5 phút cho luồng gọi API;
 * cron token-refresh truyền ngưỡng dài hơn để chủ động làm mới sớm.
 */
export async function getValidShopeeAccessToken(
  channel: Channel,
  minTtlMs: number = REFRESH_BUFFER_MS
): Promise<ShopeeAccessContext> {
  if (channel.channelName !== ChannelName.SHOPEE) {
    throw new Error("Gian hàng này không phải Shopee");
  }
  if (!channel.apiToken || !channel.refreshToken || !channel.externalShopId) {
    throw new Error("Gian hàng chưa uỷ quyền Shopee (thiếu token/shop_id)");
  }

  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;
  if (accessExp - Date.now() > minTtlMs) {
    return { accessToken: channel.apiToken, shopId: channel.externalShopId };
  }

  const inFlight = refreshInFlight.get(channel.id);
  if (inFlight) return inFlight;

  const job = refreshShopeeTokenLocked(channel.id, minTtlMs).finally(() => {
    refreshInFlight.delete(channel.id);
  });
  refreshInFlight.set(channel.id, job);
  return job;
}

/**
 * Thân refresh chạy TRONG khóa. Đọc lại channel từ DB trước khi gọi Shopee
 * (double-check): luồng khác có thể vừa refresh xong trong lúc mình chờ khóa —
 * token trong DB đã mới thì dùng luôn, không đốt thêm một lượt rotate.
 */
async function refreshShopeeTokenLocked(
  channelId: string,
  minTtlMs: number
): Promise<ShopeeAccessContext> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel?.apiToken || !channel.refreshToken || !channel.externalShopId) {
    throw new Error("Gian hàng chưa uỷ quyền Shopee (thiếu token/shop_id)");
  }

  const now = Date.now();
  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;
  if (accessExp - now > minTtlMs) {
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
      // Number(): expire_in là GIÂY, phòng API trả chuỗi — cộng thẳng chuỗi vào
      // timestamp sẽ ra Invalid Date và Prisma từ chối ghi cột DateTime.
      accessTokenExpireAt: new Date(now + Number(t.expire_in ?? 0) * 1000),
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
 * UPSERT Channel cho chủ shop `ownerId` theo khóa unique (userId, channelName,
 * externalShopId) — atomic ở tầng DB: bấm "Liên kết" lại bao nhiêu lần (kể cả
 * hai callback về cùng lúc) cũng chỉ có đúng MỘT bản ghi cho mỗi shop.
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
    // Number(): expire_in là GIÂY, phòng API trả chuỗi (xem ghi chú ở refresh).
    accessTokenExpireAt: new Date(now + Number(token.expire_in ?? 0) * 1000),
    refreshTokenExpireAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    externalShopName,
    status: "ACTIVE",
  };

  // Tên gian mặc định = tên phía Shopee, tránh trùng tên gian đã có trong cùng
  // sàn (unique [userId, channelName, shopName]). Chỉ dùng khi TẠO MỚI — kết nối
  // lại giữ nguyên shopName chủ shop đã tự đặt.
  let shopName = externalShopName || `${CHANNEL_LABEL[ChannelName.SHOPEE]} ${shopId}`;
  const clash = await prisma.channel.findFirst({
    where: {
      userId: ownerId,
      channelName: ChannelName.SHOPEE,
      shopName,
      NOT: { externalShopId: shopId },
    },
    select: { id: true },
  });
  if (clash) shopName = `${shopName} (${shopId.slice(-4)})`;

  const saved = await prisma.channel.upsert({
    where: {
      userId_channelName_externalShopId: {
        userId: ownerId,
        channelName: ChannelName.SHOPEE,
        externalShopId: shopId,
      },
    },
    update: tokenData,
    create: {
      userId: ownerId,
      channelName: ChannelName.SHOPEE,
      shopName,
      externalShopId: shopId,
      feeRate: PLATFORM_FEE_RATE[ChannelName.SHOPEE],
      ...tokenData,
    },
  });
  return toResult(saved);
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

/**
 * Đơn Shopee đang HOÀN/TRẢ → cờ trên trục returnStatus (độc lập shippingStatus).
 * TO_RETURN = người mua yêu cầu trả hàng/hoàn tiền. Nhờ cờ này, báo cáo Tổng quan
 * tách đơn hoàn ra khỏi "Thành công" và khỏi doanh thu. CHỈ nhận diện, KHÔNG tự
 * cộng kho — việc cộng kho khi hàng về là của luồng nhận hàng hoàn ở kho.
 */
function shopeeReturnStatus(status?: string): ReturnStatus | null {
  return status === "TO_RETURN" ? ReturnStatus.AWAITING : null;
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
export async function upsertShopeeOrderTx(
  tx: Prisma.TransactionClient,
  channel: Channel,
  order: ShopeeOrderDetail,
  feeRate: number
): Promise<{ created: boolean; itemsCreated: number }> {
  const orderCode = order.order_sn;
  const totalAmount = Number(order.total_amount ?? 0) || 0;
  const shippingStatus = mapShopeeStatus(order.order_status);
  const returning = shopeeReturnStatus(order.order_status);
  const paymentStatus = order.order_status === "UNPAID" ? "UNPAID" : "PAID";
  const customerName =
    order.recipient_address?.name?.trim() || order.buyer_username?.trim() || "Khách Shopee";
  const customerPhone = order.recipient_address?.phone?.trim() || null;

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
        // Chỉ TIẾN cờ hoàn NONE → AWAITING; KHÔNG đụng nếu kho đã xử lý xong
        // (RECEIVED_INTACT / CLAIM_SETTLED…) để không regress tiến độ hoàn.
        ...(returning && existing.returnStatus === ReturnStatus.NONE
          ? { returnStatus: returning }
          : {}),
      },
    });
    return { created: false, itemsCreated: 0 };
  }

  const lines = aggregateShopeeItems(order);
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
        // Đã nối kho → giá vốn sản phẩm gốc; chưa nối → giá vốn cấp SKU sàn.
        costPriceAtSale: String(mp?.product?.costPrice ?? mp?.costPrice ?? 0),
      },
    });
  }

  return { created: true, itemsCreated: lines.length };
}

// ============================================================
// WEBHOOK THỜI GIAN THỰC — đơn mới / đổi trạng thái → upsert + trừ/hoàn kho
//
// Khác luồng đồng bộ lô (chỉ upsert), webhook xử lý TỒN KHO real-time: đơn đã
// chốt thì trừ kho, đơn hủy thì hoàn kho — mirror TikTok, dùng chung order-stock.
// Payload push của Shopee chỉ có order_sn + status nên phải gọi get_order_detail
// lấy đủ dòng hàng rồi mới upsert, tất cả trong MỘT transaction.
// ============================================================

/** Tìm gian Shopee ĐANG HOẠT ĐỘNG theo shop_id trong payload (đã qua verify chữ ký). */
export async function findShopeeChannelByShopId(
  shopId: string
): Promise<Channel | null> {
  return prisma.channel.findFirst({
    where: {
      channelName: ChannelName.SHOPEE,
      externalShopId: shopId,
      status: "ACTIVE",
      refreshToken: { not: null },
    },
  });
}

/**
 * Các trạng thái Shopee mà đơn đã ĐƯỢC CHỐT và cần trừ kho (khách đã thanh
 * toán/COD xác nhận, shop phải giao). Loại UNPAID/INVOICE_PENDING (chưa chắc),
 * IN_CANCEL (chờ duyệt hủy — chưa hoàn vội) và CANCELLED (hoàn kho, xử lý riêng).
 */
function shouldDeductShopeeStock(status?: string): boolean {
  switch (status) {
    case "READY_TO_SHIP":
    case "PROCESSED":
    case "SHIPPED":
    case "TO_CONFIRM_RECEIVE":
    case "COMPLETED":
      return true;
    default:
      return false;
  }
}

/**
 * Đơn ở trạng thái CHƯA CHỐT (khách chưa thanh toán xong) — không trừ thật
 * nhưng phải GIỮ (hold) tồn khả dụng ngay để hai khách cùng lúc không mua
 * trùng một món hàng cuối cùng.
 */
function shouldHoldShopeeStock(status?: string): boolean {
  return status === "UNPAID" || status === "INVOICE_PENDING";
}

export interface ShopeeOrderEventResult {
  found: boolean; // Shopee có trả chi tiết đơn không
  created: boolean; // upsert tạo mới hay cập nhật
  orderStatus?: string;
  inventory: StockOutcome;
  deducted?: number;
  restored?: number;
  held?: number;
  /**
   * Kho có biến động → yêu cầu đẩy tồn khả dụng mới lên sàn. Worker webhook
   * thực hiện SAU khi transaction này đã commit (đẩy sàn có retry riêng,
   * không được nằm trong transaction kẻo giữ khoá DB suốt các lần chờ retry).
   */
  stockSync?: StockSyncRequest;
}

/**
 * XỬ LÝ MỘT SỰ KIỆN ĐƠN HÀNG (code 3 logistics / code 4 order status). Kéo chi
 * tiết đơn mới nhất từ API rồi upsert + tác động tồn kho. Idempotent toàn phần:
 * upsert theo (channelId, order_sn); trừ/hoàn kho chặn bằng stockDeductedAt/
 * stockRestoredAt — Shopee retry bao nhiêu lần cũng không ghi trùng.
 */
export async function processShopeeOrderEvent(
  channel: Channel,
  orderSn: string
): Promise<ShopeeOrderEventResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  let order: ShopeeOrderDetail | undefined;
  try {
    const details = await getOrderDetail(accessToken, shopId, [orderSn]);
    order = details[0];
  } catch (err) {
    // "Đơn không tồn tại" là lỗi VĨNH VIỄN (sn sai/đơn bị xoá) — trả found:false
    // để hàng đợi KHÔNG retry vô ích; lỗi khác (mạng, token) ném tiếp cho retry.
    if ((err as Error).message.includes("error_not_found")) {
      return { found: false, created: false, inventory: "none" };
    }
    throw err;
  }
  if (!order) {
    return { found: false, created: false, inventory: "none" };
  }

  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.SHOPEE];

  return prisma.$transaction(async (tx) => {
    const up = await upsertShopeeOrderTx(tx, channel, order, feeRate);
    const orderRow = await tx.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderSn } },
      select: { id: true },
    });
    if (!orderRow) {
      return { found: true, created: up.created, orderStatus: order.order_status, inventory: "none" as StockOutcome };
    }

    // Snapshot tồn KHẢ DỤNG trước biến động — cột "số cũ" của log đối soát.
    const itemRows = await tx.orderItem.findMany({
      where: { orderId: orderRow.id, productId: { not: null } },
      select: { productId: true },
    });
    const itemProductIds = [...new Set(itemRows.map((i) => i.productId!))];
    const before = itemProductIds.length
      ? await tx.product.findMany({
          where: { id: { in: itemProductIds } },
          select: { id: true, quantityInStock: true, holdQuantity: true },
        })
      : [];
    const oldAvailable = Object.fromEntries(
      before.map((p) => [p.id, p.quantityInStock - p.holdQuantity])
    );
    const syncFor = (productIds: string[]): StockSyncRequest | undefined =>
      productIds.length > 0 ? { orderSn, productIds, oldAvailable } : undefined;

    const base = { found: true, created: up.created, orderStatus: order.order_status };

    if (order.order_status === "CANCELLED") {
      // Đơn hủy: nhả hold (nếu đơn chưa từng chốt) + hoàn kho (nếu đã trừ thật).
      const rel = await releaseStockHoldTx(tx, orderRow.id);
      const r = await restoreStockTx(tx, orderRow.id, "webhook Shopee");
      const productIds = [...new Set([...rel.productIds, ...r.productIds])];
      return {
        ...base,
        inventory: r.outcome === "none" && rel.released > 0 ? ("restored" as StockOutcome) : r.outcome,
        restored: r.restored,
        stockSync: syncFor(productIds),
      };
    }

    if (shouldDeductShopeeStock(order.order_status)) {
      const d = await deductStockTx(tx, orderRow.id, "webhook Shopee");
      return { ...base, inventory: d.outcome, deducted: d.deducted, stockSync: syncFor(d.productIds) };
    }

    if (shouldHoldShopeeStock(order.order_status)) {
      const h = await holdStockTx(tx, orderRow.id);
      return { ...base, inventory: h.outcome, held: h.held, stockSync: syncFor(h.productIds) };
    }

    return { ...base, inventory: "none" as StockOutcome };
  });
}

/**
 * XỬ LÝ SỰ KIỆN UỶ QUYỀN (code 5): shop gia hạn/thu hồi quyền app. Payload không
 * nói rõ chiều thay đổi nên KIỂM CHỨNG bằng chính API: gọi get_shop_info — token
 * còn dùng được → giữ/khôi phục ACTIVE; bị sàn từ chối → đánh dấu DISCONNECTED
 * để UI nhắc kết nối lại. Không xoá token (thu hồi nhầm còn tự phục hồi được).
 */
export async function processShopeeAuthorizationEvent(
  shopId: string
): Promise<{ status: string } | null> {
  const channel = await prisma.channel.findFirst({
    where: {
      channelName: ChannelName.SHOPEE,
      externalShopId: shopId,
      refreshToken: { not: null },
    },
  });
  if (!channel) return null;

  let ok = false;
  try {
    const { accessToken } = await getValidShopeeAccessToken(channel);
    const info = await getShopInfo(accessToken, shopId);
    ok = Boolean(info.shop_name || info.region || info.status);
  } catch {
    ok = false;
  }

  const status = ok ? "ACTIVE" : "DISCONNECTED";
  if (channel.status !== status) {
    await prisma.channel.update({ where: { id: channel.id }, data: { status } });
  }
  return { status };
}

/**
 * Bộ chia sự kiện cho HÀNG ĐỢI BỀN webhook (worker gọi từng job FIFO).
 * Ném lỗi = báo hàng đợi retry (lỗi tạm thời); các trường hợp "không có gì để
 * làm" (shop chưa nối, thiếu order_sn...) thì nuốt êm — retry cũng vô ích.
 *
 * Trả về yêu cầu đồng bộ tồn (nếu kho có biến động) để worker đẩy tồn mới lên
 * sàn SAU khi transaction đơn hàng đã commit — tách bạch: lỗi đẩy sàn có retry
 * + cảnh báo riêng, không làm job đơn hàng chạy lại.
 */
export async function dispatchShopeeWebhookEvent(
  payload: ShopeePushPayload
): Promise<StockSyncRequest | null> {
  const code = Number(payload.code);
  const shopId = payload.shop_id != null ? String(payload.shop_id) : "";
  if (!shopId) return null;

  if (
    code === SHOPEE_PUSH_CODE.AUTHORIZATION ||
    code === SHOPEE_PUSH_CODE.DEAUTHORIZATION
  ) {
    const r = await processShopeeAuthorizationEvent(shopId);
    console.log(`[Webhook Shopee] Uỷ quyền shop ${shopId} →`, r?.status ?? "shop chưa nối");
    return null;
  }

  if (code === SHOPEE_PUSH_CODE.ORDER_STATUS || code === SHOPEE_PUSH_CODE.TRACKING_NO) {
    const orderSn = String(payload.data?.ordersn ?? payload.data?.order_sn ?? "");
    if (!orderSn) return null;
    const channel = await findShopeeChannelByShopId(shopId);
    if (!channel) return null;
    const result = await processShopeeOrderEvent(channel, orderSn);
    console.log(
      `[Webhook Shopee] code=${code} đơn ${orderSn} (shop ${shopId}) →`,
      JSON.stringify({ ...result, stockSync: result.stockSync ? result.stockSync.productIds.length : undefined })
    );
    return result.stockSync ?? null;
  }

  return null;
}
