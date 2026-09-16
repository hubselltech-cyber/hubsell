// ============================================================
// TIKTOK SHOP — TẦNG NGHIỆP VỤ (có truy cập DB)
//
// client.ts là các hàm API THUẦN (không biết DB). File này ghép chúng với Prisma:
//   1) getValidAccessToken() — tự refresh access_token khi sắp hết hạn.
//   2) syncTiktokOrders()    — kéo đơn thật → upsert Order + OrderItem.
//   3) syncTiktokSettlements()— kéo đối soát thật → cập nhật số quyết toán/đơn.
// ============================================================

import type { Channel, Prisma } from "@prisma/client";
import { ChannelName, ShippingDisputeStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { carrierFromName } from "../../services/shipping";
import { backfillOrderItemImagesTx } from "../order-item-images";
import { PLATFORM_FEE_RATE } from "../../marketplace/mockMarketplace";
import { deductStockTx, restoreStockTx, type StockOutcome } from "../order-stock";
import { expireToDate } from "./config";
import {
  fetchOrders,
  fetchSettlements,
  fetchStatementTransactionsV2,
  fetchUnsettledTransactions,
  getAuthorizedShops,
  getOrderDetail,
  refreshAccessToken,
  type TikTokOrder,
  type TikTokTxBreakdown,
} from "./client";
import {
  describeTiktokFeeTax,
  groupTiktokLinesByOrder,
  mapTiktokBreakdownToSettlement,
  parseEstimatedSettlement,
} from "./settlements";

// Làm mới token khi còn dưới 5 phút là hết hạn — chừa biên an toàn cho các call
// nối tiếp trong cùng một lượt đồng bộ, tránh token hết hạn giữa chừng.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Chặn phân trang chạy vô tận (đề phòng next_page_token luôn có do lỗi phía sàn).
const MAX_PAGES = 50;
const PAGE_SIZE = 50;

export interface AccessContext {
  accessToken: string;
  shopCipher: string;
}

/**
 * Trả về access_token còn hạn cho một gian TikTok, TỰ ĐỘNG refresh nếu sắp/đã
 * hết hạn rồi lưu token mới xuống DB. Gọi hàm này NGAY TRƯỚC mọi lượt gọi API.
 *
 * Ném lỗi rõ ràng khi gian chưa uỷ quyền hoặc refresh_token đã hết hạn (buộc
 * chủ shop uỷ quyền lại) — để lỗi không lặng lẽ biến thành chữ ký/401 khó truy.
 */
export async function getValidAccessToken(
  channel: Channel,
  bufferMs: number = REFRESH_BUFFER_MS
): Promise<AccessContext> {
  if (channel.channelName !== ChannelName.TIKTOK) {
    throw new Error("Gian hàng này không phải TikTok Shop");
  }
  if (!channel.apiToken || !channel.refreshToken || !channel.shopCipher) {
    throw new Error("Gian hàng chưa uỷ quyền TikTok (thiếu token/shop_cipher)");
  }

  const now = Date.now();
  const accessExp = channel.accessTokenExpireAt?.getTime() ?? 0;

  // Còn hạn dư dả → dùng luôn token hiện có (cron truyền ngưỡng lớn hơn để
  // refresh chủ động).
  if (accessExp - now > bufferMs) {
    return { accessToken: channel.apiToken, shopCipher: channel.shopCipher };
  }

  // Sắp/đã hết hạn → phải refresh. Nếu refresh_token cũng hết hạn thì bó tay.
  const refreshExp = channel.refreshTokenExpireAt?.getTime() ?? 0;
  if (refreshExp && refreshExp < now) {
    throw new Error(
      "Phiên uỷ quyền TikTok đã hết hạn (refresh_token). Vui lòng kết nối lại gian hàng."
    );
  }

  const t = await refreshAccessToken(channel.refreshToken);
  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      apiToken: t.access_token,
      refreshToken: t.refresh_token,
      accessTokenExpireAt: expireToDate(t.access_token_expire_in),
      refreshTokenExpireAt: expireToDate(t.refresh_token_expire_in),
    },
  });

  return { accessToken: t.access_token, shopCipher: channel.shopCipher };
}

// ---------- Ánh xạ trạng thái đơn TikTok → vòng đời của Hubsell ----------

/**
 * Trạng thái đơn: payload orders/search & orders detail đặt ở `status` (đối
 * chiếu thật 16/09/2026); bản nháp cũ đọc `order_status` nên 261 đơn đầu tiên
 * về đều thành PENDING — giữ fallback để webhook/docs cũ không vỡ.
 */
export function tiktokOrderStatus(order: Pick<TikTokOrder, "status" | "order_status">): string | undefined {
  return order.status ?? order.order_status;
}

