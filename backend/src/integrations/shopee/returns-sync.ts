// ============================================================
// ĐỒNG BỘ ĐƠN HOÀN SHOPEE — RETURNS API (v2.returns.get_return_list)
//
// Vì sao cần luồng RIÊNG ngoài quét đơn trục update_time:
//   · Yêu cầu Trả hàng/Hoàn tiền trên đơn đã COMPLETED nằm ở module Returns
//     (return_sn) — KHÔNG đổi order_status, nên cả webhook order_status_push
//     lẫn get_order_list trục update đều KHÔNG nhìn thấy. Đây chính là lỗ hổng
//     khiến trang "Đối soát đơn hoàn" trước đây phải chờ người bấm đồng bộ tay.
//   · Kiện hoàn đi CHIỀU NGƯỢC có mã vận đơn riêng (tracking_number của return)
//     — kho quét tem trên kiện hoàn là quét mã này, phải lưu vào
//     Order.returnTrackingCode thì lookup mới khớp.
//
// Luồng: quét get_return_list theo BIẾN ĐỘNG (update_time) → gom yêu cầu theo
// order_sn (một đơn có thể có nhiều yêu cầu, cái sau thay cái trước bị hủy) →
// gắn/hạ cờ AWAITING trên trục returnStatus + lưu mã vận đơn hoàn.
//
// An toàn dữ liệu: CHỈ đổi qua lại NONE ↔ AWAITING. Đơn kho đã xử lý
// (RECEIVED trở đi) tuyệt đối không đụng — không regress tiến độ nhập kho.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName, ReturnSolution, ReturnStatus } from "@prisma/client";
import { notify } from "../../services/notifications";
import { prisma } from "../../lib/prisma";
import { PLATFORM_FEE_RATE } from "../../marketplace/mockMarketplace";
import {
  maybeAutoAdjustOnPlatformReturn,
  PLATFORM_RETURN_DONE_STATUSES,
} from "../invoice/adjust-order";
import {
  getOrderDetail,
  getReturnDetail,
  getReturnList,
  getEscrowDetail,
  shopeeChannelSku,
  getTrackingNumber,
  type ShopeeReturnEntry,
} from "./client";
import { getValidShopeeAccessToken, upsertShopeeOrderTx } from "./service";
import { mapShopeeEscrowFields } from "./settlements";

/** Chốt chặn phân trang vô tận (50 yêu cầu/trang → 2500 yêu cầu/lượt là quá đủ). */
const MAX_RETURN_PAGES = 50;
/** Trần số lần hỏi get_return_detail mỗi lượt quét (kiện hoàn về tay chưa). */
const MAX_DETAIL_CALLS_PER_SWEEP = 40;

/** Yêu cầu hoàn đã CHẾT — không còn hàng nào sẽ quay về kho từ yêu cầu này. */
export function isDeadReturn(status?: string): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "CANCELLED" || s === "CLOSED";
}

/** Trạng thái hoàn hiện tại của đơn — phần planReturnUpdate cần nhìn. */
export interface ReturnFlagState {
  returnStatus: ReturnStatus;
  returnRequestedAt: Date | null;
  returnTrackingCode: string | null;
  /** Số của sàn đã lưu — để chỉ ghi khi ĐỔI (idempotent). Thiếu = chưa có. */
  returnSolution?: ReturnSolution | null;
  platformRefundAmount?: number;
  platformReturnStatus?: string | null;
}

export interface ReturnUpdatePlan {
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
  /**
   * SỐ LƯỢNG TRẢ theo channelSku từ `item[]` của yêu cầu sống mới nhất —
   * null = không có dữ liệu dòng hàng (không đụng OrderItem.returnedQuantity).
   * Chỉ hoàn tiền (khách giữ hàng) → map rỗng → mọi dòng về 0.
   */
  itemReturns: Map<string, number> | null;
  /** Yêu cầu sống mới nhất (để vòng sync hỏi chi tiết kiện hoàn về tay chưa). */
  latestAlive: ShopeeReturnEntry | null;
}

/**
 * Giải pháp hoàn từ một yêu cầu: return_solution (0 hàng về / 1 khách giữ) là
 * nguồn chính; thiếu thì suy từ needs_logistics; cả hai thiếu → null (đơn cờ
 * kiểu cũ — Lãi/Lỗ không đoán, coi như chưa biết).
 */
