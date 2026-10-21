// ============================================================
// TIKTOK SHOP — TẦNG NGHIỆP VỤ (có truy cập DB)
//
// client.ts là các hàm API THUẦN (không biết DB). File này ghép chúng với Prisma:
//   1) getValidAccessToken() — tự refresh access_token khi sắp hết hạn.
//   2) syncTiktokOrders()    — kéo đơn thật → upsert Order + OrderItem.
//   3) syncTiktokSettlements()— kéo đối soát thật → cập nhật số quyết toán/đơn.
// ============================================================

import { effectiveSkuCost } from "../../lib/cost-price";
import type { Channel, Prisma } from "@prisma/client";
import { ChannelName, ShippingDisputeStatus, ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { carrierFromName } from "../../services/shipping";
import { backfillOrderItemImagesTx } from "../order-item-images";
import {
  decimalDiffers,
  fetchExistingOrdersByCode,
  hasPlannedChanges,
  needsItemImageBackfill,
  rowDiffers,
  syncWriteAlways,
} from "../order-sync-write";
import { PLATFORM_FEE_RATE } from "../../marketplace/mockMarketplace";
import { deductStockTx, restoreStockTx, type StockOutcome } from "../order-stock";
import { stageStockPush, type StockPushTicket } from "../inventory-push";
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
import { planSettlementWrite, type SettlementWritePlan } from "../settlement-merge";
import { lineKey, resolveOrderLineRows, tiktokLineExternalId } from "../order-line-keys";
import type { SyncCompleteness } from "../sync-contract";
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

/**
 * Gộp line_items theo PHÂN LOẠI LÁ (product_id + sku_id), cộng dồn số lượng
 * (202309 tách theo đơn vị). Trước 15/10/2026 gộp theo seller_sku → hai size
 * cùng mã thành một dòng; nay giữ externalId để tra đúng dòng ChannelProduct.
 */
export function aggregateLineItems(order: TikTokOrder) {
  const agg = new Map<
    string,
    {
      channelSku: string;
      externalId: string | null;
      productName: string;
      price: number;
      quantity: number;
      imageUrl: string | null;
    }
  >();
  for (const li of order.line_items ?? []) {
    // trim như tiktokChannelSku ở adapter sản phẩm — seller gõ thừa dấu cách
    // là đơn không khớp SKU sàn, giá vốn không tra được (28/09).
    const sku = li.seller_sku?.trim() || li.sku_id || li.id;
    const externalId = tiktokLineExternalId(li.product_id, li.sku_id);
    const key = lineKey({ channelSku: sku, externalId });
    const qty = li.quantity ?? 1;
    const imageUrl = li.sku_image?.trim() || null;
    // "Tên sản phẩm - Tên phân loại" như Shopee (item_name - model_name).
    const name =
      [li.product_name?.trim(), li.sku_name?.trim()].filter(Boolean).join(" - ") || sku;
    const existing = agg.get(key);
    if (existing) {
      existing.quantity += qty;
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
    } else {
      agg.set(key, {
        channelSku: sku,
        externalId,
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
  /**
   * Cửa sổ TƯỜNG MINH theo trục update_time (giây Unix, hai đầu đóng) — mốc nước
   * của worker (lát 3.2). Có mặt thì thắng `daysBack` và ép `byUpdateTime`.
   */
  updateTimeFrom?: number;
  updateTimeTo?: number;
  maxPages?: number;
}

/**
 * Thứ tự xin sàn cho orders/search — PHẢI cùng trục với bộ lọc thời gian.
 *
 * Pha A 18/10/2026 (docs/CUNG-HOA-LOP-GOI-SAN.md 3b H1, đo 24/24 gian): không gửi
 * `sort_field` thì TikTok trả đơn theo create_time TĂNG dần (cũ nhất trước) dù lọc
 * theo update_time, nên lượt bị cắt ở trần trang giữ lại phần CŨ và mốc vét của
 * lát 3.2 (= update_time nhỏ nhất đã đọc, giả định "đọc mới nhất trước") trỏ sai →
 * mốc nước Siêu Thị 8686 kẹt. Gửi sort theo đúng trục, DESC, thì giả định ấy đúng
 * (kiểm 24/24 gian đơn điệu giảm). Anh Trung chốt vá ngay 18/10 đêm.
 */
export function tiktokOrderSearchSort(
  byUpdateTime: boolean,
  oldestFirst = false
): {
  sortField: "create_time" | "update_time";
  sortOrder: "ASC" | "DESC";
} {
  // Quét update_time theo MỐC NƯỚC (worker): CŨ → MỚI để lượt bị cắt vẫn ghi nhận
  // được phần đã đọc (coveredUpToSec, sync-contract.ts). Đọc MỚI → CŨ + mốc vét
  // (18/10) làm gian > 2.500 biến động/cửa sổ đọc lại mãi 2.500 đơn mới nhất
  // (Siêu Thị 8686 19/10: mốc tiến 6–13'/chu kỳ 20'). Đường gọi tay (daysBack,
  // không mốc nước) và create_time giữ DESC: mới nhất trước.
  return {
    sortField: byUpdateTime ? "update_time" : "create_time",
    sortOrder: byUpdateTime && oldestFirst ? "ASC" : "DESC",
  };
}

/**
 * Lượt đọc CŨ → MỚI bị cắt: mọi dòng ≤ update_time lớn nhất đã đọc là trọn →
 * trả mốc ấy để mốc nước tiến. Chỉ tin khi dãy update_time không giảm (sàn tôn
 * trọng sort ASC; H1 Pha A đo 24/24 gian tôn trọng DESC, chiều ASC kiểm tại chỗ
 * mỗi lượt) — sai thứ tự thì trả undefined: KHÔNG BAO GIỜ tiến mốc sai.
 * Thuần, không DB — test integrations/__tests__/tiktok-order-search-sort.test.ts.
 */
export function tiktokAscCoveredUpTo(updateTimes: number[], truncated: boolean): number | undefined {
  if (!truncated || updateTimes.length === 0) return undefined;
  for (let i = 1; i < updateTimes.length; i++) {
    if (updateTimes[i] < updateTimes[i - 1]) return undefined;
  }
  return updateTimes[updateTimes.length - 1];
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

export interface SyncOrdersResult extends SyncCompleteness {
  fetched: number; // số đơn TikTok trả về
  created: number; // số Order tạo mới
  updated: number; // số Order đã có mà sàn báo KHÁC giá trị đang lưu → có UPDATE
  unchanged: number; // số Order đã có, sàn trả đúng giá trị đang lưu → không mở giao dịch (12/10/2026)
  itemsCreated: number; // số OrderItem tạo mới
  pages: number;
  /** true = có lát chạm chốt chặn số trang, còn đơn CHƯA đọc. */
  truncated: boolean;
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
  const byWatermark = opts.updateTimeFrom !== undefined && opts.updateTimeTo !== undefined;
  if (byWatermark) opts = { ...opts, byUpdateTime: true };
  const fromSec = byWatermark
    ? opts.updateTimeFrom!
    : (opts.createTimeGe ?? nowSec - (opts.daysBack ?? 120) * 24 * 60 * 60);
  // update_time_lt / create_time_lt là mốc MỞ: cửa sổ mốc nước đóng hai đầu nên +1 giây.
  const toSec = byWatermark ? opts.updateTimeTo! + 1 : (opts.createTimeLt ?? nowSec);
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
  /** update_time theo thứ tự sàn trả (quét update_time ASC) — kiểm thứ tự khi bị cắt. */
  const updateTimesInOrder: number[] = [];

  // % phí tạm tính (GĐ1) khi đơn chưa được đối soát — số thật thay sau ở settlement.
  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.TIKTOK];

  const result: SyncOrdersResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    itemsCreated: 0,
    pages: 0,
    truncated: false,
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
      ...tiktokOrderSearchSort(Boolean(opts.byUpdateTime), byWatermark),
      pageSize: PAGE_SIZE,
      pageToken,
    });
    result.pages++;
    slicePages++;

    // Đơn đã có đọc MỘT câu cho cả trang rồi so trong RAM — đơn không khác thì
    // không mở giao dịch (12/10/2026, order-sync-write.ts).
    const pageOrders = data.orders ?? [];
    const existingByCode = await fetchExistingOrdersByCode(
      prisma,
      channel.id,
      pageOrders.map((o) => o.id),
      TIKTOK_EXISTING_SELECT
    );
    for (const o of pageOrders) {
      result.fetched++;
      if (!shapeLogged) {
        shapeLogged = true;
        logShape("đơn (orders/search)", o);
      }
      if (o.update_time) {
        if (!windowMinUpdate || o.update_time < windowMinUpdate) windowMinUpdate = o.update_time;
        if (o.update_time > windowMaxUpdate) windowMaxUpdate = o.update_time;
        if (byWatermark) updateTimesInOrder.push(o.update_time);
      }
      const existing = existingByCode.get(o.id) ?? null;
      if (
        existing &&
        !hasPlannedChanges(planTiktokOrderUpdate(existing, o)) &&
        !needsItemImageBackfill(existing.createdAt)
      ) {
        result.unchanged++;
        continue;
      }
      // Đồng bộ lô CỐ Ý không trừ kho (chỉ upsert), nên mỗi đơn một transaction nhẹ.
      const outcome = await prisma.$transaction((tx) =>
        upsertOrderTx(tx, channel, o, feeRate, existing)
      );
      if (outcome.created) {
        result.created++;
        result.itemsCreated += outcome.itemsCreated;
      } else if (outcome.changed) {
        result.updated++;
      } else {
        result.unchanged++; // chỉ điền bù ảnh dòng hàng, Order không đổi
      }
    }

    pageToken = data.next_page_token || undefined;
  } while (pageToken && slicePages < maxPages);
  if (pageToken) result.truncated = true; // lát này còn trang chưa đọc
  }

  // KIỂM CỬA SỔ (16/09): lượt quét update_time 2 ngày trả về 261/262 đơn — nghi
  // sàn bỏ qua update_time_ge. Ghi min/max update_time của lô so với cửa sổ để
  // đối chiếu; ngoài cửa sổ → cần đổi sang lọc phía Hubsell. Tắt TIKTOK_SHAPE_LOG=0.
  if (opts.byUpdateTime && result.fetched > 0 && process.env.TIKTOK_SHAPE_LOG !== "0") {
    console.log(
      `[TikTok] Cửa sổ update_time ${new Date(fromSec * 1000).toISOString()} → ${new Date(toSec * 1000).toISOString()}: ${result.fetched} đơn, update_time thấp nhất ${windowMinUpdate ? new Date(windowMinUpdate * 1000).toISOString() : "?"}, cao nhất ${windowMaxUpdate ? new Date(windowMaxUpdate * 1000).toISOString() : "?"}`
    );
  }
  if (windowMinUpdate) result.oldestUpdateTime = windowMinUpdate;
  if (byWatermark && result.truncated) {
    // Đọc CŨ → MỚI: phần đã đọc là trọn tới update_time lớn nhất → mốc nước tiến.
    // oldestUpdateTime bỏ đi: mốc vét "phần cũ hơn chưa đọc" chỉ đúng khi đọc mới → cũ.
    result.coveredUpToSec = tiktokAscCoveredUpTo(updateTimesInOrder, true);
    delete result.oldestUpdateTime;
    if (result.coveredUpToSec === undefined) {
      console.warn(
        `[TikTok] "${channel.shopName}": sàn trả update_time KHÔNG tăng dần dù xin sort ASC (${updateTimesInOrder.length} dòng) — lượt cắt không tiến mốc, lượt sau đọc lại`
      );
    }
  }

  return result;
}

/** Cột của đơn đã có cần đọc để lập bản ghi dự kiến (đúng các cột UPDATE có thể ghi). */
export const TIKTOK_EXISTING_SELECT = {
  id: true,
  orderCode: true,
  createdAt: true,
  shippingStatus: true,
  paymentStatus: true,
  totalAmount: true,
  platformSubsidy: true,
  trackingCode: true,
  platformPackageId: true,
  deliveredAt: true,
  carrier: true,
  shippingCarrierName: true,
  isSettled: true,
} satisfies Prisma.OrderSelect;

export type TiktokExistingOrder = Prisma.OrderGetPayload<{ select: typeof TIKTOK_EXISTING_SELECT }>;

/** Các giá trị rút từ payload đơn TikTok mà cả planner lẫn tạo mới cùng dùng. */
function tiktokOrderFields(order: TikTokOrder) {
  const status = tiktokOrderStatus(order);
  const shippingStatus = mapShippingStatus(status);
  return {
    status,
    shippingStatus,
    paymentStatus: status === "UNPAID" ? "UNPAID" : "PAID",
    totalAmount: Number(order.payment?.total_amount ?? 0) || 0,
    trackingCode: order.tracking_number?.trim() || null,
    // Kiện hàng đầu tiên — id cho API in vận đơn/bàn giao (fulfillment packages).
    packageId: order.packages?.[0]?.id?.trim() || null,
    // Trợ giá SÀN lúc đặt đơn (payment.platform_discount — TikTok bù lại phần giảm
    // giá do sàn tài trợ khi giải ngân, cùng nghĩa platform_discount_amount của bản
    // kê) → P&L ước tính real-time; số thật ghi đè khi đối soát. Voucher SHOP
    // KHÔNG ghi: OrderItem.price = sale_price đã trừ giảm giá shop (tránh trừ đôi).
    platformSubsidy: Number(order.payment?.platform_discount ?? 0) || 0,
    // Mốc giao thành công theo SÀN (delivery_time) — chính xác hơn "lúc đồng bộ".
    deliveredAt:
      shippingStatus === ShippingStatus.DELIVERED
        ? order.delivery_time
          ? new Date(order.delivery_time * 1000)
          : new Date()
        : null,
    // Tên PHƯƠNG THỨC + hãng nguyên văn — nguồn bắt hỏa tốc: "Hỏa tốc"/"Giao Trong
    // Ngày" nằm ở delivery_option_name, hãng có thể là J&T giao thường. Ghi ghép
    // "phương thức · hãng" để cùng luật EXPRESS_KEYWORDS với Shopee/Lazada
    // (khảo sát 08/09/2026 — chuỗi VN thật chưa có trong docs, soi log khi nối shop thật).
    carrierName:
      [order.delivery_option_name?.trim(), order.shipping_provider?.trim()]
        .filter(Boolean)
        .join(" · ") || null,
    carrier: carrierFromName(order.shipping_provider),
  };
}

/**
 * Bản ghi dự kiến cho đơn ĐÃ CÓ: chỉ gồm cột mà sàn báo KHÁC giá trị đang lưu.
 * Rỗng = đơn không đổi → tầng gọi không mở giao dịch (12/10/2026). Thuần, không
 * chạm database; giữ nguyên các luật ghi của bản trước:
 *   · đơn đã đối soát: số bản kê là sự thật, không ghi đè platformSubsidy;
 *   · vận đơn / kiện chỉ ghi khi sàn có giá trị (không xóa bằng rỗng);
 *   · mốc giao thành công ghi MỘT lần; hãng chỉ điền khi trống.
 * SYNC_WRITE_ALWAYS=1 → trả đủ cột như trước (đường lui khi nghi so thiếu).
 */
export function planTiktokOrderUpdate(existing: TiktokExistingOrder, order: TikTokOrder): Prisma.OrderUpdateInput {
  const f = tiktokOrderFields(order);
  const always = syncWriteAlways();
  const data: Prisma.OrderUpdateInput = {};
  if (always || existing.shippingStatus !== f.shippingStatus) data.shippingStatus = f.shippingStatus;
  if (always || existing.paymentStatus !== f.paymentStatus) data.paymentStatus = f.paymentStatus;
  if (always || decimalDiffers(existing.totalAmount, f.totalAmount)) data.totalAmount = f.totalAmount;
  // Đơn đã đối soát: số bản kê là sự thật, đồng bộ lô không ghi đè cột tài chính.
  if (!existing.isSettled && (always || decimalDiffers(existing.platformSubsidy, f.platformSubsidy))) {
    data.platformSubsidy = f.platformSubsidy;
  }
  if (f.trackingCode && (always || existing.trackingCode !== f.trackingCode)) data.trackingCode = f.trackingCode;
  if (f.packageId && (always || existing.platformPackageId !== f.packageId)) data.platformPackageId = f.packageId;
  // Mốc GIAO THÀNH CÔNG ghi MỘT lần (Kiểm toán phí sàn rổ #3 đếm từ đây).
  if (f.deliveredAt && !existing.deliveredAt) data.deliveredAt = f.deliveredAt;
  // Chỉ điền hãng khi đang trống — không ghi đè lựa chọn tay của kho.
  if (f.carrier && !existing.carrier) data.carrier = f.carrier;
  // Tên hãng NGUYÊN VĂN là dữ kiện sàn (nguồn bắt hỏa tốc) — ghi khi khác.
  if (f.carrierName && (always || existing.shippingCarrierName !== f.carrierName)) {
    data.shippingCarrierName = f.carrierName;
  }
  return data;
}

/**
 * Tạo mới hoặc cập nhật MỘT đơn TikTok TRONG một transaction cho trước. Tạo mới
 * thì kèm OrderItem + snapshot giá vốn; đã tồn tại thì chỉ ghi cột KHÁC
 * (planTiktokOrderUpdate) — KHÔNG đụng OrderItem để giữ nguyên snapshot giá vốn.
 *
 * Nhận `tx` từ bên ngoài để webhook có thể GỘP upsert + trừ kho vào cùng một
 * transaction (đảm bảo nguyên tử); luồng đồng bộ lô thì tự bọc `$transaction`
 * và truyền `existing` đã đọc theo lô (không truyền thì tự đọc).
 */
async function upsertOrderTx(
  tx: Prisma.TransactionClient,
  channel: Channel,
  order: TikTokOrder,
  feeRate: number,
  existing?: TiktokExistingOrder | null
): Promise<{ orderId: string; created: boolean; changed: boolean; itemsCreated: number }> {
  const orderCode = order.id;
  const { shippingStatus, paymentStatus, totalAmount, trackingCode, packageId, platformSubsidy, deliveredAt, carrierName, carrier } =
    tiktokOrderFields(order);
  const customerName =
    order.recipient_address?.name?.trim() ||
    [order.recipient_address?.first_name, order.recipient_address?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    "Khách TikTok";
  const customerPhone = order.recipient_address?.phone_number?.trim() || null;

  if (existing === undefined) {
    existing = await tx.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode } },
      select: TIKTOK_EXISTING_SELECT,
    });
  }

  if (existing) {
    const data = planTiktokOrderUpdate(existing, order);
    const changed = hasPlannedChanges(data);
    if (changed) {
      await tx.order.update({ where: { id: existing.id }, select: { id: true }, data });
    }
    if (needsItemImageBackfill(existing.createdAt)) {
      await backfillOrderItemImagesTx(tx, existing.id, aggregateLineItems(order));
    }
    return { orderId: existing.id, created: false, changed, itemsCreated: 0 };
  }

  const lines = aggregateLineItems(order);

  // Nối SKU sàn → sản phẩm gốc (nếu đã liên kết) để snapshot giá vốn & gắn productId.
  // Lấy CẢ dòng chưa liên kết kho: giá vốn khi đó nằm ở cấp SKU sàn (costPrice
  // của ChannelProduct) — khách không nối kho gốc vẫn tính được lãi/lỗ.
  // Tra theo product_id-sku_id trước, seller_sku là đường lui (order-line-keys).
  const rowByLine = await resolveOrderLineRows(tx, channel.id, lines);

  const created = await tx.order.create({
    select: { id: true },
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
    const mp = rowByLine.get(lineKey(line));
    await tx.orderItem.create({
      select: { id: true },
      data: {
        orderId: created.id,
        productId: mp?.productId ?? null,
        // Khóa dòng sàn khớp được (có đuôi phân loại nếu mã trùng); không khớp → mã thô.
        channelSku: mp?.channelSku ?? line.channelSku,
        // Danh tính thật của dòng = id lá sàn (product-sku); ghi KỂ CẢ khi danh mục chưa có lá — về sau
        // danh mục có là tra được, không phải sửa dòng (docs/MO-HINH-CAY-SAN-PHAM-SAN.md B3, 18/10/2026).
        externalId: mp?.externalId ?? line.externalId,
        productName: line.productName,
        quantity: line.quantity,
        price: line.price,
        imageUrl: line.imageUrl,
        // Giá riêng của gian, không có thì giá mặc định ở kho (lib/cost-price).
        costPriceAtSale: String(effectiveSkuCost(mp)),
      },
    });
  }

  return { orderId: created.id, created: true, changed: true, itemsCreated: lines.length };
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
  /** Trần số đơn gom trong RAM trước khi ghi một lô (mặc định SETTLE_FLUSH_ORDERS; test đặt nhỏ). */
  flushOrders?: number;
}