function mapShippingStatus(tiktokStatus?: string): ShippingStatus {
  switch (tiktokStatus) {
    case "UNPAID":
    case "ON_HOLD":
    case "AWAITING_SHIPMENT":
      return ShippingStatus.PENDING;
    case "PARTIALLY_SHIPPING":
    case "AWAITING_COLLECTION":
      return ShippingStatus.PROCESSED;
    case "IN_TRANSIT":
      return ShippingStatus.SHIPPING;
    case "DELIVERED":
    case "COMPLETED":
      return ShippingStatus.DELIVERED;
    case "CANCELLED":
      return ShippingStatus.CANCELLED;
    default:
      // Trạng thái lạ → PENDING (an toàn: kho không bỏ sót đơn) nhưng ghi log MỘT
      // lần mỗi giá trị để bổ sung bảng ánh xạ (16/09: 3 đơn 18/06 kẹt "chờ xử
      // lý" dù Seller Center không có — nghi trạng thái ngoài docs).
      if (tiktokStatus && !unknownStatusLogged.has(tiktokStatus)) {
        unknownStatusLogged.add(tiktokStatus);
        console.warn(`[TikTok] Trạng thái đơn LẠ chưa ánh xạ: ${JSON.stringify(tiktokStatus)} → tạm PENDING`);
      }
      return ShippingStatus.PENDING;
  }
}
const unknownStatusLogged = new Set<string>();

/** Gộp line_items theo SKU người bán, cộng dồn số lượng (202309 tách theo đơn vị). */
function aggregateLineItems(order: TikTokOrder) {
  const agg = new Map<
    string,
    { channelSku: string; productName: string; price: number; quantity: number; imageUrl: string | null }
  >();
  for (const li of order.line_items ?? []) {
    const sku = li.seller_sku || li.sku_id || li.id;
    const qty = li.quantity ?? 1;
    const imageUrl = li.sku_image?.trim() || null;
    // "Tên sản phẩm - Tên phân loại" như Shopee (item_name - model_name).
    const name =
      [li.product_name?.trim(), li.sku_name?.trim()].filter(Boolean).join(" - ") || sku;
    const existing = agg.get(sku);
    if (existing) {
      existing.quantity += qty;
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
    } else {
      agg.set(sku, {
        channelSku: sku,
        productName: name,
        price: Number(li.sale_price ?? 0) || 0,
        quantity: qty,
        imageUrl,
      });
    }
  }
  return [...agg.values()];
}

export interface SyncOrdersOptions {
  /** Chỉ lấy đơn tạo từ mốc này (Unix seconds). Mặc định 90 ngày gần nhất. */
  createTimeGe?: number;
  createTimeLt?: number;
  /** Cửa sổ N ngày gần nhất (thay cho createTimeGe) — worker quét tự động. */
  daysBack?: number;
  /** true = lọc theo update_time (bắt đơn cũ vừa đổi trạng thái) thay vì create_time. */
  byUpdateTime?: boolean;
  maxPages?: number;
}

/**
 * Ghi log HÌNH DẠNG payload thật (tên trường, không giá trị khách) — một lần
 * mỗi lượt đồng bộ, để đối chiếu parser với dữ liệu thật khi nối shop
 * (kế hoạch 16/09/2026). Tắt bằng TIKTOK_SHAPE_LOG=0 khi đã chốt.
 */
function logShape(label: string, sample: unknown): void {
  if (process.env.TIKTOK_SHAPE_LOG === "0" || !sample || typeof sample !== "object") return;
  const o = sample as Record<string, unknown>;
  const keys = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object).join(",") : String(v);
  const first = (v: unknown) => (Array.isArray(v) && v.length ? v[0] : undefined);
  const parts = [`keys=[${Object.keys(o).join(",")}]`];
  // Mọi trường con là object / mảng object → in tên trường cấp 2 (bóc tách
  // phí bản kê, payment, line_items… mà không cần biết trước tên).
  for (const [k, v] of Object.entries(o)) {
    const inner = Array.isArray(v) ? first(v) : v;
    if (inner && typeof inner === "object") parts.push(`${k}=[${keys(inner)}]`);
  }
  const show = [
    "order_status", "status", "delivery_option_name", "shipping_provider",
    "shipping_type", "payment_status", "type",
  ];
  for (const k of show) {
    if (k in o) parts.push(`${k}=${JSON.stringify(o[k])}`);
  }
  console.log(`[TikTok] Hình dạng ${label}: ${parts.join(" ")}`);
}

export interface SyncOrdersResult {
  fetched: number; // số đơn TikTok trả về
  created: number; // số Order tạo mới
  updated: number; // số Order cập nhật trạng thái
  itemsCreated: number; // số OrderItem tạo mới
  pages: number;
}

/**
 * Kéo đơn hàng thật từ TikTok Shop và upsert vào DB (idempotent theo
 * (channelId, orderCode)). CỐ Ý KHÔNG trừ tồn kho ở đây: đồng bộ lịch sử chạy
 * lặp nhiều lần, trừ kho theo lô sẽ làm tồn kho sai và không idempotent — việc
 * trừ kho thuộc luồng webhook "đơn mới" riêng.
 */
