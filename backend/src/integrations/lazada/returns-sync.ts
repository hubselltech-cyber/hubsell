// ============================================================
// ĐỒNG BỘ ĐƠN HOÀN LAZADA — REVERSE ORDER API (getreverseordersforseller)
//
// Mirror luồng Shopee returns-sync (20/08, chốt anh Trung "không bịa giá"):
// đọc SỐ CỦA SÀN về yêu cầu hoàn — giải pháp (RETURN = hàng về / ONLY_REFUND =
// khách giữ hàng), tiền hoàn từng dòng, trạng thái nguyên văn, số lượng SKU
// trả, mã vận đơn chiều hoàn — ghi vào cùng bộ cột Order mà computePnlRow đọc.
// Nhờ đó Lãi/Lỗ Lazada BỎ được tạm tính "hoàn full doanh thu".
//
// Khác Shopee: docs Lazada KHÔNG liệt kê đủ enum reverse_status/ofc_status →
// chỉ nhận diện yêu cầu CHẾT qua CANCEL/REJECT/CLOSED trong chuỗi; không có
// trường "kiện đã về tay seller" đáng tin nên KHÔNG ghi returnDeliveredAt —
// giá vốn chỉ thu hồi khi kho quét nhận (đúng nguyên tắc không đoán).
//
// An toàn dữ liệu: trục returnStatus CHỈ đổi NONE ↔ AWAITING; đơn kho đã xử
// lý (RECEIVED trở đi) tuyệt đối không đụng. request_type CANCEL bỏ qua hẳn —
// hủy đơn nằm trên trục shippingStatus, không phải trục hoàn.
// ============================================================