export interface SyncSettlementsResult {
  statements: number; // số bản kê quét qua
  transactions: number; // số dòng giao dịch đọc được
  /** Số LƯỢT ghi sao kê đơn (đơn có dòng ở hai lô ghi khác nhau đếm hai lần — chỉ để log/toast). */
  ordersUpdated: number;
  /** Mã đơn trên bản kê chưa có trong Hubsell, đếm theo lô (mã gặp ở hai lô đếm hai lần). */
  ordersNotFound: number;
  unlinked: number; // dòng cấp shop không gắn đơn (phạt, ship mẫu, nạp ví ads…)
  windows: number; // số cửa sổ thời gian đã quét
  pages: number;
}

const SETTLE_WINDOW_DAYS = 30;
/**
 * Trần số đơn gom trong RAM trước khi ghi một lô sao kê (21/10/2026, sự cố OOM
 * Bella Look). 20.000 ≈ cửa sổ 7 ngày của gian 3.000 đơn/ngày — mức lượt nhịp
 * giờ đã chạy được trên gói Starter 512 MB. Đổi bằng env TIKTOK_SETTLE_FLUSH_ORDERS.
 */
const SETTLE_FLUSH_ORDERS = Math.max(1, Number(process.env.TIKTOK_SETTLE_FLUSH_ORDERS) || 20_000);
/** API Finance 202501/202507 chỉ có dữ liệu từ 01/01/2025 (epoch giây) — mốc dùng chung với payouts.ts. */
export const SETTLE_BACKFILL_FLOOR = Date.UTC(2025, 0, 1) / 1000;

