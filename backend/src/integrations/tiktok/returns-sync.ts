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
// XONG qua SUCCESS/COMPLETE. Không có trường "kiện đã về tay seller" đáng tin
// → KHÔNG ghi returnDeliveredAt — giá vốn chỉ thu hồi khi kho quét nhận.
//
// An toàn dữ liệu: trục returnStatus CHỈ đổi NONE ↔ AWAITING; đơn kho đã xử
// lý (RECEIVED trở đi) tuyệt đối không đụng. Hủy đơn (cancellations) nằm trên
// trục shippingStatus qua đồng bộ đơn, không phải trục hoàn.
// ============================================================

import type { Channel } from "@prisma/client";
import { ReturnSolution, ReturnStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { notify } from "../../services/notifications";
import {
  maybeAutoAdjustOnPlatformReturn,
  PLATFORM_RETURN_DONE_STATUSES,
} from "../invoice/adjust-order";
import { searchReturns, type TikTokReturnOrder } from "./client";
import { getValidAccessToken } from "./service";

/** Trần trang mỗi lượt (50 yêu cầu/trang). */
const MAX_PAGES = 40;

/** Yêu cầu đã CHẾT — bị từ chối/hủy, không còn gì quay về. */
export function isDeadTiktokReturn(ro: Pick<TikTokReturnOrder, "return_status">): boolean {
  const s = (ro.return_status ?? "").toUpperCase();
  return s.includes("REJECT") || s.includes("CANCEL");
}

/**
 * Giải pháp hoàn từ return_type: RETURN_AND_REFUND / REPLACEMENT → hàng về
 * (kho cần đón kiện; đổi hàng cũng là kiện quay lại); REFUND → khách giữ hàng.
 */
export function tiktokReturnSolutionOf(ro: Pick<TikTokReturnOrder, "return_type">): ReturnSolution | null {
  const t = (ro.return_type ?? "").toUpperCase();
  if (!t) return null;
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

/** Trạng thái hoàn hiện tại của đơn — phần planner cần nhìn (mirror Lazada). */
export interface TiktokReturnFlagState {
  returnStatus: ReturnStatus;
  returnRequestedAt: Date | null;
  returnTrackingCode: string | null;
  returnSolution?: ReturnSolution | null;
  platformRefundAmount?: number;
  platformReturnStatus?: string | null;
}

export interface TiktokReturnUpdatePlan {
  data: {
    returnStatus?: ReturnStatus;
    returnRequestedAt?: Date | null;
    returnTrackingCode?: string | null;
    returnSolution?: ReturnSolution | null;
    platformRefundAmount?: number;
    platformReturnStatus?: string | null;
  };
  flagged: boolean;
  unflagged: boolean;
  trackingSaved: boolean;
  /** Số lượng trả theo seller_sku (mỗi return_line_item = 1 đơn vị) — null =
   *  không có dữ liệu; map RỖNG khi chỉ hoàn tiền. */
  itemReturns: Map<string, number> | null;
}

const toMs = (sec: number | undefined) => (sec && sec > 0 ? sec * 1000 : 0);

/**
 * QUYẾT ĐỊNH thuần (không API, không DB) cho MỘT đơn từ các yêu cầu hoàn của
 * nó. Export để vitest kiểm bằng payload chuẩn.
 */
export function planTiktokReturnUpdate(
  group: TikTokReturnOrder[],
  order: TiktokReturnFlagState,
  nowMs: number
): TiktokReturnUpdatePlan {
  const plan: TiktokReturnUpdatePlan = {
    data: {},
    flagged: false,
    unflagged: false,
    trackingSaved: false,
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

  const refund = alive.reduce((s, ro) => s + tiktokRefundOf(ro), 0);
  const newest = newestOf(alive);
  const status = (newest.return_status ?? "").toUpperCase() || null;
  const tracking =
    [...alive]
      .sort((a, b) => toMs(b.update_time) - toMs(a.update_time))
      .map((ro) => ro.return_tracking_number?.trim())
      .find(Boolean) ?? null;
  const requestedMs = Math.min(...alive.map((ro) => toMs(ro.create_time) || nowMs));

  if (order.returnStatus === ReturnStatus.NONE && !refundOnly) {
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
  itemsUpdated: number;
  ordersNotFound: number;
}

export interface SyncTiktokReturnsOptions {
  /** Quét yêu cầu hoàn BIẾN ĐỘNG trong N ngày gần nhất. Mặc định 7. */
  daysBack?: number;
}

let shapeLogged = false;

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

  const result: SyncTiktokReturnsResult = {
    scanned: 0,
    flagged: 0,
    unflagged: 0,
    trackingSaved: 0,
    itemsUpdated: 0,
    ordersNotFound: 0,
  };

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

  const byOrder = new Map<string, TikTokReturnOrder[]>();
  for (const ro of byId.values()) {
    const code = String(ro.order_id ?? "").trim();
    if (!code) continue;
    const list = byOrder.get(code);
    if (list) list.push(ro);
    else byOrder.set(code, [ro]);
  }

  const nowMs = Date.now();
  for (const [orderCode, group] of byOrder) {
    const order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode } },
      select: {
        id: true,
        returnStatus: true,
        returnRequestedAt: true,
        returnTrackingCode: true,
        returnSolution: true,
        platformRefundAmount: true,
        platformReturnStatus: true,
        items: { select: { id: true, channelSku: true, returnedQuantity: true } },
      },
    });
    if (!order) {
      result.ordersNotFound++;
      continue;
    }

    const plan = planTiktokReturnUpdate(
      group,
      {
        returnStatus: order.returnStatus,
        returnRequestedAt: order.returnRequestedAt,
        returnTrackingCode: order.returnTrackingCode,
        returnSolution: order.returnSolution,
        platformRefundAmount: Number(order.platformRefundAmount),
        platformReturnStatus: order.platformReturnStatus,
      },
      nowMs
    );
    if (plan.flagged) result.flagged++;
    if (plan.unflagged) result.unflagged++;
    if (plan.trackingSaved) result.trackingSaved++;

    if (Object.keys(plan.data).length > 0) {
      await prisma.order.update({ where: { id: order.id }, data: plan.data });
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
        title: `TikTok báo hoàn đơn ${orderCode}`,
        body: `Gian ${channel.shopName} — đơn chuyển sang "Chờ nhận hàng hoàn". Kho quét mã khi kiện về tay.`,
        link: "/warehouse/returns",
      });
    }
  }

  return result;
}