export function returnSolutionOf(e: ShopeeReturnEntry): ReturnSolution | null {
  if (e.return_solution === 0) return ReturnSolution.RETURN_REFUND;
  if (e.return_solution === 1) return ReturnSolution.REFUND_ONLY;
  if (typeof e.needs_logistics === "boolean") {
    return e.needs_logistics ? ReturnSolution.RETURN_REFUND : ReturnSolution.REFUND_ONLY;
  }
  return null;
}

/**
 * QUYẾT ĐỊNH thuần (không API, không DB) cho một đơn từ nhóm yêu cầu hoàn của
 * nó: gắn cờ AWAITING, hạ cờ khi mọi yêu cầu đã hủy, lưu mã vận đơn chiều hoàn,
 * và (19/08) chép SỐ CỦA SÀN: giải pháp hoàn, tiền hoàn sàn báo, trạng thái
 * yêu cầu, số lượng SKU trả. Bất biến quan trọng: trục returnStatus CHỈ đổi
 * qua lại NONE ↔ AWAITING — đơn kho đã xử lý (RECEIVED trở đi) không bao giờ
 * bị đụng. Yêu cầu CHỈ HOÀN TIỀN (khách giữ hàng) không có kiện nào về nên
 * KHÔNG gắn AWAITING (và hạ cờ AWAITING nếu trước đó đã gắn nhầm) — danh sách
 * "Chờ về tay" của kho chỉ giữ đơn thực sự có hàng quay về.
 */
