import { ChannelName, ReturnStatus, ShippingStatus, type Channel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getTrackingInfo, type ShopeeTrackingEvent } from "../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../integrations/shopee/service";
import { getOrderTracking, type TikTokTrackingEvent } from "../integrations/tiktok/client";
import { getValidAccessToken as getValidTikTokAccessToken } from "../integrations/tiktok/service";
import { countTiktokFailedDeliveries } from "../integrations/tiktok/delivery-fail";
import { CANCELLED_AFTER_SHIP } from "../integrations/cancelled-after-ship";

// ============================================================
// HÀNH TRÌNH VẬN CHUYỂN CỦA MỘT ĐƠN — xem theo yêu cầu (12/11/2026, app mobile:
// cuối hộp Chi tiết đơn hàng). Nguồn: API sàn, cùng hai hàm mà Cứu đơn giao thất
// bại đang dùng (Shopee get_tracking_info, TikTok orders/{id}/tracking).
//
// TIẾT CHẾ: mỗi lượt xem = 1 call sàn nên
//   · đơn chưa giao cho vận chuyển (Chờ xử lý, hoặc chưa có mã vận đơn) → không gọi;
//   · kết quả nhớ TRACKING_CACHE_MS trong RAM theo đơn — chỉ là đệm, mất (khởi động
//     lại, máy khác) thì tốn thêm đúng 1 call; KHÔNG dùng làm khóa hay nguồn sự thật;
//   · không quét nền, không lưu DB.
//
// Lazada: API /logistic/order/trace chưa có trong mã và chưa kiểm payload thật →
// trả state "unsupported" (docs/MOBILE-GOP-Y-KHACH-DOT-2.md mục 6).
// ============================================================

/** Nhớ kết quả chừng này cho mỗi đơn. Mặc định tự chọn: hành trình đổi vài lần một ngày. */
export const TRACKING_CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 2000;

export type TrackingEventKind = "normal" | "delivered" | "failed" | "returning";

export interface TrackingEvent {
  /** ISO; null khi sàn không trả thời điểm. */
  at: string | null;
  description: string;
  kind: TrackingEventKind;
  /**
   * Mốc hãng báo ĐÃ TRẢ kiện về người gửi — chặng hoàn kết thúc (13/11/2026, cột
   * Trạng thái vận chuyển ở Đối soát đơn hoàn). Trường thêm, KHÔNG thêm giá trị
   * mới vào `kind`: app mobile đang tra màu theo `kind`, giá trị lạ là mất màu.
   */
  returned?: true;
}

export type TrackingState =
  /** Có hành trình (events có thể rỗng khi hãng chưa quét mốc nào). */
  | "ok"
  /** Đơn chưa giao cho đơn vị vận chuyển — không gọi sàn. */
  | "not_shipped"
  /** Sàn / gian này chưa lấy được hành trình (Lazada, gian chưa nối API). */
  | "unsupported";

export interface OrderTracking {
  state: TrackingState;
  carrier: string | null;
  trackingCode: string | null;
  /** Mới nhất trước. */
  events: TrackingEvent[];
  /** Lúc Hubsell hỏi sàn (để app ghi "cập nhật lúc…"). */
  fetchedAt: string | null;
}

export class OrderTrackingError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// ───────── Phần thuần (có test) ─────────

function shopeeKind(status: string | undefined): TrackingEventKind {
  const s = (status ?? "").toUpperCase();
  if (s === "FAILED_DELIVERED" || s.includes("DELIVERY_FAILED")) return "failed";
  if (s.includes("RETURN")) return "returning";
  if (s === "DELIVERED" || s === "LOGISTICS_DELIVERY_DONE") return "delivered";
  return "normal";
}

/** Shopee tracking_info[] → mốc chuẩn hóa, mới nhất trước; bỏ mốc không có chữ. */
export function normalizeShopeeTracking(events: ShopeeTrackingEvent[] | undefined): TrackingEvent[] {
  return sortNewestFirst(
    (events ?? [])
      .map((e): TrackingEvent => ({
        at: typeof e.update_time === "number" && e.update_time > 0 ? new Date(e.update_time * 1000).toISOString() : null,
        description: String(e.description ?? "").trim(),
        kind: shopeeKind(e.logistics_status),
        // Enum thật của Shopee VN (delivery-fail.ts, đối chiếu đơn ANO + DarkMan):
        // RETURN_INITIATED → RETURN_STARTED → RETURNED. Chỉ RETURNED là đã trả xong.
        ...(String(e.logistics_status ?? "").toUpperCase() === "RETURNED" ? { returned: true as const } : {}),
      }))
      .filter((e) => e.description)
  );
}

