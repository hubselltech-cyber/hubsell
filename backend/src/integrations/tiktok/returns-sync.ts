// ============================================================
// ĐỒNG BỘ ĐƠN HOÀN TIKTOK — RETURN & REFUND API (returns/search)
//
// Mirror luồng Lazada returns-sync (20/08, chốt anh Trung "không bịa giá"):
// đọc SỐ CỦA SÀN về yêu cầu hoàn — giải pháp (RETURN_AND_REFUND/REPLACEMENT =
// hàng về / REFUND = khách giữ hàng), tiền hoàn, trạng thái nguyên văn, số
// lượng SKU trả, mã vận đơn chiều hoàn — ghi vào cùng bộ cột Order mà
// computePnlRow đọc. Nhờ đó Lãi/Lỗ TikTok không phải tạm tính hoàn.
//
// Enum return_status theo docs 202309 (đối chiếu lại bằng log hình dạng khi
// shop and.not.or có yêu cầu hoàn thật): nhận diện CHẾT qua REJECT/CANCEL,
// XONG qua SUCCESS/COMPLETE. Với yêu cầu TRẢ HÀNG, sàn chỉ chuyển SUCCESS/
// COMPLETE sau khi kiện đã về seller (đối chiếu thật 16/09: yêu cầu
// RETURN_AND_REFUND ở RETURN_OR_REFUND_REQUEST_COMPLETE) → ghi returnDeliveredAt
// = update_time để P&L thu hồi giá vốn như Shopee LOGISTICS_DELIVERY_DONE.
//
// KHÁCH GIỮ HÀNG (02/10/2026, anh Trung: "khách được giữ hàng thì coi như mất cả
// giá vốn"): docs 202309 có cờ can_buyer_keep_item — sàn cho khách giữ hàng dù
// yêu cầu là trả hàng / đổi hàng. Cờ bật → coi như CHỈ HOÀN TIỀN: không cắm
// AWAITING, không ghi mốc kiện về, Lãi/Lỗ tính mất nguyên giá vốn. Dữ liệu thật
// 02/10/2026 (khoảng 360 đơn hoàn của 3 gian) CHƯA đơn nào mang cờ này và mẫu
// log hình dạng không có trường đó → nhánh này mới chỉ được kiểm bằng test.
//
// QUÉT BÙ THEO MÃ ĐƠN (02/10/2026, cơ chế chung ở ../return-lookup.ts): yêu
// cầu hoàn đã xong TRƯỚC ngày nối gian không bao giờ lọt vào lượt quét 2 / 7
// ngày → đơn có tiền hoàn trên bản kê bị coi là khách giữ hàng (đơn
// 585860564513293743 gian Giày Dép Đức Khải: lỗ 144.620 thay vì 4.620).
// backfillTiktokReturnsByOrder hỏi returns/search theo order_ids cho các đơn đó.
//
// An toàn dữ liệu: trục returnStatus CHỈ đổi NONE ↔ AWAITING; đơn kho đã xử
// lý (RECEIVED trở đi) tuyệt đối không đụng. Hủy đơn (cancellations) nằm trên
// trục shippingStatus qua đồng bộ đơn, không phải trục hoàn.
// ============================================================