export function planReturnUpdate(
  group: ShopeeReturnEntry[],
  order: ReturnFlagState,
  nowSec: number
): ReturnUpdatePlan {
  const alive = group.filter((e) => !isDeadReturn(e.status));
  const aliveNewestFirst = [...alive].sort(
    (a, b) => (b.update_time ?? 0) - (a.update_time ?? 0)
  );
  const latest = aliveNewestFirst[0] ?? null;
  // Mã vận đơn hoàn: ưu tiên của yêu cầu CÒN SỐNG mới nhất (yêu cầu cũ bị hủy
  // có thể mang tracking không còn dùng).
  const tracking =
    aliveNewestFirst.map((e) => e.tracking_number?.trim()).find(Boolean) ?? null;
  // Mốc "sàn báo hoàn" = lúc tạo yêu cầu SỚM nhất còn sống — số ngày chờ là
  // căn cứ khiếu nại bưu cục nên lấy mốc thật của sàn, không lấy lúc mình quét.
  const requestedSec = alive.length
    ? Math.min(...alive.map((e) => e.create_time ?? nowSec))
    : null;

  const plan: ReturnUpdatePlan = {
    data: {},
    flagged: false,
    unflagged: false,
    trackingSaved: false,
    itemReturns: null,
    latestAlive: latest,
  };

  const solution = latest ? returnSolutionOf(latest) : null;
  const refundOnly = solution === ReturnSolution.REFUND_ONLY;

  if (alive.length > 0) {
    if (order.returnStatus === ReturnStatus.NONE && !refundOnly) {
      plan.data.returnStatus = ReturnStatus.AWAITING;
      plan.data.returnRequestedAt = new Date((requestedSec ?? nowSec) * 1000);
      plan.flagged = true;
    } else if (order.returnStatus === ReturnStatus.AWAITING && refundOnly) {
      // Sàn chốt "chỉ hoàn tiền" — không có kiện nào về, bỏ khỏi danh sách chờ.
      plan.data.returnStatus = ReturnStatus.NONE;
      plan.data.returnRequestedAt = null;
      plan.data.returnTrackingCode = null;
      plan.unflagged = true;
    } else if (
      order.returnStatus === ReturnStatus.AWAITING &&
      !order.returnRequestedAt &&
      requestedSec
    ) {
      plan.data.returnRequestedAt = new Date(requestedSec * 1000);
    }
    if (!refundOnly && tracking && tracking !== order.returnTrackingCode) {
      plan.data.returnTrackingCode = tracking;
      plan.trackingSaved = true;
    }

    // ---- Số của sàn (chỉ ghi khi đổi) ----
    const refund = Number(latest?.refund_amount ?? 0) || 0;
    const status = (latest?.status ?? "").toUpperCase() || null;
    if (solution !== (order.returnSolution ?? null)) plan.data.returnSolution = solution;
    if (refund !== (order.platformRefundAmount ?? 0)) plan.data.platformRefundAmount = refund;
    if (status !== (order.platformReturnStatus ?? null)) plan.data.platformReturnStatus = status;
    // Dòng hàng trả: chỉ khi hàng về; khách giữ hàng → không dòng nào bị trả.
    if (latest?.item && latest.item.length > 0) {
      const map = new Map<string, number>();
      if (!refundOnly) {
        for (const it of latest.item) {
          const sku = shopeeChannelSku({
            itemId: it.item_id,
            modelId: it.model_id,
            itemSku: it.item_sku,
            modelSku: it.variation_sku,
          });
          map.set(sku, (map.get(sku) ?? 0) + (it.amount ?? 0));
        }
      }
      plan.itemReturns = map;
    }
  } else {
    if (order.returnStatus === ReturnStatus.AWAITING) {
      // Mọi yêu cầu hoàn của đơn trong cửa sổ đều đã hủy → hạ cờ để danh sách
      // "Chờ về tay" không nuôi đơn không bao giờ về. Kiện sẽ không quay lại nên
      // mã vận đơn hoàn cũng xoá — giữ lại là lookup khớp nhầm kiện ma. (Người
      // mua mở yêu cầu MỚI thì nó nằm cùng cửa sổ biến động và đã vào `alive`.)
      plan.data.returnStatus = ReturnStatus.NONE;
      plan.data.returnRequestedAt = null;
      plan.data.returnTrackingCode = null;
      plan.unflagged = true;
    }
    // Yêu cầu chết hết → không còn tiền hoàn nào treo: xoá giải pháp + tiền
    // sàn báo; trạng thái lưu nguyên văn CLOSED/CANCELLED (chỉ khi trước đó có
    // ghi — đơn chưa từng có số của sàn thì để yên, giữ idempotent).
    if (order.returnSolution != null) plan.data.returnSolution = null;
    if ((order.platformRefundAmount ?? 0) !== 0) plan.data.platformRefundAmount = 0;
    if (order.platformReturnStatus != null) {
      const dead = [...group].sort((a, b) => (b.update_time ?? 0) - (a.update_time ?? 0))[0];
      const deadStatus = (dead?.status ?? "").toUpperCase() || null;
      if (deadStatus !== order.platformReturnStatus) plan.data.platformReturnStatus = deadStatus;
    }
  }

  return plan;
}

export interface SyncShopeeReturnsResult {
  /** Số yêu cầu hoàn đọc được trong cửa sổ. */
  scanned: number;
  /** Số đơn MỚI được gắn cờ chờ về tay (NONE → AWAITING). */
  flagged: number;
  /** Số đơn được hạ cờ vì mọi yêu cầu hoàn đã hủy (AWAITING → NONE). */
  unflagged: number;
  /** Số đơn được lưu/cập nhật mã vận đơn chiều hoàn. */
  trackingSaved: number;
  /** Số đơn phải kéo mới từ sàn vì DB chưa có (đơn cũ ngoài mọi cửa sổ quét). */
  ordersFetched: number;
  /** Số đơn vừa ghi mốc KIỆN HOÀN ĐÃ VỀ TAY (sàn xác nhận hoặc kho đã quét). */
  delivered: number;
  /** Số dòng hàng được cập nhật số lượng trả theo sàn. */
  itemsUpdated: number;
  /** Số đơn đã đối soát được đọc lại escrow để lấy số hoàn sao kê còn thiếu. */
  escrowRefreshed: number;
}

export interface SyncShopeeReturnsOptions {
  /** Quét yêu cầu hoàn có BIẾN ĐỘNG trong N ngày gần nhất. Mặc định 7. */
  daysBack?: number;
}

/**
 * Quét yêu cầu Trả hàng/Hoàn tiền rồi phản ánh vào trục returnStatus của đơn.
 * Idempotent hoàn toàn — chạy lặp bao nhiêu lần cũng ra cùng trạng thái.
 */