export async function syncTiktokOrders(
  channel: Channel,
  opts: SyncOrdersOptions = {}
): Promise<SyncOrdersResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);

  const nowSec = Math.floor(Date.now() / 1000);
  // Mặc định 120 ngày (không phải 90): đơn tạo sát mép 90 ngày được lượt đầu
  // kéo về rồi rơi khỏi cửa sổ ở lượt sau, trạng thái cũ kẹt mãi (16/09: 4 đơn
  // 18/06 kẹt "chờ xử lý"). Thêm một tháng đệm để lượt bấm tay vét hết.
  const fromSec =
    opts.createTimeGe ?? nowSec - (opts.daysBack ?? 120) * 24 * 60 * 60;
  const toSec = opts.createTimeLt ?? nowSec;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  // Quét theo create_time (đồng bộ tay 90 ngày) CẮT LÁT 15 ngày, mỗi lát có trần
  // trang riêng — shop and.not.or 90 ngày = 2.719 đơn vượt trần 50 trang × 50
  // (16/09: lượt đầu dừng ở 2.500, ~200 đơn cũ nhất giữ trạng thái sai). Quét
  // update_time (worker 2 ngày) giữ một lát.
  const SLICE_SEC = 15 * 24 * 60 * 60;
  const slices: { from: number; to: number }[] = [];
  if (opts.byUpdateTime || toSec - fromSec <= SLICE_SEC) {
    slices.push({ from: fromSec, to: toSec });
  } else {
    for (let to = toSec; to > fromSec; to -= SLICE_SEC) {
      slices.push({ from: Math.max(fromSec, to - SLICE_SEC), to });
    }
  }
  let shapeLogged = false;
  let windowMinUpdate = 0;
  let windowMaxUpdate = 0;

  // % phí tạm tính (GĐ1) khi đơn chưa được đối soát — số thật thay sau ở settlement.
  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.TIKTOK];

  const result: SyncOrdersResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    itemsCreated: 0,
    pages: 0,
  };

  for (const slice of slices) {
  const timeFilter = opts.byUpdateTime
    ? { updateTimeGe: slice.from, updateTimeLt: slice.to }
    : { createTimeGe: slice.from, createTimeLt: slice.to };
  let slicePages = 0;
  let pageToken: string | undefined;
  do {
    const data = await fetchOrders({
      accessToken,
      shopCipher,
      ...timeFilter,
      pageSize: PAGE_SIZE,
      pageToken,
    });
    result.pages++;
    slicePages++;

    for (const o of data.orders ?? []) {
      result.fetched++;
      if (!shapeLogged) {
        shapeLogged = true;
        logShape("đơn (orders/search)", o);
      }
      if (o.update_time) {
        if (!windowMinUpdate || o.update_time < windowMinUpdate) windowMinUpdate = o.update_time;
        if (o.update_time > windowMaxUpdate) windowMaxUpdate = o.update_time;
      }
      // Đồng bộ lô CỐ Ý không trừ kho (chỉ upsert), nên mỗi đơn một transaction nhẹ.
      const outcome = await prisma.$transaction((tx) =>
        upsertOrderTx(tx, channel, o, feeRate)
      );
      if (outcome.created) {
        result.created++;
        result.itemsCreated += outcome.itemsCreated;
      } else {
        result.updated++;
      }
    }

    pageToken = data.next_page_token || undefined;
  } while (pageToken && slicePages < maxPages);
  }

  // KIỂM CỬA SỔ (16/09): lượt quét update_time 2 ngày trả về 261/262 đơn — nghi
  // sàn bỏ qua update_time_ge. Ghi min/max update_time của lô so với cửa sổ để
  // đối chiếu; ngoài cửa sổ → cần đổi sang lọc phía Hubsell. Tắt TIKTOK_SHAPE_LOG=0.
  if (opts.byUpdateTime && result.fetched > 0 && process.env.TIKTOK_SHAPE_LOG !== "0") {
    console.log(
      `[TikTok] Cửa sổ update_time ${new Date(fromSec * 1000).toISOString()} → ${new Date(toSec * 1000).toISOString()}: ${result.fetched} đơn, update_time thấp nhất ${windowMinUpdate ? new Date(windowMinUpdate * 1000).toISOString() : "?"}, cao nhất ${windowMaxUpdate ? new Date(windowMaxUpdate * 1000).toISOString() : "?"}`
    );
  }

  return result;
}

/**
 * Tạo mới hoặc cập nhật MỘT đơn TikTok TRONG một transaction cho trước. Tạo mới
 * thì kèm OrderItem + snapshot giá vốn; đã tồn tại thì chỉ cập nhật các trường
 * biến động (trạng thái, tổng tiền, vận đơn) — KHÔNG đụng OrderItem để giữ
 * nguyên snapshot giá vốn ban đầu.
 *
 * Nhận `tx` từ bên ngoài để webhook có thể GỘP upsert + trừ kho vào cùng một
 * transaction (đảm bảo nguyên tử); luồng đồng bộ lô thì tự bọc `$transaction`.
 */