import type { Channel, Prisma } from "@prisma/client";
import { ReturnSolution, ReturnStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { notify } from "../../services/notifications";
import { PLATFORM_RETURN_DONE_STATUSES } from "../invoice/adjust-order";
import { autoAdjustOnPlatformReturn } from "../../services/invoice-requests";
import {
  getReverseOrders,
  lazadaChannelSku,
  type LazadaReverseOrder,
  type LazadaReverseOrderLine,
} from "./client";
import { getValidLazadaAccessToken } from "./service";
import type { SyncCompleteness } from "../sync-contract";
import { CLEAR_CANCEL_REQUEST, notifyCancelRequest } from "../cancel-request";

/** Trần trang mỗi lát thời gian (50 yêu cầu/trang). */
const MAX_PAGES_PER_SLICE = 40;
/** Lát thời gian 15 ngày — an toàn theo giới hạn khoảng lọc quen thuộc của sàn. */
const SLICE_MS = 15 * 24 * 60 * 60 * 1000;

/** Dòng hoàn đã CHẾT — yêu cầu bị hủy/từ chối/đóng, không còn gì quay về. */
export function isDeadLazadaReturn(line: LazadaReverseOrderLine): boolean {
  const s = `${line.reverse_status ?? ""} ${line.ofc_status ?? ""}`.toUpperCase();
  return s.includes("CANCEL") || s.includes("REJECT") || s.includes("CLOSED");
}

/** true khi giá trị chuỗi/bool của Lazada mang nghĩa true ("true"/true). */
function truthy(v: string | boolean | undefined): boolean {
  return v === true || String(v).toLowerCase() === "true";
}

/**
 * Giải pháp hoàn từ request_type của MỘT yêu cầu: RETURN → hàng về;
 * REFUND (ONLY_REFUND...) → khách giữ hàng; CANCEL/khác → null (không phải
 * trục hoàn / không đoán).
 */
export function lazadaReturnSolutionOf(ro: LazadaReverseOrder): ReturnSolution | null {
  const t = (ro.request_type ?? "").toUpperCase();
  if (t.includes("CANCEL")) return null;
  if (t.includes("RETURN")) return ReturnSolution.RETURN_REFUND;
  if (t.includes("REFUND")) return ReturnSolution.REFUND_ONLY;
  return null;
}

/** Yêu cầu HỦY ĐƠN của người mua (request_type CANCEL) — trục cờ riêng, không phải trục hoàn. */
export function isLazadaCancelRequest(ro: LazadaReverseOrder): boolean {
  return (ro.request_type ?? "").toUpperCase().includes("CANCEL");
}

export interface LazadaCancelFlagState {
  cancelRequestedAt: Date | null;
  cancelRequestRef: string | null;
}

export interface LazadaCancelPlan {
  data: Prisma.OrderUpdateInput;
  flagged: boolean;
  unflagged: boolean;
  reason: string | null;
}

/**
 * QUYẾT ĐỊNH thuần cờ "khách xin hủy" cho MỘT đơn từ các reverse order của nó
 * (23/10/2026): có yêu cầu CANCEL còn dòng SỐNG (chưa CANCEL/REJECT/CLOSED)
 * → bật cờ với reverse_order_id (thứ /order/reverse/cancel/seller/decide cần);
 * không còn → hạ cờ. Lazada không nêu hạn trả lời → cancelRequestDueAt null.
 * Null = không có gì để ghi (idempotent).
 */
export function planLazadaCancelRequest(
  group: LazadaReverseOrder[],
  order: LazadaCancelFlagState,
  nowMs: number
): LazadaCancelPlan | null {
  const alive = group
    .filter(isLazadaCancelRequest)
    .map((ro) => ({
      ro,
      lines: (ro.reverse_order_lines ?? ro.reverseOrderLineDTOList ?? []).filter((l) => !isDeadLazadaReturn(l)),
    }))
    .filter((x) => x.lines.length > 0);
  if (alive.length > 0) {
    const toMs = (v: string | number | undefined) => {
      const n = Number(v ?? 0) || 0;
      return n > 0 && n < 1e12 ? n * 1000 : n;
    };
    const newest = alive.sort(
      (a, b) =>
        Math.max(...b.lines.map((l) => toMs(l.return_order_line_gmt_create))) -
        Math.max(...a.lines.map((l) => toMs(l.return_order_line_gmt_create)))
    )[0];
    const ref = newest.ro.reverse_order_id != null ? String(newest.ro.reverse_order_id) : null;
    if (order.cancelRequestedAt && order.cancelRequestRef === ref) return null;
    const reason = newest.lines.map((l) => (l.reason_text ?? "").toString().trim()).find(Boolean) ?? null;
    const requestedMs = Math.min(...newest.lines.map((l) => toMs(l.return_order_line_gmt_create) || nowMs));
    return {
      data: {
        cancelRequestedAt: new Date(requestedMs || nowMs),
        cancelRequestReason: reason,
        cancelRequestRef: ref,
        cancelRequestDueAt: null,
      },
      flagged: !order.cancelRequestedAt,
      unflagged: false,
      reason,
    };
  }
  if (order.cancelRequestedAt) {
    return { data: { ...CLEAR_CANCEL_REQUEST }, flagged: false, unflagged: true, reason: null };
  }
  return null;
}

/** Trạng thái hoàn hiện tại của đơn — phần planner cần nhìn (mirror Shopee). */
export interface LazadaReturnFlagState {
  returnStatus: ReturnStatus;
  returnRequestedAt: Date | null;
  returnTrackingCode: string | null;
  returnSolution?: ReturnSolution | null;
  platformRefundAmount?: number;
  platformReturnStatus?: string | null;
}

export interface LazadaReturnUpdatePlan {
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
  /** Số lượng trả theo channelSku (mỗi dòng hoàn = 1 đơn vị) — null = không có
   *  dữ liệu dòng; map RỖNG khi chỉ hoàn tiền (không dòng nào bị trả). */
  itemReturns: Map<string, number> | null;
}

/**
 * QUYẾT ĐỊNH thuần (không API, không DB) cho MỘT đơn từ các yêu cầu hoàn của
 * nó. Mỗi dòng hoàn của Lazada là MỘT ĐƠN VỊ hàng → số lượng trả = số dòng
 * sống cùng SKU. Tiền hoàn = Σ refund_amount các dòng sống có is_need_refund.
 */
export function planLazadaReturnUpdate(
  group: LazadaReverseOrder[],
  order: LazadaReturnFlagState,
  nowMs: number
): LazadaReturnUpdatePlan {
  const plan: LazadaReturnUpdatePlan = {
    data: {},
    flagged: false,
    unflagged: false,
    trackingSaved: false,
    itemReturns: null,
  };

  // Bỏ hẳn yêu cầu HỦY ĐƠN (trục shippingStatus lo) — chỉ giữ hoàn/trả.
  const relevant = group.filter((ro) => lazadaReturnSolutionOf(ro) !== null);
  type AliveLine = { ro: LazadaReverseOrder; line: LazadaReverseOrderLine };
  const aliveLines: AliveLine[] = [];
  for (const ro of relevant) {
    for (const line of ro.reverse_order_lines ?? ro.reverseOrderLineDTOList ?? []) {
      if (!isDeadLazadaReturn(line)) aliveLines.push({ ro, line });
    }
  }

  // Chuẩn hoá về MILI-GIÂY: data thật trả GIÂY (10 chữ số) dù docs ghi ms —
  // giá trị < 1e12 coi là giây (probe 20/08: gmt_modified 1734669213).
  const toMs = (v: string | number | undefined) => {
    const n = Number(v ?? 0) || 0;
    return n > 0 && n < 1e12 ? n * 1000 : n;
  };
  const lineMs = (l: LazadaReverseOrderLine) =>
    toMs(l.return_order_line_gmt_modified ?? l.return_order_line_gmt_create);

  if (aliveLines.length === 0) {
    if (order.returnStatus === ReturnStatus.AWAITING) {
      // Mọi dòng hoàn đều chết → hạ cờ, xoá mã hoàn (kiện không quay lại nữa).
      plan.data.returnStatus = ReturnStatus.NONE;
      plan.data.returnRequestedAt = null;
      plan.data.returnTrackingCode = null;
      plan.unflagged = true;
    }
    if (order.returnSolution != null) plan.data.returnSolution = null;
    if ((order.platformRefundAmount ?? 0) !== 0) plan.data.platformRefundAmount = 0;
    if (order.platformReturnStatus != null && relevant.length > 0) {
      const deadLines = relevant.flatMap(
        (ro) => ro.reverse_order_lines ?? ro.reverseOrderLineDTOList ?? []
      );
      const newest = [...deadLines].sort((a, b) => lineMs(b) - lineMs(a))[0];
      // Ưu tiên ofc_status: với dòng chết nó mang đúng lý do (RETURN_CANCELED...).
      const st =
        `${newest?.ofc_status ?? newest?.reverse_status ?? ""}`.toUpperCase() || null;
      if (st !== order.platformReturnStatus) plan.data.platformReturnStatus = st;
    }
    return plan;
  }

  // Giải pháp: có bất kỳ yêu cầu TRẢ HÀNG nào còn sống → hàng sẽ về (ưu tiên
  // hơn chỉ-hoàn-tiền vì kho cần đón kiện); chỉ toàn ONLY_REFUND → khách giữ.
  const hasReturn = aliveLines.some(
    ({ ro }) => lazadaReturnSolutionOf(ro) === ReturnSolution.RETURN_REFUND
  );
  const solution = hasReturn ? ReturnSolution.RETURN_REFUND : ReturnSolution.REFUND_ONLY;
  const refundOnly = solution === ReturnSolution.REFUND_ONLY;

  // Tiền hoàn sàn báo = Σ dòng sống có is_need_refund (chuỗi → số).
  const refund = aliveLines.reduce(
    (s, { line }) =>
      s + (truthy(line.is_need_refund) ? Number(line.refund_amount ?? 0) || 0 : 0),
    0
  );
  const newestLine = [...aliveLines].sort((a, b) => lineMs(b.line) - lineMs(a.line))[0];
  const status = (newestLine.line.reverse_status ?? "").toUpperCase() || null;
  const tracking =
    [...aliveLines]
      .sort((a, b) => lineMs(b.line) - lineMs(a.line))
      .map(({ line }) => line.tracking_number?.trim())
      .find(Boolean) ?? null;
  const requestedMs = Math.min(
    ...aliveLines.map(({ line }) => toMs(line.return_order_line_gmt_create) || nowMs)
  );

  if (order.returnStatus === ReturnStatus.NONE && !refundOnly) {
    plan.data.returnStatus = ReturnStatus.AWAITING;
    plan.data.returnRequestedAt = new Date(requestedMs || nowMs);
    plan.flagged = true;
  } else if (order.returnStatus === ReturnStatus.AWAITING && refundOnly) {
    // Sàn chốt chỉ hoàn tiền — không kiện nào về, bỏ khỏi danh sách chờ của kho.
    plan.data.returnStatus = ReturnStatus.NONE;
    plan.data.returnRequestedAt = null;
    plan.data.returnTrackingCode = null;
    plan.unflagged = true;
  } else if (
    order.returnStatus === ReturnStatus.AWAITING &&
    !order.returnRequestedAt &&
    requestedMs
  ) {
    plan.data.returnRequestedAt = new Date(requestedMs);
  }
  if (!refundOnly && tracking && tracking !== order.returnTrackingCode) {
    plan.data.returnTrackingCode = tracking;
    plan.trackingSaved = true;
  }

  // Số của sàn — chỉ ghi khi ĐỔI (idempotent).
  if (solution !== (order.returnSolution ?? null)) plan.data.returnSolution = solution;
  if (refund !== (order.platformRefundAmount ?? 0)) plan.data.platformRefundAmount = refund;
  if (status !== (order.platformReturnStatus ?? null)) plan.data.platformReturnStatus = status;

  // Số lượng trả theo SKU: chỉ dòng của yêu cầu TRẢ HÀNG còn sống (mỗi dòng 1
  // đơn vị); chỉ hoàn tiền → map rỗng (không dòng nào bị trả).
  const map = new Map<string, number>();
  if (!refundOnly) {
    for (const { ro, line } of aliveLines) {
      if (lazadaReturnSolutionOf(ro) !== ReturnSolution.RETURN_REFUND) continue;
      const sku = lazadaChannelSku({ sellerSku: line.seller_sku_id });
      map.set(sku, (map.get(sku) ?? 0) + 1);
    }
  }
  plan.itemReturns = map;

  return plan;
}

export interface SyncLazadaReturnsResult extends SyncCompleteness {
  scanned: number;
  flagged: number;
  unflagged: number;
  trackingSaved: number;
  itemsUpdated: number;
  ordersNotFound: number;
  /** Cờ khách xin hủy vừa bật / vừa hạ (trục riêng). */
  cancelFlagged: number;
  cancelUnflagged: number;
}

export interface SyncLazadaReturnsOptions {
  /** Quét yêu cầu hoàn BIẾN ĐỘNG trong N ngày gần nhất. Mặc định 7. */
  daysBack?: number;
}

/**
 * Phản ánh các yêu cầu hoàn của MỘT đơn Lazada vào Order — phần GHI dùng chung
 * cho lượt quét theo thời gian và lượt hỏi theo mã đơn (lát C 29/10/2026).
 */
async function applyLazadaReturnGroup(
  channel: Channel,
  orderCode: string,
  group: LazadaReverseOrder[],
  nowMs: number,
  result: SyncLazadaReturnsResult
): Promise<void> {
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
      shippingStatus: true,
      cancelRequestedAt: true,
      cancelRequestRef: true,
      items: { select: { id: true, channelSku: true, returnedQuantity: true } },
    },
  });
  if (!order) {
    result.ordersNotFound++;
    return;
  }

  // Cờ KHÁCH XIN HỦY (trục riêng, 23/10/2026) — reverse order request_type
  // CANCEL còn sống; ghi trước phần hoàn vì hai trục không giẫm cột nhau.
  const cancelPlan = planLazadaCancelRequest(group, order, nowMs);
  if (cancelPlan) {
    await prisma.order.update({ where: { id: order.id }, select: { id: true }, data: cancelPlan.data });
    if (cancelPlan.flagged) {
      result.cancelFlagged++;
      await notifyCancelRequest(channel, orderCode, cancelPlan.reason, null, { prevStatus: order.shippingStatus });
    }
    if (cancelPlan.unflagged) result.cancelUnflagged++;
  }

  const plan = planLazadaReturnUpdate(
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

  // Lát 11 (03/10/2026): trạng thái hoàn sắp CHUYỂN VÀO nhóm đã chốt → ghi yêu cầu điều
  // chỉnh tự động TRƯỚC khi ghi đơn (ghi-trước + chỉ mục duy nhất: tiến trình chết giữa
  // chừng thì lượt đồng bộ sau thấy lại đúng lần chuyển này, không mất và không trùng).
  const returnJustDone =
    PLATFORM_RETURN_DONE_STATUSES.has(
      (plan.data.platformReturnStatus !== undefined ? plan.data.platformReturnStatus : order.platformReturnStatus) ?? ""
    ) && !PLATFORM_RETURN_DONE_STATUSES.has(order.platformReturnStatus ?? "");
  if (returnJustDone) await autoAdjustOnPlatformReturn(channel.userId, order.id, "before");
  if (Object.keys(plan.data).length > 0) {
    await prisma.order.update({ where: { id: order.id }, data: plan.data });
  }

  if (plan.itemReturns) {
    for (const it of order.items) {
      const qty = plan.itemReturns.get(it.channelSku) ?? 0;
      if (qty !== it.returnedQuantity) {
        await prisma.orderItem.update({
          where: { id: it.id },
          data: { returnedQuantity: qty },
        });
        result.itemsUpdated++;
      }
    }
  }

  // TỰ ĐỘNG LẬP HÓA ĐƠN ĐIỀU CHỈNH THEO SÀN (25/08, cùng khuôn Shopee): bắn
  // đúng lần reverse_status CHUYỂN VÀO tập "hoàn đã chốt" (REFUND_SUCCESS /
  // CANCEL_REFUND_ISSUED — luồng trả hàng RTM do lưới vét nhập kho gánh).
  // Đặt SAU khi đã ghi itemReturns để hook đọc được số lượng trả mới nhất.
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
      await autoAdjustOnPlatformReturn(channel.userId, order.id, "after");
    }
  }

  if (plan.flagged) {
    await notify(channel.userId, {
      type: "return",
      title: `Đơn ${orderCode} đang hoàn về — Hubsell đã chuyển sang Chờ nhận hàng hoàn`,
      body: `Lazada · gian ${channel.shopName}. Đơn này đã được tách khỏi doanh thu cho tới khi nhận lại hàng; kho chỉ cần quét mã khi kiện về tay.`,
      link: "/warehouse/returns",
    });
  }
}