const TIKTOK_RETURN = /hoàn\s*(trả|hàng|về)|trả\s*(hàng|về|lại)|quay\s*(đầu|về)|return/i;
/**
 * TikTok không có enum cho mốc "đã trả kiện về người bán" → nhận theo MẪU CHỮ. ⚠️ Mẫu
 * này CHƯA đối chiếu với hành trình thật của một kiện đã hoàn xong (13/11/2026): cố ý
 * viết chặt (phải có chữ hoàn / trả đứng TRƯỚC "thành công" — không tính "không thành
 * công" —, hoặc "returned to seller")
 * để thà sót còn hơn báo "hoàn thành công" oan; ô trên web luôn hiện kèm nguyên văn mốc
 * mới nhất của hãng nên sót thì người xem vẫn đọc được.
 */
const TIKTOK_RETURNED =
  /(hoàn|trả)\s*(trả|hàng|lại|về)?[^.;]{0,40}(?<!không\s*)thành\s*công|returned\s*to\s*(the\s*)?(seller|sender|merchant|shipper)|return\s*(completed|successful)/i;
const TIKTOK_DELIVERED = /giao\s*(hàng\s*)?thành\s*công|đã\s*giao\s*(hàng|cho)|delivered/i;
const TIKTOK_NOT_DELIVERED = /không\s*thành\s*công|unsuccessful|failed|attempt/i;

/** TikTok tracking[] → mốc chuẩn hóa, mới nhất trước. */
export function normalizeTikTokTracking(events: TikTokTrackingEvent[] | undefined): TrackingEvent[] {
  return sortNewestFirst(
    (events ?? [])
      .map((e) => {
        const description = String(e.description ?? "").trim();
        let kind: TrackingEventKind = "normal";
        if (countTiktokFailedDeliveries([e]) > 0) kind = "failed";
        else if (TIKTOK_RETURN.test(description)) kind = "returning";
        else if (TIKTOK_DELIVERED.test(description) && !TIKTOK_NOT_DELIVERED.test(description)) kind = "delivered";
        const returned = kind === "returning" && TIKTOK_RETURNED.test(description);
        return {
          ...(returned ? { returned: true as const } : {}),
          at:
            typeof e.update_time_millis === "number" && e.update_time_millis > 0
              ? new Date(e.update_time_millis).toISOString()
              : null,
          description,
          kind,
        };
      })
      .filter((e) => e.description)
  );
}

function sortNewestFirst(events: TrackingEvent[]): TrackingEvent[] {
  // Mốc không có giờ giữ nguyên vị trí tương đối, xếp cuối.
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = a.e.at ? Date.parse(a.e.at) : -Infinity;
      const tb = b.e.at ? Date.parse(b.e.at) : -Infinity;
      return tb - ta || a.i - b.i;
    })
    .map((x) => x.e);
}

// ───────── Chặng HOÀN của kiện giao thất bại (Đối soát đơn hoàn, 13/11/2026) ─────────

export interface ReturnLegSummary {
  /** RETURNED = hãng báo đã trả kiện; RETURNING = đang trên đường về; NO_SIGNAL = hành trình chưa có mốc hoàn. */
  state: "RETURNED" | "RETURNING" | "NO_SIGNAL";
  /** Mốc hãng trả kiện về shop (chỉ khi RETURNED và hãng có ghi giờ). */
  at: string | null;
  /** Mốc mới nhất của hành trình, nguyên văn hãng — để người xem tự đọc. */
  latest: { at: string | null; description: string } | null;
}

/** Tóm tắt chặng hoàn từ hành trình đã chuẩn hóa (mới nhất trước). */
export function summarizeReturnLeg(events: TrackingEvent[]): ReturnLegSummary {
  const latest = events[0] ? { at: events[0].at, description: events[0].description } : null;
  const done = events.find((e) => e.returned);
  if (done) return { state: "RETURNED", at: done.at, latest };
  if (events.some((e) => e.kind === "returning")) return { state: "RETURNING", at: null, latest };
  return { state: "NO_SIGNAL", at: null, latest };
}

/** Đơn đã tới bước có hành trình để hỏi sàn chưa. */
export function hasLeftForCarrier(order: { shippingStatus: ShippingStatus; trackingCode: string | null }): boolean {
  if (order.shippingStatus === ShippingStatus.PENDING) return false;
  return !!order.trackingCode;
}

// ───────── Đệm RAM ─────────