async function upsertOrderTx(
  tx: Prisma.TransactionClient,
  channel: Channel,
  order: TikTokOrder,
  feeRate: number
): Promise<{ orderId: string; created: boolean; itemsCreated: number }> {
  const orderCode = order.id;
  const totalAmount = Number(order.payment?.total_amount ?? 0) || 0;
  const status = tiktokOrderStatus(order);
  const shippingStatus = mapShippingStatus(status);
  const paymentStatus = status === "UNPAID" ? "UNPAID" : "PAID";
  const customerName =
    order.recipient_address?.name?.trim() ||
    [order.recipient_address?.first_name, order.recipient_address?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    "Khách TikTok";
  const customerPhone = order.recipient_address?.phone_number?.trim() || null;
  const trackingCode = order.tracking_number?.trim() || null;
  // Kiện hàng đầu tiên — id cho API in vận đơn/bàn giao (fulfillment packages).
  const packageId = order.packages?.[0]?.id?.trim() || null;
  // Trợ giá SÀN lúc đặt đơn (payment.platform_discount — TikTok bù lại phần giảm
  // giá do sàn tài trợ khi giải ngân, cùng nghĩa platform_discount_amount của bản
  // kê) → P&L ước tính real-time; số thật ghi đè khi đối soát. Voucher SHOP
  // KHÔNG ghi: OrderItem.price = sale_price đã trừ giảm giá shop (tránh trừ đôi).
  const platformSubsidy = Number(order.payment?.platform_discount ?? 0) || 0;
  // Mốc giao thành công theo SÀN (delivery_time) — chính xác hơn "lúc đồng bộ".
  const deliveredAt =
    shippingStatus === ShippingStatus.DELIVERED
      ? order.delivery_time
        ? new Date(order.delivery_time * 1000)
        : new Date()
      : null;
  // Tên PHƯƠNG THỨC + hãng nguyên văn — nguồn bắt hỏa tốc: "Hỏa tốc"/"Giao Trong
  // Ngày" nằm ở delivery_option_name, hãng có thể là J&T giao thường. Ghi ghép
  // "phương thức · hãng" để cùng luật EXPRESS_KEYWORDS với Shopee/Lazada
  // (khảo sát 08/09/2026 — chuỗi VN thật chưa có trong docs, soi log khi nối shop thật).
  const carrierName =
    [order.delivery_option_name?.trim(), order.shipping_provider?.trim()]
      .filter(Boolean)
      .join(" · ") || null;
  const carrier = carrierFromName(order.shipping_provider);

  const existing = await tx.order.findUnique({
    where: { channelId_orderCode: { channelId: channel.id, orderCode } },
    select: { id: true, carrier: true, deliveredAt: true, isSettled: true },
  });
  // Đơn đã đối soát: số bản kê là sự thật, đồng bộ lô không ghi đè cột tài chính.
  const existingSettled = existing?.isSettled === true;

  if (existing) {
    await tx.order.update({
      where: { id: existing.id },
      data: {
        shippingStatus,
        paymentStatus,
        totalAmount,
        ...(existingSettled ? {} : { platformSubsidy }),
        ...(trackingCode ? { trackingCode } : {}),
        ...(packageId ? { platformPackageId: packageId } : {}),
        // Mốc GIAO THÀNH CÔNG ghi MỘT lần (Kiểm toán phí sàn rổ #3 đếm từ đây).
        ...(deliveredAt && !existing.deliveredAt ? { deliveredAt } : {}),
        // Chỉ điền hãng khi đang trống — không ghi đè lựa chọn tay của kho.
        ...(carrier && !existing.carrier ? { carrier } : {}),
        // Tên hãng NGUYÊN VĂN là dữ kiện sàn — luôn cập nhật (nguồn bắt hỏa tốc)
        ...(carrierName ? { shippingCarrierName: carrierName } : {}),
      },
    });
    await backfillOrderItemImagesTx(tx, existing.id, aggregateLineItems(order));
    return { orderId: existing.id, created: false, itemsCreated: 0 };
  }

  const lines = aggregateLineItems(order);

  // Nối SKU sàn → sản phẩm gốc (nếu đã liên kết) để snapshot giá vốn & gắn productId.
  // Lấy CẢ dòng chưa liên kết kho: giá vốn khi đó nằm ở cấp SKU sàn (costPrice
  // của ChannelProduct) — khách không nối kho gốc vẫn tính được lãi/lỗ.
  const skus = lines.map((l) => l.channelSku);
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
      trackingCode,
      platformSubsidy,
      ...(packageId ? { platformPackageId: packageId } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
      ...(carrier ? { carrier } : {}),
      ...(carrierName ? { shippingCarrierName: carrierName } : {}),
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
        imageUrl: line.imageUrl,
        // Đã nối kho → giá vốn sản phẩm gốc; chưa nối → giá vốn cấp SKU sàn.
        costPriceAtSale: String(mp?.product?.costPrice ?? mp?.costPrice ?? 0),
      },
    });
  }

  return { orderId: created.id, created: true, itemsCreated: lines.length };
}