/** Các bản kê mà sao kê ĐANG LƯU của đơn được dựng từ đó (số ước tính → chưa có). */
function storedStatementIds(
  row: { estimated: boolean; statementId: string | null; statementIds: string[] } | null
): string[] {
  if (!row || row.estimated) return [];
  // Dòng ghi trước 02/10/2026 chưa có danh sách — chỉ biết bản kê ghi sau cùng.
  if (row.statementIds.length > 0) return row.statementIds;
  return row.statementId ? [row.statementId] : [];
}

/**
 * Kéo bản kê giải ngân THẬT (Finance API 202501, có breakdown đặt tên) và ghi
 * cho từng Order: sao kê chi tiết TiktokOrderSettlement (số có dấu) + cột gộp
 * GĐ2 (isSettled/actualPayout/phí…). Sao kê của đơn luôn là TỔNG mọi dòng ở mọi
 * bản kê có đơn đó (quy tắc ở ../settlement-merge.ts) — chạy lại, chạy cửa sổ hẹp
 * hay rộng đều ra đúng một kết quả.
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

  // GHI THEO LÔ, TRẦN SỐ ĐƠN GIỮ TRONG RAM (21/10/2026). Trước đó gom mọi dòng
  // của cùng đơn TRONG MỘT CỬA SỔ 30 ngày rồi ghi một lượt (22/09: đủ cho gian
  // ~185 đơn/ngày). Gian Bella Look (nối 20/10, ~3.100 dòng bản kê/ngày) làm một
  // cửa sổ ≈ 94.000 dòng kèm breakdown → worker Render hết heap 8 lần/đêm, sập
  // TRƯỚC câu UPDATE hạ cờ backfill nên lượt sau làm lại y hệt (vòng lặp sập).
  // Nay: vẫn gom theo đơn (ORDER + REFUND + điều chỉnh cùng đơn về một chỗ; hai
  // bản kê khác ngày trong cùng lô vẫn về một chỗ), nhưng cứ hết MỘT bản kê mà
  // lô đã ≥ flushOrders đơn thì ghi lô rồi bỏ; hết cửa sổ ghi nốt. Đơn có dòng ở
  // bản kê NGOÀI lô đang ghi (bản kê đã ghi từ lượt trước, lô trước hay cửa sổ
  // trước của chính lượt này) → planSettlementWrite bảo đọc lại dòng của đơn ở
  // các bản kê đó (fetchOrderLinesFromStatements) rồi cộng chung mới ghi — cùng
  // đường đã có từ 02/10, số y hệt cách gom cả cửa sổ. Mảnh đã biết của đơn đọc
  // từ DB (statementIds — lô trước của chính lượt này vừa ghi cũng nằm đó) nên
  // KHÔNG giữ gì giữa các lô: RAM không phụ thuộc cỡ gian. Gian thường (một cửa
  // sổ < trần) không đổi hành vi.
  const flushOrders = Math.max(1, opts.flushOrders ?? SETTLE_FLUSH_ORDERS);
  const auth = { accessToken, shopCipher };
  const tally = { merged: 0, incomplete: 0 };
  // Cửa sổ nới mốc cuối 2 ngày nên có thể chồng lấn → mỗi bản kê chỉ bóc MỘT lần.
  const seenStatements = new Set<string>();
  let byOrder: SettlementBatch = new Map();

  for (const w of windows) {
    let stPageToken: string | undefined;
    let stPages = 0;
    do {
      const list = await fetchSettlements({
        accessToken,
        shopCipher,
        statementTimeGe: w.ge,
        // ĐỐI CHIẾU THẬT 16/09: statement_time_lt = now làm sàn BỎ bản kê mới
        // nhất (sinh 00:00 UTC hôm nay, đã SETTLED) — sàn so mốc với CUỐI kỳ
        // của bản kê (docs: "lt = any time on Oct 11" cho bản kê tới Oct 10).
        // Nới thêm 2 ngày; trùng lặp giữa cửa sổ đã có seenStatements chặn.
        statementTimeLt: w.lt + 2 * 86_400,
        pageSize: PAGE_SIZE,
        pageToken: stPageToken,
      });
      result.pages++;
      stPages++;

      for (const st of list.statements ?? []) {
        if (seenStatements.has(st.id)) continue;
        seenStatements.add(st.id);
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
            const acc = byOrder.get(orderId) ?? { lines: [], statementIds: new Set<string>() };
            acc.lines.push(...ls);
            // Mốc QUYẾT TOÁN = thời điểm bản kê (statement_time), không phải ngày tạo đơn.
            acc.time = st.statement_time ?? st.payment_time ?? acc.time;
            acc.statementId = st.id;
            acc.statementIds.add(st.id);
            byOrder.set(orderId, acc);
          }
          txPageToken = txData.next_page_token || undefined;
        } while (txPageToken && txPages < maxPages);

        // Chỉ cắt lô ở RANH BẢN KÊ: mọi dòng của một đơn trong cùng bản kê luôn
        // nằm chung một lô (một bản kê ≤ maxPages × 100 dòng, nhỏ so với trần).
        if (byOrder.size >= flushOrders) {
          await flushSettlementBatch(channel, auth, byOrder, maxPages, result, tally);
          byOrder = new Map();
        }
      }

      stPageToken = list.next_page_token || undefined;
    } while (stPageToken && stPages < maxPages);

    // Hết cửa sổ: ghi nốt lô đang dở.
    await flushSettlementBatch(channel, auth, byOrder, maxPages, result, tally);
    byOrder = new Map();
  }
  const { merged, incomplete } = tally;

  if (result.ordersNotFound > 0 || result.unlinked > 0 || merged > 0 || incomplete > 0) {
    console.log(
      `[TikTok] Đối soát "${channel.shopName}": ${result.ordersUpdated} đơn ghi số thật, ${result.ordersNotFound} mã đơn trên bản kê chưa có trong Hubsell, ${result.unlinked} dòng cấp shop không gắn đơn (${result.statements} bản kê / ${result.windows} cửa sổ` +
        `${merged > 0 ? `, ${merged} đơn cộng thêm dòng từ bản kê ngoài lô` : ""}` +
        `${incomplete > 0 ? `, ${incomplete} đơn CHƯA cộng được bản kê cũ` : ""})`
    );
  }

  return result;
}

type SettlementAcc = { lines: TikTokTxBreakdown[]; time?: number; statementId?: string; statementIds: Set<string> };
/** Một lô: mã đơn → mọi dòng của đơn đã gom từ các bản kê đang đọc. */
type SettlementBatch = Map<string, SettlementAcc>;