const cache = new Map<string, { at: number; data: OrderTracking }>();

function cacheGet(orderId: string, now: number): OrderTracking | null {
  const hit = cache.get(orderId);
  if (!hit) return null;
  if (now - hit.at > TRACKING_CACHE_MS) {
    cache.delete(orderId);
    return null;
  }
  return hit.data;
}

function cachePut(orderId: string, data: OrderTracking, now: number): void {
  if (cache.size >= CACHE_MAX) {
    for (const [k, v] of cache) if (now - v.at > TRACKING_CACHE_MS) cache.delete(k);
    // Vẫn đầy (rất nhiều đơn được xem trong 10 phút) → bỏ mục cũ nhất theo thứ tự chèn.
    while (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(orderId, { at: now, data });
}

// ───────── Gọi sàn ─────────

/**
 * Dữ liệu mẫu cho máy dev (gian seed không có token thật): đặt ORDER_TRACKING_FAKE=1 khi
 * chạy backend local để soi giao diện. Không bao giờ bật ở production.
 */
function fakeEvents(now: number, orderCode: string): TrackingEvent[] {
  const h = 3_600_000;
  const at = (ago: number) => new Date(now - ago).toISOString();
  // Chia ba ca theo mã đơn để soi cột Trạng thái vận chuyển ở Đối soát đơn hoàn:
  // chưa có mốc hoàn / đang hoàn về / hãng đã trả kiện.
  const variant = [...orderCode].reduce((s, c) => s + c.charCodeAt(0), 0) % 3;
  const returning: TrackingEvent = {
    at: at(1 * h),
    description: "Đơn hàng đang được hoàn trả về người gửi do giao hàng không thành công",
    kind: "returning",
  };
  const returned: TrackingEvent = {
    at: at(0.5 * h),
    description: "Đã trả hàng thành công cho người gửi",
    kind: "returning",
    returned: true,
  };
  return [
    ...(variant === 2 ? [returned] : []),
    ...(variant >= 1 ? [returning] : []),
    { at: at(2 * h), description: "Giao hàng không thành công: không liên lạc được người nhận", kind: "failed" },
    { at: at(5 * h), description: "Đơn hàng đang được giao tới người nhận", kind: "normal" },
    { at: at(9 * h), description: "Đơn hàng đã đến bưu cục giao hàng 20-HNI Cau Giay Hub", kind: "normal" },
    { at: at(20 * h), description: "Đơn hàng đã rời kho phân loại BN Mega SOC", kind: "normal" },
    { at: at(26 * h), description: "Đơn hàng đã đến kho phân loại BN Mega SOC", kind: "normal" },
    { at: at(31 * h), description: "Đơn vị vận chuyển đã lấy hàng thành công", kind: "normal" },
    { at: at(40 * h), description: "Người gửi đang chuẩn bị hàng", kind: "normal" },
  ];
}

async function fetchFromPlatform(channel: Channel, orderCode: string): Promise<TrackingEvent[] | null> {
  if (channel.channelName === ChannelName.SHOPEE) {
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const info = await getTrackingInfo(accessToken, shopId, orderCode);
    return normalizeShopeeTracking(info.response?.tracking_info);
  }
  if (channel.channelName === ChannelName.TIKTOK) {
    const auth = await getValidTikTokAccessToken(channel);
    return normalizeTikTokTracking(await getOrderTracking({ ...auth, orderId: orderCode }));
  }
  return null; // Lazada / kênh khác: chưa hỗ trợ
}

export async function getOrderTrackingForOwner(params: {
  ownerId: string;
  /** Nhân viên bị giới hạn kênh; undefined = mọi kênh của chủ shop. */
  allowedChannelIds?: string[] | null;
  orderId: string;
  now?: number;
}): Promise<OrderTracking> {
  const now = params.now ?? Date.now();
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, channel: { userId: params.ownerId } },
    select: {
      id: true,
      orderCode: true,
      channelId: true,
      shippingStatus: true,
      trackingCode: true,
      shippingCarrierName: true,
      carrier: true,
      channel: true,
    },
  });
  if (!order) throw new OrderTrackingError(404, "Không tìm thấy đơn hàng");
  if (params.allowedChannelIds && !params.allowedChannelIds.includes(order.channelId)) {
    throw new OrderTrackingError(403, "Bạn không có quyền xem đơn của kênh này");
  }

  const base = {
    carrier: order.shippingCarrierName ?? order.carrier ?? null,
    trackingCode: order.trackingCode,
  };
  if (!hasLeftForCarrier(order)) {
    return { state: "not_shipped", ...base, events: [], fetchedAt: null };
  }

  const cached = cacheGet(order.id, now);
  if (cached) return cached;

  let events: TrackingEvent[] | null;
  if (process.env.ORDER_TRACKING_FAKE === "1" && process.env.NODE_ENV !== "production") {
    events = order.channel.channelName === ChannelName.LAZADA ? null : fakeEvents(now, order.orderCode);
  } else {
    const ch = order.channel;
    const connected =
      ch.channelName === ChannelName.SHOPEE
        ? !!(ch.apiToken && ch.refreshToken && ch.externalShopId)
        : ch.channelName === ChannelName.TIKTOK
          ? !!(ch.apiToken && ch.refreshToken && ch.shopCipher)
          : false;
    if (!connected) {
      return { state: "unsupported", ...base, events: [], fetchedAt: null };
    }
    try {
      events = await fetchFromPlatform(ch, order.orderCode);
    } catch (err) {
      console.warn(
        `[order-tracking] Đơn ${order.orderCode} (${ch.channelName}) không lấy được hành trình:`,
        err instanceof Error ? err.message : err
      );
      throw new OrderTrackingError(502, "Sàn chưa trả hành trình của đơn này, thử lại sau ít phút");
    }
  }

  const data: OrderTracking =
    events === null
      ? { state: "unsupported", ...base, events: [], fetchedAt: null }
      : { state: "ok", ...base, events, fetchedAt: new Date(now).toISOString() };
  if (data.state === "ok") cachePut(order.id, data, now);
  return data;
}