/**
 * Hỏi yêu cầu hoàn của MỘT đơn ngay (lát C 29/10/2026 — màn quét đơn hoàn):
 * Reverse Order API lọc `trade_order_id` (= mã đơn Hubsell lưu). 1 call.
 */
export async function syncLazadaReturnsForOrder(
  channel: Channel,
  orderCode: string
): Promise<SyncLazadaReturnsResult & { withReturns: boolean }> {
  const accessToken = await getValidLazadaAccessToken(channel);
  const result: SyncLazadaReturnsResult & { withReturns: boolean } = {
    pages: 0,
    truncated: false,
    scanned: 0,
    flagged: 0,
    unflagged: 0,
    trackingSaved: 0,
    itemsUpdated: 0,
    ordersNotFound: 0,
    cancelFlagged: 0,
    cancelUnflagged: 0,
    withReturns: false,
  };
  const page = await getReverseOrders({ accessToken, pageNo: 1, pageSize: 50, tradeOrderId: orderCode });
  result.pages = 1;
  const group = page.items.filter((ro) => String(ro.trade_order_id ?? "").trim() === orderCode);
  result.scanned = group.length;
  if (group.length === 0) return result;
  result.withReturns = true;
  await applyLazadaReturnGroup(channel, orderCode, group, Date.now(), result);
  return result;
}