export async function syncShopeeReturns(
  channel: Channel,
  opts: SyncShopeeReturnsOptions = {}
): Promise<SyncShopeeReturnsResult> {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const nowSec = Math.floor(Date.now() / 1000);
  const daysBack = opts.daysBack ?? 7;

  const result: SyncShopeeReturnsResult = {
    scanned: 0,
    flagged: 0,
    unflagged: 0,
    trackingSaved: 0,
    ordersFetched: 0,
    delivered: 0,
    itemsUpdated: 0,
    escrowRefreshed: 0,
  };

  // (1) Gom toàn bộ yêu cầu hoàn trong cửa sổ biến động — CẮT LÁT tối đa
  // 15 ngày/lần gọi (Shopee giới hạn khoảng update_time như get_order_list;
  // backfill 120 ngày gọi một phát bị sàn từ chối, 19/08). Trùng return_sn
  // giữa các lát → giữ bản mới nhất.
  const bySn = new Map<string, ShopeeReturnEntry>();
  const SLICE_SEC = 15 * 24 * 60 * 60;
  const floorSec = nowSec - daysBack * 24 * 60 * 60;
  for (let to = nowSec; to > floorSec; to -= SLICE_SEC) {
    const from = Math.max(floorSec, to - SLICE_SEC);
    // page_no BẮT ĐẦU TỪ 0 (docs: "Specifies the starting entry... Default is 0")
    // — trước gửi 1 nên trang đầu bị bỏ qua, API trả RỖNG suốt từ 13/08 (phát
    // hiện 20/08 khi backfill: scanned=0 dù gian có đơn hoàn). Khớp return_sn
    // giữa các trang nên dù sàn hiểu là offset hay page vẫn không trùng.
    for (let pageNo = 0; pageNo < MAX_RETURN_PAGES; pageNo++) {
      const page = await getReturnList({
        accessToken,
        shopId,
        pageNo,
        pageSize: 50,
        updateTimeFrom: from,
        updateTimeTo: to,
      });
      const list = page.response?.return ?? [];
      for (const e of list) {
        const key = e.return_sn ?? `${e.order_sn}-${e.create_time}`;
        const prev = bySn.get(key);
        if (!prev || (e.update_time ?? 0) >= (prev.update_time ?? 0)) bySn.set(key, e);
      }
      if (!page.response?.more || list.length === 0) break;
    }
  }
  const entries = [...bySn.values()];
  result.scanned = entries.length;
  if (entries.length === 0) return result;

  // (2) Gom theo đơn — một đơn có thể có nhiều yêu cầu (hủy rồi mở lại).
  const byOrder = new Map<string, ShopeeReturnEntry[]>();
  for (const e of entries) {
    const sn = e.order_sn?.trim();
    if (!sn) continue;
    const list = byOrder.get(sn);
    if (list) list.push(e);
    else byOrder.set(sn, [e]);
  }

  const feeRate =
    Number(channel.feeRate) > 0
      ? Number(channel.feeRate)
      : PLATFORM_FEE_RATE[ChannelName.SHOPEE];

  const orderSelect = {
    id: true,
    returnStatus: true,
    returnRequestedAt: true,
    returnTrackingCode: true,
    returnSolution: true,
    platformRefundAmount: true,
    platformReturnStatus: true,
    returnDeliveredAt: true,
    isSettled: true,
    refundedAmount: true,
    items: { select: { id: true, channelSku: true, returnedQuantity: true } },
  } as const;
  let detailCalls = 0;
  let escrowRefreshCalls = 0;

  for (const [orderSn, group] of byOrder) {
    const alive = group.filter((e) => !isDeadReturn(e.status));

    let order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderSn } },
      select: orderSelect,
    });

    // Đơn chưa có trong DB (tạo từ lâu, ngoài mọi cửa sổ đồng bộ) → kéo về đã.
    if (!order && alive.length > 0) {
      try {
        const details = await getOrderDetail(accessToken, shopId, [orderSn]);
        if (details[0]) {
          await prisma.$transaction((tx) =>
            upsertShopeeOrderTx(tx, channel, details[0], feeRate)
          );
          result.ordersFetched++;
          order = await prisma.order.findUnique({
            where: {
              channelId_orderCode: { channelId: channel.id, orderCode: orderSn },
            },
            select: orderSelect,
          });
        }
      } catch (err) {
        // Một đơn kéo hỏng không được chặn các đơn còn lại của lượt quét.
        console.error(
          `[Shopee Returns] Không kéo được đơn ${orderSn} của yêu cầu hoàn:`,
          (err as Error).message
        );
      }
    }
    if (!order) continue;

    const plan = planReturnUpdate(
      group,
      {
        returnStatus: order.returnStatus,
        returnRequestedAt: order.returnRequestedAt,
        returnTrackingCode: order.returnTrackingCode,
        returnSolution: order.returnSolution,
        platformRefundAmount: Number(order.platformRefundAmount),
        platformReturnStatus: order.platformReturnStatus,
      },
      nowSec
    );
    if (plan.flagged) result.flagged++;
    if (plan.unflagged) result.unflagged++;
    if (plan.trackingSaved) result.trackingSaved++;

    // KIỆN HOÀN ĐÃ VỀ TAY? Chỉ hỏi get_return_detail khi: hàng phải về
    // (RETURN_REFUND), chưa ghi mốc về, yêu cầu đã qua bước khách gửi
    // (PROCESSING trở đi) — REQUESTED thì khách còn chưa gửi, hỏi phí call.
    // Kho đã quét (RECEIVED trở đi) = chắc chắn về tay → ghi mốc luôn, khỏi hỏi.
    let deliveredAt: Date | null = null;
    const latest = plan.latestAlive;
    const solution =
      plan.data.returnSolution !== undefined ? plan.data.returnSolution : order.returnSolution;
    if (latest && solution === ReturnSolution.RETURN_REFUND && !order.returnDeliveredAt) {
      const st = (latest.status ?? "").toUpperCase();
      const kept =
        order.returnStatus !== ReturnStatus.NONE && order.returnStatus !== ReturnStatus.AWAITING;
      if (kept) {
        deliveredAt = new Date();
      } else if (
        latest.return_sn &&
        st !== "REQUESTED" &&
        detailCalls < MAX_DETAIL_CALLS_PER_SWEEP
      ) {
        detailCalls++;
        try {
          const d = await getReturnDetail(accessToken, shopId, latest.return_sn);
          const rl = String(
            d?.reverse_logistics_status ?? d?.reverse_logistic_status ?? d?.logistics_status ?? ""
          ).toUpperCase();
          if (rl === "LOGISTICS_DELIVERY_DONE" || rl === "DELIVERED") {
            deliveredAt = new Date((d?.update_time ?? latest.update_time ?? nowSec) * 1000);
          }
        } catch (err) {
          console.warn(
            `[Shopee Returns] Không đọc được chi tiết yêu cầu ${latest.return_sn}:`,
            (err as Error).message
          );
        }
      }
    }
    if (deliveredAt) {
      plan.data.returnDeliveredAt = deliveredAt;
      result.delivered++;
    }

    if (Object.keys(plan.data).length > 0) {
      await prisma.order.update({ where: { id: order.id }, data: plan.data });
    }

    // TỰ ĐỘNG LẬP HÓA ĐƠN ĐIỀU CHỈNH THEO SÀN (25/08 — anh Trung chốt: mốc là
    // sàn xác nhận hoàn, không chờ hàng về kho): bắn đúng lần trạng thái yêu
    // cầu CHUYỂN VÀO tập "hoàn đã chốt". Fire-and-forget, hook tự kiểm công
    // tắc + chống trùng — không chặn vòng sync.
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

    // TỰ CHỮA SỐ HOÀN SAO KÊ: đơn ĐÃ đối soát, yêu cầu hoàn đã ACCEPTED mà DB
    // chưa có refundedAmount (đối soát hồi trước 05/08 khi chưa map
    // seller_return_refund, hoặc hoàn sau khi giải ngân) → đọc lại escrow của
    // đúng đơn này (escrow thật 2607194YFVJ17J có seller_return_refund -230.000
    // nhưng DB = 0, 20/08). Cap theo lượt để không đốt quota.
    const stNow = (latest?.status ?? "").toUpperCase();
    if (
      order.isSettled &&
      Number(order.refundedAmount) === 0 &&
      stNow === "ACCEPTED" &&
      escrowRefreshCalls < MAX_DETAIL_CALLS_PER_SWEEP
    ) {
      escrowRefreshCalls++;
      try {
        const detail = await getEscrowDetail({ accessToken, shopId, orderSn });
        const income = detail.response?.order_income;
        if (income) {
          await prisma.order.update({
            where: { id: order.id },
            data: mapShopeeEscrowFields(income),
          });
          result.escrowRefreshed++;
        }
      } catch (err) {
        console.warn(
          `[Shopee Returns] Không đọc lại được escrow đơn :`,
          (err as Error).message
        );
      }
    }

    // Số lượng trả theo dòng SKU (chỉ ghi dòng có thay đổi — idempotent).
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

    // CHUÔNG THÔNG BÁO (Tầng 3): sàn vừa báo hoàn một đơn MỚI (NONE→AWAITING)
    // — kho cần biết ngay để đón kiện. notify tự chống trùng + nuốt lỗi.
    if (plan.flagged) {
      await notify(channel.userId, {
        type: "return",
        title: `Shopee báo hoàn đơn ${orderSn}`,
        body: `Gian ${channel.shopName} — đơn chuyển sang "Chờ nhận hàng hoàn". Kho quét mã khi kiện về tay.`,
        link: "/warehouse/returns",
      });
    }
  }

  return result;
}