import type { Channel, Prisma } from "@prisma/client";
import { ReturnSolution, ReturnStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { notify } from "../../services/notifications";
import {
  maybeAutoAdjustOnPlatformReturn,
  PLATFORM_RETURN_DONE_STATUSES,
} from "../invoice/adjust-order";
import { findOrdersPendingReturnLookup, markReturnLookupDone } from "../return-lookup";
import { searchReturns, type TikTokReturnOrder } from "./client";
import { getValidAccessToken } from "./service";

/** Trần trang mỗi lượt (50 yêu cầu/trang). */
const MAX_PAGES = 40;

/** Yêu cầu đã CHẾT — bị từ chối/hủy, không còn gì quay về. */
export function isDeadTiktokReturn(ro: Pick<TikTokReturnOrder, "return_status">): boolean {
  const s = (ro.return_status ?? "").toUpperCase();
  return s.includes("REJECT") || s.includes("CANCEL");
}

/** Yêu cầu trả hàng / đổi hàng mà sàn cho khách GIỮ HÀNG (can_buyer_keep_item). */
export function isTiktokBuyerKeepsItem(
  ro: Pick<TikTokReturnOrder, "return_type" | "can_buyer_keep_item">
): boolean {
  const t = (ro.return_type ?? "").toUpperCase();
  return ro.can_buyer_keep_item === true && (t.includes("RETURN") || t.includes("REPLACEMENT"));
}

/**
 * Giải pháp hoàn từ return_type: RETURN_AND_REFUND / REPLACEMENT → hàng về
 * (kho cần đón kiện; đổi hàng cũng là kiện quay lại); REFUND → khách giữ hàng.
 * Sàn bật can_buyer_keep_item → khách giữ hàng dù loại yêu cầu là trả / đổi.
 */
export function tiktokReturnSolutionOf(
  ro: Pick<TikTokReturnOrder, "return_type" | "can_buyer_keep_item">
): ReturnSolution | null {
  const t = (ro.return_type ?? "").toUpperCase();
  if (!t) return null;
  if (isTiktokBuyerKeepsItem(ro)) return ReturnSolution.REFUND_ONLY;
  if (t.includes("RETURN") || t.includes("REPLACEMENT")) return ReturnSolution.RETURN_REFUND;
  if (t.includes("REFUND")) return ReturnSolution.REFUND_ONLY;
  return null;
}

/** Tiền hoàn sàn báo của một yêu cầu (refund_total; thiếu thì cộng từng dòng). */
export function tiktokRefundOf(ro: TikTokReturnOrder): number {
  const total = Number(ro.refund_amount?.refund_total ?? 0) || 0;
  if (total > 0) return total;
  return (ro.return_line_items ?? []).reduce(
    (s, li) => s + (Number(li.refund_amount?.refund_total ?? 0) || 0),
    0
  );
}

/** Trạng thái sàn = kiện trả đã về tay seller (chỉ áp cho giải pháp TRẢ HÀNG). */
export function isTiktokReturnDelivered(status?: string | null): boolean {
  const s = (status ?? "").toUpperCase();
  return s.endsWith("_SUCCESS") || s.endsWith("_COMPLETE");
}

/** Trạng thái hoàn hiện tại của đơn — phần planner cần nhìn (mirror Lazada). */
export interface TiktokReturnFlagState {
  returnStatus: ReturnStatus;
  returnRequestedAt: Date | null;
  returnTrackingCode: string | null;
  returnSolution?: ReturnSolution | null;
  platformRefundAmount?: number;
  platformReturnStatus?: string | null;
  returnDeliveredAt?: Date | null;
}

export interface TiktokReturnUpdatePlan {
  data: {
    returnStatus?: ReturnStatus;
    returnRequestedAt?: Date | null;
    returnTrackingCode?: string | null;
    returnSolution?: ReturnSolution | null;
    platformRefundAmount?: number;
    platformReturnStatus?: string | null;
    returnDeliveredAt?: Date | null;
  };
  flagged: boolean;
  unflagged: boolean;
  trackingSaved: boolean;
  /** Vừa ghi mốc kiện hoàn về tay theo sàn. */
  delivered: boolean;
  /** Có yêu cầu trả / đổi hàng còn sống mà sàn cho khách giữ hàng. */
  keptByBuyer: boolean;
  /** Số lượng trả theo seller_sku (mỗi return_line_item = 1 đơn vị) — null =
   *  không có dữ liệu; map RỖNG khi chỉ hoàn tiền. */
  itemReturns: Map<string, number> | null;
}

export interface PlanTiktokReturnOptions {
  /**
   * Lượt QUÉT BÙ lịch sử: yêu cầu trả hàng đã xong từ trước khi Hubsell đọc
   * được → vẫn ghi giải pháp / tiền hoàn / mốc kiện về, nhưng KHÔNG cắm
   * AWAITING (kho không còn kiện nào để quét, cắm vào là sinh cảnh báo "quá hạn
   * chưa về tay" oan cho đơn đã xong cả tháng).
   */
  historical?: boolean;
}

const toMs = (sec: number | undefined) => (sec && sec > 0 ? sec * 1000 : 0);

/**
 * QUYẾT ĐỊNH thuần (không API, không DB) cho MỘT đơn từ các yêu cầu hoàn của
 * nó. Export để vitest kiểm bằng payload chuẩn.
 */
export function planTiktokReturnUpdate(
  group: TikTokReturnOrder[],
  order: TiktokReturnFlagState,
  nowMs: number,
  opts: PlanTiktokReturnOptions = {}
): TiktokReturnUpdatePlan {
  const plan: TiktokReturnUpdatePlan = {
    data: {},
    flagged: false,
    unflagged: false,
    trackingSaved: false,
    delivered: false,
    keptByBuyer: false,
    itemReturns: null,
  };

  const relevant = group.filter((ro) => tiktokReturnSolutionOf(ro) !== null);
  const alive = relevant.filter((ro) => !isDeadTiktokReturn(ro));
  const newestOf = (list: TikTokReturnOrder[]) =>
    [...list].sort((a, b) => toMs(b.update_time) - toMs(a.update_time))[0];

  if (alive.length === 0) {
    if (order.returnStatus === ReturnStatus.AWAITING) {
      plan.data.returnStatus = ReturnStatus.NONE;
      plan.data.returnRequestedAt = null;
      plan.data.returnTrackingCode = null;
      plan.unflagged = true;
    }
    if (order.returnSolution != null) plan.data.returnSolution = null;
    if ((order.platformRefundAmount ?? 0) !== 0) plan.data.platformRefundAmount = 0;
    if (relevant.length > 0) {
      const st = (newestOf(relevant)?.return_status ?? "").toUpperCase() || null;
      if (st !== (order.platformReturnStatus ?? null)) plan.data.platformReturnStatus = st;
    }
    return plan;
  }

  // Có bất kỳ yêu cầu TRẢ HÀNG còn sống → hàng sẽ về; chỉ toàn REFUND → khách giữ.
  const hasReturn = alive.some((ro) => tiktokReturnSolutionOf(ro) === ReturnSolution.RETURN_REFUND);
  const solution = hasReturn ? ReturnSolution.RETURN_REFUND : ReturnSolution.REFUND_ONLY;
  const refundOnly = solution === ReturnSolution.REFUND_ONLY;
  plan.keptByBuyer = alive.some((ro) => isTiktokBuyerKeepsItem(ro));

  const refund = alive.reduce((s, ro) => s + tiktokRefundOf(ro), 0);
  const newest = newestOf(alive);
  const status = (newest.return_status ?? "").toUpperCase() || null;
  const tracking =
    [...alive]
      .sort((a, b) => toMs(b.update_time) - toMs(a.update_time))
      .map((ro) => ro.return_tracking_number?.trim())
      .find(Boolean) ?? null;
  const requestedMs = Math.min(...alive.map((ro) => toMs(ro.create_time) || nowMs));

  const finishedBeforeSeen = opts.historical === true && isTiktokReturnDelivered(status);
  if (order.returnStatus === ReturnStatus.NONE && !refundOnly && !finishedBeforeSeen) {
    plan.data.returnStatus = ReturnStatus.AWAITING;
    plan.data.returnRequestedAt = new Date(requestedMs || nowMs);
    plan.flagged = true;
  } else if (order.returnStatus === ReturnStatus.AWAITING && refundOnly) {
    plan.data.returnStatus = ReturnStatus.NONE;
    plan.data.returnRequestedAt = null;
    plan.data.returnTrackingCode = null;
    plan.unflagged = true;
  } else if (order.returnStatus === ReturnStatus.AWAITING && !order.returnRequestedAt && requestedMs) {
    plan.data.returnRequestedAt = new Date(requestedMs);
  }
  if (!refundOnly && tracking && tracking !== order.returnTrackingCode) {
    plan.data.returnTrackingCode = tracking;
    plan.trackingSaved = true;
  }

  if (solution !== (order.returnSolution ?? null)) plan.data.returnSolution = solution;
  if (refund !== (order.platformRefundAmount ?? 0)) plan.data.platformRefundAmount = refund;
  if (status !== (order.platformReturnStatus ?? null)) plan.data.platformReturnStatus = status;

  // Kiện trả đã về tay theo sàn (SUCCESS/COMPLETE của yêu cầu TRẢ HÀNG) — ghi
  // MỘT lần; kho quét nhận sau vẫn là mốc vật lý riêng (returnStatus).
  if (!refundOnly && !order.returnDeliveredAt && isTiktokReturnDelivered(status)) {
    plan.data.returnDeliveredAt = new Date(toMs(newest.update_time) || nowMs);
    plan.delivered = true;
  }
  // Khách giữ hàng mà trước đây đã lỡ ghi mốc kiện về (bản chưa đọc cờ
  // can_buyer_keep_item) → gỡ mốc, kẻo Lãi/Lỗ thu hồi giá vốn của hàng không về.
  // Kho đã quét nhận (RECEIVED trở đi) thì Lãi/Lỗ tin kho, không phụ thuộc mốc này.
  if (refundOnly && order.returnDeliveredAt) {
    plan.data.returnDeliveredAt = null;
  }

  const map = new Map<string, number>();
  if (!refundOnly) {
    for (const ro of alive) {
      if (tiktokReturnSolutionOf(ro) !== ReturnSolution.RETURN_REFUND) continue;
      for (const li of ro.return_line_items ?? []) {
        const sku = li.seller_sku?.trim() || li.sku_id?.trim() || "";
        if (!sku) continue;
        map.set(sku, (map.get(sku) ?? 0) + 1);
      }
    }
  }
  plan.itemReturns = map;
  return plan;
}

export interface SyncTiktokReturnsResult {
  scanned: number;
  flagged: number;
  unflagged: number;
  trackingSaved: number;
  /** Số đơn vừa ghi mốc kiện hoàn về tay theo sàn. */
  delivered: number;
  itemsUpdated: number;
  ordersNotFound: number;
  /** Số đơn có yêu cầu trả / đổi hàng mà sàn cho khách giữ hàng. */
  keptByBuyer: number;
}

export interface SyncTiktokReturnsOptions {
  /** Quét yêu cầu hoàn BIẾN ĐỘNG trong N ngày gần nhất. Mặc định 7. */
  daysBack?: number;
}

let shapeLogged = false;

/** Đọc đơn theo lô mã đơn — một câu cho cả lô, không hỏi database từng đơn. */
const ORDER_LOAD_CHUNK = 100;

const RETURN_ORDER_SELECT = {
  id: true,
  orderCode: true,
  returnStatus: true,
  returnRequestedAt: true,
  returnTrackingCode: true,
  returnSolution: true,
  platformRefundAmount: true,
  platformReturnStatus: true,
  returnDeliveredAt: true,
  returnLookupAt: true,
  items: { select: { id: true, channelSku: true, returnedQuantity: true } },
} satisfies Prisma.OrderSelect;

/** Gom yêu cầu hoàn theo mã đơn. */
function groupReturnsByOrder(returns: Iterable<TikTokReturnOrder>): Map<string, TikTokReturnOrder[]> {
  const byOrder = new Map<string, TikTokReturnOrder[]>();
  for (const ro of returns) {
    const code = String(ro.order_id ?? "").trim();
    if (!code) continue;
    const list = byOrder.get(code);
    if (list) list.push(ro);
    else byOrder.set(code, [ro]);
  }
  return byOrder;
}

function emptyReturnsResult(): SyncTiktokReturnsResult {
  return {
    scanned: 0,
    flagged: 0,
    unflagged: 0,
    trackingSaved: 0,
    delivered: 0,
    itemsUpdated: 0,
    ordersNotFound: 0,
    keptByBuyer: 0,
  };
}

/**
 * Phản ánh các nhóm yêu cầu hoàn (đã gom theo mã đơn) vào Order — phần GHI dùng
 * chung cho lượt quét theo thời gian và lượt quét bù theo mã đơn. Đơn nào đi qua
 * đây cũng được đóng mốc returnLookupAt (đã đọc yêu cầu hoàn của sàn một lần).
 */
async function applyTiktokReturnGroups(
  channel: Channel,
  byOrder: Map<string, TikTokReturnOrder[]>,
  result: SyncTiktokReturnsResult,
  opts: PlanTiktokReturnOptions = {}
): Promise<void> {
  const nowMs = Date.now();
  const codes = [...byOrder.keys()];
  for (let i = 0; i < codes.length; i += ORDER_LOAD_CHUNK) {
    const chunk = codes.slice(i, i + ORDER_LOAD_CHUNK);
    const orders = await prisma.order.findMany({
      where: { channelId: channel.id, orderCode: { in: chunk } },
      select: RETURN_ORDER_SELECT,
    });
    result.ordersNotFound += chunk.length - orders.length;

    for (const order of orders) {
      const group = byOrder.get(order.orderCode) ?? [];
      const plan = planTiktokReturnUpdate(
        group,
        {
          returnStatus: order.returnStatus,
          returnRequestedAt: order.returnRequestedAt,
          returnTrackingCode: order.returnTrackingCode,
          returnSolution: order.returnSolution,
          platformRefundAmount: Number(order.platformRefundAmount),
          platformReturnStatus: order.platformReturnStatus,
          returnDeliveredAt: order.returnDeliveredAt,
        },
        nowMs,
        opts
      );
      if (plan.flagged) result.flagged++;
      if (plan.unflagged) result.unflagged++;
      if (plan.trackingSaved) result.trackingSaved++;
      if (plan.delivered) result.delivered++;
      if (plan.keptByBuyer) result.keptByBuyer++;

      const data: Prisma.OrderUpdateInput = { ...plan.data };
      if (!order.returnLookupAt) data.returnLookupAt = new Date(nowMs);
      if (Object.keys(data).length > 0) {
        await prisma.order.update({ where: { id: order.id }, data });
      }

      if (plan.itemReturns) {
        for (const it of order.items) {
          const qty = plan.itemReturns.get(it.channelSku) ?? 0;
          if (qty !== it.returnedQuantity) {
            await prisma.orderItem.update({ where: { id: it.id }, data: { returnedQuantity: qty } });
            result.itemsUpdated++;
          }
        }
      }

      // Tự động lập hóa đơn điều chỉnh khi sàn CHỐT hoàn (cùng khuôn Shopee/Lazada).
      {
        const prevStatus = order.platformReturnStatus ?? "";
        const nextStatus =
          (plan.data.platformReturnStatus !== undefined
            ? plan.data.platformReturnStatus
            : prevStatus) ?? "";
        if (
          PLATFORM_RETURN_DONE_STATUSES.has(nextStatus) &&
          !PLATFORM_RETURN_DONE_STATUSES.has(prevStatus)
        ) {
          maybeAutoAdjustOnPlatformReturn(channel.userId, order.id);
        }
      }

      if (plan.flagged) {
        await notify(channel.userId, {
          type: "return",
          title: `TikTok báo hoàn đơn ${order.orderCode}`,
          body: `Gian ${channel.shopName} — đơn chuyển sang "Chờ nhận hàng hoàn". Kho quét mã khi kiện về tay.`,
          link: "/warehouse/returns",
        });
      }
    }
  }
}

/**
 * Quét Return & Refund API rồi phản ánh số của sàn vào Order. Idempotent —
 * chạy lặp bao nhiêu lần cũng ra cùng trạng thái.
 */
export async function syncTiktokReturns(
  channel: Channel,
  opts: SyncTiktokReturnsOptions = {}
): Promise<SyncTiktokReturnsResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const nowSec = Math.floor(Date.now() / 1000);
  const daysBack = opts.daysBack ?? 7;

  const result = emptyReturnsResult();

  const byId = new Map<string, TikTokReturnOrder>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await searchReturns({
      accessToken,
      shopCipher,
      updateTimeGe: nowSec - daysBack * 24 * 60 * 60,
      updateTimeLt: nowSec,
      pageSize: 50,
      pageToken,
    });
    pages++;
    for (const ro of page.return_orders) {
      if (!shapeLogged && process.env.TIKTOK_SHAPE_LOG !== "0") {
        shapeLogged = true;
        const li = ro.return_line_items?.[0];
        console.log(
          `[TikTok] Hình dạng yêu cầu hoàn (returns/search): keys=[${Object.keys(ro).join(",")}] refund_amount=[${Object.keys(ro.refund_amount ?? {}).join(",")}] line_item=[${Object.keys(li ?? {}).join(",")}] return_type=${JSON.stringify(ro.return_type)} return_status=${JSON.stringify(ro.return_status)}`
        );
      }
      byId.set(String(ro.return_id), ro);
    }
    pageToken = page.next_page_token || undefined;
  } while (pageToken && pages < MAX_PAGES);
  result.scanned = byId.size;
  if (byId.size === 0) return result;

  await applyTiktokReturnGroups(channel, groupReturnsByOrder(byId.values()), result);
  return result;
}