/**
 * Áp số quyết toán của MỘT LÔ đơn vào từng Order đã đồng bộ về trước đó; nơi
 * gọi bỏ lô sau khi hàm trả về. Mảnh đã biết của đơn đọc từ DB
 * (TiktokOrderSettlement.statementIds — lô trước của chính lượt này vừa ghi
 * cũng nằm đó), nên giữa các lô không giữ gì trong RAM.
 */
async function flushSettlementBatch(
  channel: Channel,
  auth: { accessToken: string; shopCipher: string },
  byOrder: SettlementBatch,
  maxPages: number,
  result: SyncSettlementsResult,
  tally: { merged: number; incomplete: number }
): Promise<void> {
  if (byOrder.size === 0) return;
  // (a) Đọc đơn + các bản kê sao kê đang lưu được dựng từ đó → quyết định ghi.
  const pending: {
    orderCode: string;
    order: { id: string; shippingDisputeStatus: ShippingDisputeStatus };
    acc: SettlementAcc;
    plan: SettlementWritePlan;
  }[] = [];
  const wantedByStatement = new Map<string, Set<string>>(); // bản kê cũ → các mã đơn cần đọc lại
  for (const [orderCode, acc] of byOrder) {
    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode } },
      select: {
        id: true,
        shippingDisputeStatus: true,
        tiktokSettlement: { select: { estimated: true, statementId: true, statementIds: true } },
      },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }
    const known = storedStatementIds(order.tiktokSettlement);
    const plan = planSettlementWrite(known, acc.statementIds);
    if (plan.action === "skip") continue;
    if (plan.action === "merge") {
      for (const id of plan.missing) {
        const set = wantedByStatement.get(id);
        if (set) set.add(orderCode);
        else wantedByStatement.set(id, new Set([orderCode]));
      }
    }
    pending.push({ orderCode, order, acc, plan });
  }

  // (b) Đọc lại các bản kê cũ MỘT lượt cho mọi đơn cần cộng (mỗi bản kê một lần).
  const older =
    wantedByStatement.size > 0
      ? await fetchOrderLinesFromStatements(auth, wantedByStatement, maxPages)
      : null;

  // (c) Ghi.
  for (const { orderCode, order, acc, plan } of pending) {
    let lines = acc.lines;
    if (plan.action === "merge") {
      const prevLines: TikTokTxBreakdown[] = [];
      let complete = true;
      for (const id of plan.missing) {
        const found = older?.lines.get(id)?.get(orderCode) ?? [];
        // Bản kê cũ đọc không trọn, hoặc không còn dòng nào của đơn → KHÔNG ghi
        // nửa chừng (thà giữ sao kê cũ còn hơn mất dòng); lượt sau thử lại.
        if (older?.unavailable.has(id) || found.length === 0) complete = false;
        prevLines.push(...found);
      }
      if (!complete) {
        tally.incomplete++;
        console.warn(
          `[TikTok] Đối soát "${channel.shopName}": đơn ${orderCode} có dòng ở bản kê mới nhưng không đọc lại đủ bản kê cũ [${plan.missing.join(",")}] — giữ sao kê đang lưu`
        );
        continue;
      }
      lines = [...prevLines, ...lines];
      tally.merged++;
    }
    const settledAt = acc.time ? new Date(acc.time * 1000) : new Date();
    await writeTiktokSettlement(order, lines, {
      estimated: false,
      settledAt,
      statementId: acc.statementId,
      statementIds: plan.all,
    });
    result.ordersUpdated++;
  }
}