// ============================================================
// BACKFILL MÃ VẬN ĐƠN CHIỀU ĐI — get_tracking_number (1 call / 1 đơn)
//
// get_order_detail v2 không trả tracking nên đơn Shopee đồng bộ về trước giờ
// trống trackingCode — kho quét tem chiều đi (kiện giao thất bại quay đầu)
// là tra trượt. Backfill chạy TIẾT CHẾ theo nhịp worker: mỗi lượt tối đa
// `limit` đơn, ưu tiên đơn mới; đơn hỏi rồi mà sàn chưa có tracking thì nghỉ
// ATTEMPT_COOLDOWN_MS mới hỏi lại (chống đốt quota vào cùng một đơn).
// ============================================================

const ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 giờ
/** orderId → lần hỏi tracking gần nhất (in-memory: mất khi restart, vô hại). */
const lastAttemptAt = new Map<string, number>();

export interface BackfillTrackingResult {
  checked: number;
  saved: number;
}

/**
 * Điền dần trackingCode cho đơn Shopee còn trống. Chỉ hỏi đơn đã qua bước
 * chuẩn bị hàng (PROCESSED trở đi — trước đó sàn chưa cấp vận đơn, hỏi phí
 * call), trong 60 ngày gần nhất (kiện cũ hơn không còn về kho nữa).
 */