export interface SyncSettlementsOptions {
  maxPages?: number;
  /** Chỉ quét bản kê N ngày gần nhất — worker giờ dùng cửa sổ hẹp. */
  daysBack?: number;
  /**
   * Không có daysBack = BACKFILL toàn bộ: quét từ mốc này (mặc định = ngày tạo
   * đơn TikTok cũ nhất của gian, tối thiểu 01/01/2025) tới nay, theo từng cửa
   * sổ 30 ngày statement_time_ge/lt. Get Statements KHÔNG truyền mốc chỉ trả
   * cửa sổ gần (đối chiếu prod 16/09: T6-T8 trắng dù quét "tất cả").
   */
  since?: Date;
}

export interface SyncSettlementsResult {
  statements: number; // số bản kê quét qua
  transactions: number; // số dòng giao dịch đọc được
  ordersUpdated: number; // số Order được cập nhật quyết toán
  ordersNotFound: number; // dòng có order_id nhưng đơn chưa đồng bộ về
  unlinked: number; // dòng cấp shop không gắn đơn (phạt, ship mẫu, nạp ví ads…)
  windows: number; // số cửa sổ thời gian đã quét
  pages: number;
}

const SETTLE_WINDOW_DAYS = 30;
const SETTLE_BACKFILL_FLOOR = Date.UTC(2025, 0, 1) / 1000; // API 202501/202507 chỉ có dữ liệu từ đây

/**
 * Kéo bản kê giải ngân THẬT (Finance API 202501, có breakdown đặt tên) và ghi
 * cho từng Order: sao kê chi tiết TiktokOrderSettlement (số có dấu) + cột gộp
 * GĐ2 (isSettled/actualPayout/phí…). Gom MỌI dòng của cùng đơn trong lượt chạy
 * rồi GHI ĐÈ — chạy lại vẫn ra đúng một kết quả.
 */
export async function syncTiktokSettlements(
  channel: Channel,
  opts: SyncSettlementsOptions = {}
): Promise<SyncSettlementsResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const nowSec = Math.floor(Date.now() / 1000);

  // Cửa sổ quét: nhịp giờ = [now − daysBack, now]; backfill = từng lát 30 ngày.
  const windows: { ge: number; lt: number }[] = [];
  if (opts.daysBack) {
    windows.push({ ge: nowSec - opts.daysBack * 86_400, lt: nowSec });
  } else {
    let start = opts.since ? Math.floor(opts.since.getTime() / 1000) : undefined;
    if (!start) {
      const oldest = await prisma.order.findFirst({
        where: { channelId: channel.id },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      start = oldest ? Math.floor(oldest.createdAt.getTime() / 1000) : nowSec - 90 * 86_400;
    }
    start = Math.max(start, SETTLE_BACKFILL_FLOOR);
    for (let ge = start; ge < nowSec; ge += SETTLE_WINDOW_DAYS * 86_400) {
      windows.push({ ge, lt: Math.min(ge + SETTLE_WINDOW_DAYS * 86_400, nowSec + 60) });
    }
  }

  let stShapeLogged = false;
  let txShapeLogged = false;
  const result: SyncSettlementsResult = {
    statements: 0,
    transactions: 0,
    ordersUpdated: 0,
    ordersNotFound: 0,
    unlinked: 0,
    windows: windows.length,
    pages: 0,
  };

  // Gom MỌI dòng theo đơn trong toàn bộ lượt chạy (ORDER + REFUND + điều chỉnh
  // gắn đơn cộng lại; đơn có dòng ở 2 bản kê khác ngày vẫn về một chỗ).
  const byOrder = new Map<string, { lines: TikTokTxBreakdown[]; time?: number; statementId?: string }>();

  for (const w of windows) {
    let stPageToken: string | undefined;
    let stPages = 0;
    do {
      const list = await fetchSettlements({
        accessToken,
        shopCipher,
        statementTimeGe: w.ge,
        statementTimeLt: w.lt,
        pageSize: PAGE_SIZE,
        pageToken: stPageToken,
      });
      result.pages++;
      stPages++;

      for (const st of list.statements ?? []) {
        result.statements++;
        if (!stShapeLogged) {
          stShapeLogged = true;
          logShape("bản kê (statements)", st);
        }

        let txPageToken: string | undefined;
        let txPages = 0;
        do {
          const txData = await fetchStatementTransactionsV2({
            accessToken,
            shopCipher,
            statementId: st.id,
            pageSize: 100,
            pageToken: txPageToken,
          });
          txPages++;
          const lines = txData.transactions ?? [];
          if (!txShapeLogged && lines[0]) {
            txShapeLogged = true;
            logShape("giao dịch bản kê 202501", lines[0]);
            // Tên trường phí/thuế THẬT khác 0 của dòng ORDER đầu tiên — đối
            // chiếu bảng mapping (tắt TIKTOK_SHAPE_LOG=0 khi xong).
            const orderLine = lines.find((l) => l.type === "ORDER") ?? lines[0];
            if (process.env.TIKTOK_SHAPE_LOG !== "0") {
              console.log(`[TikTok] Phí/thuế thật dòng ${orderLine.order_id ?? "?"}: ${describeTiktokFeeTax(orderLine)}`);
            }
          }
          const { byOrder: grouped, unlinked } = groupTiktokLinesByOrder(lines);
          result.unlinked += unlinked;
          for (const [orderId, ls] of grouped) {
            result.transactions += ls.length;
            const acc = byOrder.get(orderId) ?? { lines: [] };
            acc.lines.push(...ls);
            // Mốc QUYẾT TOÁN = thời điểm bản kê (statement_time), không phải ngày tạo đơn.
            acc.time = st.statement_time ?? st.payment_time ?? acc.time;
            acc.statementId = st.id;
            byOrder.set(orderId, acc);
          }
          txPageToken = txData.next_page_token || undefined;
        } while (txPageToken && txPages < maxPages);
      }

      stPageToken = list.next_page_token || undefined;
    } while (stPageToken && stPages < maxPages);
  }

  // Áp số quyết toán vào từng Order đã đồng bộ về trước đó.
  for (const [orderId, acc] of byOrder) {
    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderId } },
      select: { id: true, shippingDisputeStatus: true },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }
    const settledAt = acc.time ? new Date(acc.time * 1000) : new Date();
    await writeTiktokSettlement(order, acc.lines, {
      estimated: false,
      settledAt,
      statementId: acc.statementId,
    });
    result.ordersUpdated++;
  }

  if (result.ordersNotFound > 0 || result.unlinked > 0) {
    console.log(
      `[TikTok] Đối soát "${channel.shopName}": ${result.ordersUpdated} đơn ghi số thật, ${result.ordersNotFound} mã đơn trên bản kê chưa có trong Hubsell, ${result.unlinked} dòng cấp shop không gắn đơn (${result.statements} bản kê / ${result.windows} cửa sổ)`
    );
  }

  return result;
}