/**
 * Dòng giao dịch của các đơn cho trước nằm trong các bản kê CŨ (ngoài cửa sổ
 * đang quét) — mỗi bản kê đọc MỘT lần cho mọi đơn cần nó. Đọc lại qua API thay
 * vì giữ dòng cũ trong RAM / database: ca này hiếm (hoàn / điều chỉnh rơi vào
 * bản kê khác với dòng bán) nên tốn vài call, còn dung lượng thì bằng 0.
 * Bản kê lỗi hoặc đọc chưa hết trang → nằm trong `unavailable`, nơi gọi không
 * được ghi các đơn phụ thuộc vào nó.
 */
async function fetchOrderLinesFromStatements(
  auth: { accessToken: string; shopCipher: string },
  wantedByStatement: Map<string, Set<string>>,
  maxPages: number
): Promise<{ lines: Map<string, Map<string, TikTokTxBreakdown[]>>; unavailable: Set<string> }> {
  const lines = new Map<string, Map<string, TikTokTxBreakdown[]>>();
  const unavailable = new Set<string>();
  for (const [statementId, wanted] of wantedByStatement) {
    const byOrder = new Map<string, TikTokTxBreakdown[]>();
    try {
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const data = await fetchStatementTransactionsV2({
          ...auth,
          statementId,
          pageSize: 100,
          pageToken,
        });
        pages++;
        for (const t of data.transactions ?? []) {
          const code = t.order_id || t.adjustment_order_id;
          if (!code || !wanted.has(code)) continue;
          const list = byOrder.get(code);
          if (list) list.push(t);
          else byOrder.set(code, [t]);
        }
        pageToken = data.next_page_token || undefined;
      } while (pageToken && pages < maxPages);
      if (pageToken) unavailable.add(statementId);
    } catch (err) {
      unavailable.add(statementId);
      console.warn(`[TikTok] Không đọc lại được bản kê ${statementId}:`, (err as Error).message);
    }
    lines.set(statementId, byOrder);
  }
  return { lines, unavailable };
}