export async function backfillShopeeTrackingCodes(
  channel: Channel,
  opts: { limit?: number } = {}
): Promise<BackfillTrackingResult> {
  const limit = opts.limit ?? 30;
  const candidates = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      trackingCode: null,
      shippingStatus: { in: ["PROCESSED", "SHIPPING", "DELIVERED", "CANCELLED"] },
      createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderCode: true },
    // Lấy dư để trừ hao số đơn đang trong thời gian nghỉ giữa hai lần hỏi.
    take: limit * 3,
  });

  const now = Date.now();
  const due = candidates
    .filter((o) => now - (lastAttemptAt.get(o.id) ?? 0) > ATTEMPT_COOLDOWN_MS)
    .slice(0, limit);
  if (due.length === 0) return { checked: 0, saved: 0 };

  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  let saved = 0;
  for (const o of due) {
    lastAttemptAt.set(o.id, now);
    try {
      const tracking = await getTrackingNumber(accessToken, shopId, o.orderCode);
      if (tracking) {
        await prisma.order.update({
          where: { id: o.id },
          data: { trackingCode: tracking },
        });
        saved++;
      }
    } catch (err) {
      // Lỗi một đơn (đơn quá cũ, sàn chập chờn) không chặn các đơn còn lại.
      console.warn(
        `[Shopee Tracking] Chưa lấy được vận đơn ${o.orderCode}:`,
        (err as Error).message
      );
    }
  }
  return { checked: due.length, saved };
}