/**
 * Ghi bản kê của MỘT đơn: sao kê chi tiết (có dấu) + cột gộp Order. Dùng cho
 * cả bản kê đã quyết toán (estimated=false: đặt isSettled/settledAt) và số ước
 * tính unsettled (estimated=true: KHÔNG đụng isSettled, ghi expectedPayout làm
 * mẫu số Kiểm toán phí sàn như Shopee).
 */
async function writeTiktokSettlement(
  order: { id: string; shippingDisputeStatus: ShippingDisputeStatus },
  lines: TikTokTxBreakdown[],
  meta: {
    estimated: boolean;
    settledAt?: Date;
    statementId?: string;
    estimatedSettlementAt?: Date | null;
    unsettledReason?: string | null;
  }
): Promise<void> {
  const { detail, order: cols } = mapTiktokBreakdownToSettlement(lines);
  const detailData = {
    ...detail,
    estimated: meta.estimated,
    statementId: meta.statementId ?? null,
    estimatedSettlementAt: meta.estimatedSettlementAt ?? null,
    unsettledReason: meta.unsettledReason ?? null,
    settledAt: meta.estimated ? null : meta.settledAt ?? null,
  };
  await prisma.tiktokOrderSettlement.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, ...detailData },
    update: detailData,
  });
  await prisma.order.update({
    where: { id: order.id },
    data: {
      ...cols,
      ...(meta.estimated
        ? { expectedPayout: cols.actualPayout }
        : { isSettled: true, settledAt: meta.settledAt ?? new Date() }),
      // Phần ship shop chịu trên TikTok là CHÍNH SÁCH (phí ship người bán /
      // SFP), không phải sàn trừ nhầm → giữ làm chi phí trong P&L nhưng
      // không đưa vào rổ "Truy thu phí ship" (chỉ đổi khi còn CHO_KHIEU_NAI —
      // seller đã bấm khiếu nại thì tôn trọng).
      ...(!meta.estimated &&
      cols.shippingFeeDiff > 0 &&
      order.shippingDisputeStatus === ShippingDisputeStatus.CHO_KHIEU_NAI
        ? { shippingDisputeStatus: ShippingDisputeStatus.DA_DOI_SOAT }
        : {}),
    },
  });
}

export interface SyncUnsettledOptions {
  maxPages?: number;
  /** Chỉ đơn tạo trong N ngày gần nhất (search_time_ge) — mặc định 45. */
  daysBack?: number;
}