/**
 * Ghi bản kê của MỘT đơn: sao kê chi tiết (có dấu) + cột gộp Order. Dùng cho
 * cả bản kê đã quyết toán (estimated=false: đặt isSettled/settledAt) và số ước
 * tính unsettled (estimated=true: KHÔNG đụng isSettled, ghi expectedPayout làm
 * mẫu số Kiểm toán phí sàn như Shopee).
 */
/**
 * Trả về số đã ghi (0–2: bản kê chi tiết, cột gộp Order). Bản kê ƯỚC TÍNH
 * (unsettled, mỗi giờ mọi đơn chưa quyết toán 45 ngày) so với dòng đang lưu
 * trước khi ghi — số không đổi thì không UPSERT/UPDATE (lát B 12/10/2026; câu
 * upsert dài 2 KB, prod ~60 nghìn lượt/ngày ghi lại số cũ). Bản kê THẬT giữ
 * ghi như cũ (đặt isSettled/settledAt, một lần mỗi đơn).
 */
async function writeTiktokSettlement(
  order: { id: string; shippingDisputeStatus: ShippingDisputeStatus },
  lines: TikTokTxBreakdown[],
  meta: {
    estimated: boolean;
    settledAt?: Date;
    statementId?: string;
    /** MỌI bản kê có dòng của đơn đã cộng vào sao kê này (bản kê thật). */
    statementIds?: string[];
    estimatedSettlementAt?: Date | null;
    unsettledReason?: string | null;
  }
): Promise<number> {
  const { detail, order: cols } = mapTiktokBreakdownToSettlement(lines);
  const detailData = {
    ...detail,
    estimated: meta.estimated,
    statementId: meta.statementId ?? null,
    statementIds: meta.estimated ? [] : meta.statementIds ?? (meta.statementId ? [meta.statementId] : []),
    estimatedSettlementAt: meta.estimatedSettlementAt ?? null,
    unsettledReason: meta.unsettledReason ?? null,
    settledAt: meta.estimated ? null : meta.settledAt ?? null,
  };
  const orderData = {
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
  };

  let writeDetail = true;
  let writeOrder = true;
  if (meta.estimated && !syncWriteAlways()) {
    const stored = await prisma.order.findUnique({
      where: { id: order.id },
      select: {
        ...(Object.fromEntries(Object.keys(orderData).map((k) => [k, true])) as Prisma.OrderSelect),
        tiktokSettlement: true,
      },
    });
    const { tiktokSettlement, ...storedOrder } = (stored ?? {}) as { tiktokSettlement?: unknown } & Record<string, unknown>;
    writeDetail = rowDiffers(tiktokSettlement as Record<string, unknown> | null, detailData);
    writeOrder = rowDiffers(storedOrder, orderData);
  }

  if (writeDetail) {
    await prisma.tiktokOrderSettlement.upsert({
      where: { orderId: order.id },
      select: { orderId: true },
      create: { orderId: order.id, ...detailData },
      update: detailData,
    });
  }
  if (writeOrder) {
    await prisma.order.update({ where: { id: order.id }, select: { id: true }, data: orderData });
  }
  return (writeDetail ? 1 : 0) + (writeOrder ? 1 : 0);
}