/**
 * Quét Reverse Order API rồi phản ánh số của sàn vào Order. Idempotent —
 * chạy lặp bao nhiêu lần cũng ra cùng trạng thái.
 */
export async function syncLazadaReturns(
  channel: Channel,
  opts: SyncLazadaReturnsOptions = {}
): Promise<SyncLazadaReturnsResult> {
  const accessToken = await getValidLazadaAccessToken(channel);
  const nowMs = Date.now();
  const daysBack = opts.daysBack ?? 7;
  const floorMs = nowMs - daysBack * 24 * 60 * 60 * 1000;

  const result: SyncLazadaReturnsResult = {
    pages: 0,
    truncated: false,
    scanned: 0,
    flagged: 0,
    unflagged: 0,
    trackingSaved: 0,
    itemsUpdated: 0,
    ordersNotFound: 0,
    cancelFlagged: 0,
    cancelUnflagged: 0,
  };

  // (1) Gom yêu cầu hoàn theo lát 15 ngày; trùng reverse_order_id giữa các lát
  // → giữ bản đọc sau (lát mới hơn quét trước nên bản đầu là mới nhất — dùng
  // Map.has để GIỮ bản đầu tiên gặp).
  const byId = new Map<string, LazadaReverseOrder>();
  for (let to = nowMs; to > floorMs; to -= SLICE_MS) {
    const from = Math.max(floorMs, to - SLICE_MS);
    let more = false;
    for (let pageNo = 1; pageNo <= MAX_PAGES_PER_SLICE; pageNo++) {
      const page = await getReverseOrders({
        accessToken,
        pageNo,
        pageSize: 50,
        // GIÂY, không phải ms: docs ghi "Milliseconds" nhưng data thật trả
        // timestamp GIÂY (probe 20/08) — truyền cùng đơn vị với data của sàn.
        modifiedFromMs: Math.floor(from / 1000),
        modifiedToMs: Math.floor(to / 1000),
      });
      result.pages++;
      for (const ro of page.items) {
        const key = String(ro.reverse_order_id ?? `${ro.trade_order_id}-${pageNo}`);
        if (!byId.has(key)) byId.set(key, ro);
      }
      more = page.items.length >= 50;
      if (!more) break;
    }
    // Trang cuối vẫn đầy mà đã hết MAX_PAGES_PER_SLICE → lát này CHƯA ĐỦ (hợp đồng lát 3.1).
    if (more) result.truncated = true;
  }
  result.scanned = byId.size;
  if (byId.size === 0) return result;

  // (2) Gom theo đơn gốc (một đơn có thể nhiều yêu cầu hoàn).
  const byOrder = new Map<string, LazadaReverseOrder[]>();
  for (const ro of byId.values()) {
    const code = String(ro.trade_order_id ?? "").trim();
    if (!code) continue;
    const list = byOrder.get(code);
    if (list) list.push(ro);
    else byOrder.set(code, [ro]);
  }

  for (const [orderCode, group] of byOrder) {
    await applyLazadaReturnGroup(channel, orderCode, group, nowMs, result);
  }

  return result;
}