export interface SyncUnsettledResult {
  transactions: number;
  ordersUpdated: number;
  ordersNotFound: number;
  skippedSettled: number; // đơn đã có bản kê thật → không cho số ước tính ghi đè
  unlinked: number;
  pages: number;
}

/**
 * SỐ ƯỚC TÍNH CỦA CHÍNH SÀN cho đơn CHƯA quyết toán (Get Unsettled Transactions
 * 202507) → cùng bộ cột với bản kê thật, isSettled giữ false làm nhãn "chờ đối
 * soát". Cùng vai trò syncShopeePendingEscrowEstimates — không tự ước % phí.
 */
export async function syncTiktokUnsettledEstimates(
  channel: Channel,
  opts: SyncUnsettledOptions = {}
): Promise<SyncUnsettledResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const nowSec = Math.floor(Date.now() / 1000);
  const searchTimeGe = Math.max(nowSec - (opts.daysBack ?? 45) * 86_400, SETTLE_BACKFILL_FLOOR);

  const result: SyncUnsettledResult = {
    transactions: 0,
    ordersUpdated: 0,
    ordersNotFound: 0,
    skippedSettled: 0,
    unlinked: 0,
    pages: 0,
  };
  let shapeLogged = false;
  const byOrder = new Map<string, TikTokTxBreakdown[]>();

  // THANG DỰ PHÒNG tham số: lượt chạy thật 16/09 trả 36009003 "Internal error"
  // (docs unsettled còn mới, mẫu query ghi sort_field lạ). Trang đầu thử lần
  // lượt: đủ ge+lt → chỉ ge → không lọc thời gian; biến thể nào qua được thì
  // giữ cho các trang sau và ghi log để soi.
  const variants: { label: string; ge?: number; lt?: number }[] = [
    { label: "ge+lt", ge: searchTimeGe, lt: nowSec },
    { label: "ge", ge: searchTimeGe },
    { label: "không lọc thời gian" },
  ];
  let variantIdx = 0;
  let pageToken: string | undefined;
  do {
    let data: Awaited<ReturnType<typeof fetchUnsettledTransactions>> | undefined;
    for (; variantIdx < variants.length; variantIdx++) {
      const v = variants[variantIdx];
      try {
        data = await fetchUnsettledTransactions({
          accessToken,
          shopCipher,
          searchTimeGe: v.ge,
          searchTimeLt: v.lt,
          pageSize: 100,
          pageToken,
        });
        if (variantIdx > 0 && !pageToken) {
          console.log(`[TikTok] Unsettled "${channel.shopName}": dùng biến thể tham số "${v.label}"`);
        }
        break;
      } catch (err) {
        const msg = (err as Error).message;
        // Chỉ đổi biến thể khi sàn báo lỗi nội bộ ở TRANG ĐẦU; lỗi khác (rate
        // limit, token…) hoặc lỗi giữa chừng thì ném ra để nơi gọi ghi nhận.
        if (!msg.includes("36009003") || pageToken || variantIdx === variants.length - 1) throw err;
        console.warn(`[TikTok] Unsettled "${channel.shopName}": biến thể "${v.label}" bị 36009003, thử biến thể kế`);
      }
    }
    if (!data) break;
    result.pages++;
    const lines = data.transactions ?? [];
    if (!shapeLogged && lines[0]) {
      shapeLogged = true;
      logShape("giao dịch chưa quyết toán 202507", lines[0]);
    }
    const { byOrder: grouped, unlinked } = groupTiktokLinesByOrder(lines);
    result.unlinked += unlinked;
    for (const [orderId, ls] of grouped) {
      result.transactions += ls.length;
      byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), ...ls]);
    }
    pageToken = data.next_page_token || undefined;
  } while (pageToken && result.pages < maxPages);

  for (const [orderId, lines] of byOrder) {
    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderId } },
      select: { id: true, shippingDisputeStatus: true, isSettled: true },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }
    if (order.isSettled) {
      result.skippedSettled++;
      continue;
    }
    const first = lines.find((l) => l.type === "ORDER") ?? lines[0];
    await writeTiktokSettlement(order, lines, {
      estimated: true,
      estimatedSettlementAt: parseEstimatedSettlement(first?.estimated_settlement),
      unsettledReason: first?.unsettled_reason ?? null,
    });
    result.ordersUpdated++;
  }

  return result;
}


// ============================================================
// WEBHOOK THỜI GIAN THỰC — đơn mới / đổi trạng thái → upsert + trừ/hoàn kho
//
// Khác luồng đồng bộ lô (chỉ upsert), webhook xử lý TỒN KHO real-time: khi đơn
// đã chốt/chờ giao thì trừ kho; khi đơn hủy thì hoàn kho. Cả hai đều idempotent.
// ============================================================