// ============================================================
// QUÉT BÙ THEO MÃ ĐƠN — đơn có tiền hoàn mà chưa từng đọc yêu cầu hoàn
// ============================================================

/**
 * Số đơn hỏi sàn mỗi lượt gọi. Docs returns/search 202309 KHÔNG ghi trần độ dài
 * order_ids → 20 là mức tự chọn, sàn nhận được trên prod 02/10/2026 (3 gian,
 * 360 đơn); chỉnh bằng env TIKTOK_RETURN_LOOKUP_BATCH. Kết quả vẫn đọc hết
 * trang nên đúng với mọi cỡ lô.
 */
const LOOKUP_BATCH_DEFAULT = 20;
/**
 * Mỗi lượt xử lý tối đa N đơn của một gian (mức tự chọn: 200 đơn = 10 lượt gọi
 * sàn), phần còn lại để lượt giờ sau — gian mới nối có vài trăm đơn hoàn cũ cũng
 * xong trong vài giờ mà không dồn một lúc.
 */
const LOOKUP_ORDERS_PER_SWEEP = 200;
/** Nghỉ giữa hai lượt gọi sàn (ms) — việc nền phải có nhịp nghỉ. */
const LOOKUP_PAUSE_MS = 300;

export interface BackfillTiktokReturnsResult extends SyncTiktokReturnsResult {
  /** Đơn cần hỏi tìm thấy ở lượt này (tối đa LOOKUP_ORDERS_PER_SWEEP). */
  candidates: number;
  /** Đơn đã hỏi sàn xong và đóng mốc returnLookupAt. */
  looked: number;
  /** Trong số đã hỏi, đơn mà sàn có ít nhất một yêu cầu hoàn. */
  withReturns: number;
  /** Chạm trần số đơn mỗi lượt — còn đơn chờ lượt sau. */
  more: boolean;
}