export interface SyncUnsettledOptions {
  maxPages?: number;
  /** Chỉ đơn tạo trong N ngày gần nhất (search_time_ge) — mặc định 45. */
  daysBack?: number;
}

export interface SyncUnsettledResult {
  transactions: number;
  /** Đơn có số ước tính KHÁC số đang lưu → đã ghi. */
  ordersUpdated: number;
  /** Đơn sàn trả đúng số đang lưu → không ghi (lát B 12/10/2026). */
  ordersUnchanged: number;
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
    ordersUnchanged: 0,
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
  // Lượt thật 16/09 (and.not.or): gửi cả search_time_ge + search_time_lt → sàn
  // báo 36009003 "Internal error"; CHỈ search_time_ge thì chạy (payload est_*
  // đúng docs). Thứ tự thử: ge → ge+lt → không lọc. Trang sau bị 36009003 thì
  // thử lại tối đa 2 lần rồi DỪNG ÊM (giữ số đã lấy), không ném lỗi.
  const variants: { label: string; ge?: number; lt?: number; sortOrder?: "ASC" | "DESC"; pageSize?: number }[] = [
    { label: "ge", ge: searchTimeGe },
    { label: "ge+lt", ge: searchTimeGe, lt: nowSec },
    { label: "không lọc thời gian" },
    { label: "ge, size 20, sort mặc định", ge: searchTimeGe, pageSize: 20, sortOrder: undefined },
  ];
  let variantIdx = 0;
  let pageToken: string | undefined;
  let truncated = false;
  do {
    let data: Awaited<ReturnType<typeof fetchUnsettledTransactions>> | undefined;
    if (!pageToken) {
      for (; variantIdx < variants.length; variantIdx++) {
        const v = variants[variantIdx];
        try {
          data = await fetchUnsettledTransactions({
            accessToken,
            shopCipher,
            searchTimeGe: v.ge,
            searchTimeLt: v.lt,
            pageSize: v.pageSize ?? 100,
            sortOrder: "sortOrder" in v ? v.sortOrder : "DESC",
          });
          if (variantIdx > 0) {
            console.log(`[TikTok] Unsettled "${channel.shopName}": dùng biến thể tham số "${v.label}"`);
          }
          break;
        } catch (err) {
          const msg = (err as Error).message;
          // Chỉ đổi biến thể khi sàn báo lỗi nội bộ; lỗi khác (rate limit,
          // token…) ném ra để nơi gọi ghi nhận.
          if (!msg.includes("36009003") || variantIdx === variants.length - 1) throw err;
          console.warn(`[TikTok] Unsettled "${channel.shopName}": biến thể "${v.label}" bị 36009003, thử biến thể kế`);
        }
      }
    } else {
      const v = variants[variantIdx];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          data = await fetchUnsettledTransactions({
            accessToken,
            shopCipher,
            searchTimeGe: v.ge,
            searchTimeLt: v.lt,
            pageSize: v.pageSize ?? 100,
            sortOrder: "sortOrder" in v ? v.sortOrder : "DESC",
            pageToken,
          });
          break;
        } catch (err) {
          const msg = (err as Error).message;
          if (!msg.includes("36009003")) throw err;
          if (attempt === 2) {
            truncated = true;
            console.warn(
              `[TikTok] Unsettled "${channel.shopName}": trang ${result.pages + 1} bị 36009003 sau 3 lần, dừng — giữ ${result.transactions} dòng đã lấy`
            );
          } else {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
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
  } while (pageToken && !truncated && result.pages < maxPages);

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
    const writes = await writeTiktokSettlement(order, lines, {
      estimated: true,
      estimatedSettlementAt: parseEstimatedSettlement(first?.estimated_settlement),
      unsettledReason: first?.unsettled_reason ?? null,
    });
    if (writes > 0) result.ordersUpdated++;
    else result.ordersUnchanged++;
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
  /**
   * Phiếu "tồn chờ đẩy" đã ghi CHUNG giao dịch đơn (giai đoạn 2 bước 4). Nơi gọi
   * đưa cho finishStockPush sau khi hàm này trả về (giao dịch đã commit).
   */
  stockTicket?: StockPushTicket;
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
  const applyOrder = async (tx: Prisma.TransactionClient): Promise<OrderEventResult> => {
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
  };

  // Kho biến động → dòng "tồn chờ đẩy" + việc stock.channel ghi CHUNG giao dịch
  // đơn: đơn đã commit thì việc đẩy tồn chắc chắn tồn tại.
  return prisma.$transaction(async (tx) => {
    const r = await applyOrder(tx);
    if (!r.productIds?.length) return r;
    const stockTicket = await stageStockPush(tx, r.productIds, { source: `webhook TikTok đơn ${orderId}` });
    return { ...r, stockTicket };
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

/** Đường đọc mới (Pha C lát 2, integrations/order-write-adapters.ts) dùng CHUNG hàm upsert — một luật ghi đơn TikTok. */
export const upsertTiktokOrderTx = upsertOrderTx;