/**
 * Các trạng thái TikTok mà đơn đã ĐƯỢC CHỐT và cần trừ kho (khách đã trả tiền,
 * shop phải giao). Loại UNPAID/ON_HOLD (chưa chắc chắn) và CANCELLED (xử lý riêng).
 */
function shouldDeductStock(tiktokStatus?: string): boolean {
  switch (tiktokStatus) {
    case "AWAITING_SHIPMENT":
    case "AWAITING_COLLECTION":
    case "PARTIALLY_SHIPPING":
    case "IN_TRANSIT":
    case "DELIVERED":
    case "COMPLETED":
      return true;
    default:
      return false;
  }
}

// deductStockTx/restoreStockTx idempotent nay ở ../order-stock (dùng chung Shopee).

export interface OrderEventResult {
  found: boolean; // TikTok có trả chi tiết đơn không
  created: boolean; // upsert tạo mới hay cập nhật
  orderStatus?: string; // trạng thái TikTok
  inventory: StockOutcome; // kết quả tác động tồn kho
  deducted?: number;
  restored?: number;
  /** SKU kho vừa biến động — route webhook đẩy tồn mới lên các sàn khác + kiểm tra ngưỡng. */
  productIds?: string[];
}

/**
 * XỬ LÝ MỘT SỰ KIỆN ĐỔI TRẠNG THÁI ĐƠN (từ webhook). Payload webhook chỉ có
 * order_id + trạng thái, nên phải gọi getOrderDetail để lấy đầy đủ line_items
 * rồi upsert + tác động tồn kho — TẤT CẢ trong một transaction để nguyên tử.
 */
export async function processTiktokOrderEvent(
  channel: Channel,
  orderId: string
): Promise<OrderEventResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const details = await getOrderDetail({ accessToken, shopCipher, orderIds: [orderId] });
  const order = details[0];
  if (!order) {
    return { found: false, created: false, inventory: "none" };
  }
  logShape("đơn (webhook → orders detail)", order);

  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.TIKTOK];

  const status = tiktokOrderStatus(order);
  return prisma.$transaction(async (tx) => {
    const up = await upsertOrderTx(tx, channel, order, feeRate);

    // Quyết định tác động tồn kho theo trạng thái TikTok.
    if (status === "CANCELLED") {
      const r = await restoreStockTx(tx, up.orderId, "webhook TikTok");
      return {
        found: true,
        created: up.created,
        orderStatus: status,
        inventory: r.outcome,
        restored: r.restored,
        productIds: r.productIds,
      };
    }

    if (shouldDeductStock(status)) {
      const d = await deductStockTx(tx, up.orderId, "webhook TikTok");
      return {
        found: true,
        created: up.created,
        orderStatus: status,
        inventory: d.outcome,
        deducted: d.deducted,
        productIds: d.productIds,
      };
    }

    // UNPAID/ON_HOLD… — đã upsert nhưng chưa đụng kho.
    return {
      found: true,
      created: up.created,
      orderStatus: status,
      inventory: "none",
    };
  });
}

/**
 * SỰ KIỆN THU HỒI ỦY QUYỀN (webhook type 5 — SELLER_DEAUTHORIZATION). Không tin
 * mù payload: gọi lại sàn xem token còn thao tác được gian này không (cùng
 * cách Shopee: processShopeeAuthorizationEvent). Còn → giữ ACTIVE; mất → ghi
 * DISCONNECTED + disconnectedAt (banner đỏ "gian mất kết nối" trên UI). Chỉ
 * ghi khi trạng thái ĐỔI THẬT để không reset mốc disconnectedAt mỗi sự kiện.
 */
export async function processTiktokAuthorizationEvent(
  shopId: string
): Promise<{ status: string } | null> {
  const channel = await prisma.channel.findFirst({
    where: {
      channelName: ChannelName.TIKTOK,
      externalShopId: shopId,
      refreshToken: { not: null },
    },
  });
  if (!channel) return null;

  let ok = false;
  try {
    const { accessToken } = await getValidAccessToken(channel);
    const shops = await getAuthorizedShops(accessToken);
    ok = shops.some((s) => s.id === shopId);
  } catch {
    ok = false;
  }

  const status = ok ? "ACTIVE" : "DISCONNECTED";
  if (channel.status !== status) {
    await prisma.channel.update({
      where: { id: channel.id },
      data: { status, disconnectedAt: ok ? null : new Date() },
    });
  }
  return { status };
}

/**
 * Tìm gian TikTok của một shop theo shop_id phía TikTok (externalShopId). Webhook
 * là kênh CÔNG KHAI nên chỉ dựa vào shop_id trong payload đã ký để định danh gian.
 */
export async function findTiktokChannelByShopId(
  shopId: string
): Promise<Channel | null> {
  return prisma.channel.findFirst({
    where: {
      channelName: ChannelName.TIKTOK,
      externalShopId: shopId,
      status: "ACTIVE",
      shopCipher: { not: null },
    },
  });
}