function lookupBatchSize(): number {
  const v = Math.trunc(Number(process.env.TIKTOK_RETURN_LOOKUP_BATCH));
  return Number.isFinite(v) && v > 0 ? v : LOOKUP_BATCH_DEFAULT;
}

/**
 * Hỏi sàn THEO MÃ ĐƠN cho các đơn có tiền hoàn trên bản kê mà chưa từng đọc yêu
 * cầu hoàn (findOrdersPendingReturnLookup) rồi ghi vào đơn bằng đúng bộ quyết
 * định của lượt quét thường. Lô nào sàn lỗi thì không đóng mốc, lượt sau hỏi lại.
 */
export async function backfillTiktokReturnsByOrder(
  channel: Channel
): Promise<BackfillTiktokReturnsResult> {
  const result: BackfillTiktokReturnsResult = {
    ...emptyReturnsResult(),
    candidates: 0,
    looked: 0,
    withReturns: 0,
    more: false,
  };

  const rows = await findOrdersPendingReturnLookup(channel.id, LOOKUP_ORDERS_PER_SWEEP + 1);
  result.more = rows.length > LOOKUP_ORDERS_PER_SWEEP;
  const candidates = rows.slice(0, LOOKUP_ORDERS_PER_SWEEP);
  result.candidates = candidates.length;
  if (candidates.length === 0) return result;

  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const batchSize = lookupBatchSize();

  for (let i = 0; i < candidates.length; i += batchSize) {
    if (i > 0) await new Promise((r) => setTimeout(r, LOOKUP_PAUSE_MS));
    const batch = candidates.slice(i, i + batchSize);

    const wanted = new Set(batch.map((o) => o.orderCode));
    const byId = new Map<string, TikTokReturnOrder>();
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const page = await searchReturns({
        accessToken,
        shopCipher,
        orderIds: [...wanted],
        pageSize: 50,
        pageToken,
      });
      pages++;
      for (const ro of page.return_orders) {
        // Sàn trả yêu cầu của đơn mình KHÔNG hỏi = bộ lọc order_ids không có tác
        // dụng → dừng cả lượt (không ghi, không đóng mốc) thay vì lật hết trang
        // yêu cầu hoàn của shop cho từng lô.
        if (!wanted.has(String(ro.order_id ?? "").trim())) {
          throw new Error(
            `returns/search trả yêu cầu hoàn của đơn ${ro.order_id ?? "?"} không nằm trong order_ids đã hỏi`
          );
        }
        byId.set(String(ro.return_id), ro);
      }
      pageToken = page.next_page_token || undefined;
    } while (pageToken && pages < MAX_PAGES);
    if (pageToken) {
      // Chưa đọc hết yêu cầu hoàn của lô → không ghi nửa chừng, không đóng mốc.
      console.warn(
        `[TikTok] Quét bù đơn hoàn "${channel.shopName}": lô ${batch.length} đơn vượt ${MAX_PAGES} trang yêu cầu hoàn, bỏ qua lượt này`
      );
      continue;
    }

    const byOrder = groupReturnsByOrder(byId.values());
    result.scanned += byId.size;
    result.withReturns += byOrder.size;
    await applyTiktokReturnGroups(channel, byOrder, result, { historical: true });

    // Đóng mốc cả lô: đơn sàn không có yêu cầu hoàn nào cũng không hỏi lại.
    await markReturnLookupDone(batch.map((o) => o.id));
    result.looked += batch.length;
  }

  return result;
}