// ───────── Hỏi chặng hoàn cho MỘT LÔ đơn của trang Đối soát đơn hoàn ─────────

/** Trần số đơn mỗi lần hỏi — web cắt trang đang xem thành từng lô chừng này. */
export const RETURN_LEG_BATCH_MAX = 10;
/** Số lệnh gọi sàn chạy cùng lúc trong một lô. Mặc định tự chọn: đủ nhanh mà không dồn cả lô vào một gian. */
const RETURN_LEG_CONCURRENCY = 5;

export type ReturnLegResult =
  | ({ status: "ok"; fetchedAt: string | null } & ReturnLegSummary)
  /** Sàn / gian chưa lấy được hành trình (Lazada, gian chưa nối API). */
  | { status: "unsupported" }
  /** Sàn lỗi lượt này — web giữ "chưa có tin", lượt xem sau hỏi lại. */
  | { status: "error" };

/**
 * Chặng hoàn của các kiện GIAO THẤT BẠI quay đầu đang chờ về (13/11/2026, anh Trung:
 * "API mình có trong đơn hàng rồi chỉ cần gọi ra thôi") — đúng đường gọi của
 * GET /api/orders/:id/tracking, cùng đệm 10 phút.
 *
 * TIẾT CHẾ: chỉ hỏi đơn Chờ hàng về + sàn hủy sau khi bàn giao (đơn khách trả hàng đã
 * có mốc từ API hoàn; đơn kho đã nhận thì không còn gì để hỏi) — id khác bị bỏ qua,
 * không có trong kết quả. Mỗi đơn hỏi được = 1 call sàn, tối đa RETURN_LEG_BATCH_MAX / lần.
 */
export async function getReturnLegForOrders(params: {
  ownerId: string;
  allowedChannelIds?: string[] | null;
  orderIds: string[];
}): Promise<Record<string, ReturnLegResult>> {
  const eligible = await prisma.order.findMany({
    where: {
      id: { in: params.orderIds.slice(0, RETURN_LEG_BATCH_MAX) },
      channel: { userId: params.ownerId },
      ...(params.allowedChannelIds ? { channelId: { in: params.allowedChannelIds } } : {}),
      returnStatus: ReturnStatus.AWAITING,
      platformReturnStatus: CANCELLED_AFTER_SHIP,
    },
    select: { id: true },
  });

  const out: Record<string, ReturnLegResult> = {};
  const queue = eligible.map((o) => o.id);
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const t = await getOrderTrackingForOwner({
          ownerId: params.ownerId,
          allowedChannelIds: params.allowedChannelIds,
          orderId: id,
        });
        out[id] =
          t.state === "ok"
            ? { status: "ok", fetchedAt: t.fetchedAt, ...summarizeReturnLeg(t.events) }
            : { status: "unsupported" };
      } catch (err) {
        if (!(err instanceof OrderTrackingError)) throw err;
        out[id] = { status: "error" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(RETURN_LEG_CONCURRENCY, queue.length) }, worker));
  return out;
}
