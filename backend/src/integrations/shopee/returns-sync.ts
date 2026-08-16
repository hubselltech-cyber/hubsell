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
import { ChannelName, ReturnStatus } from "@prisma/client";
import { notify } from "../../notifications";
import { prisma } from "../../prisma";
import { PLATFORM_FEE_RATE } from "../../mockMarketplace";
import {
  getOrderDetail,
  getReturnList,
  getTrackingNumber,
  type ShopeeReturnEntry,
} from "./client";
import { getValidShopeeAccessToken, upsertShopeeOrderTx } from "./service";

/** Chốt chặn phân trang vô tận (50 yêu cầu/trang → 2500 yêu cầu/lượt là quá đủ). */
const MAX_RETURN_PAGES = 50;

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
}

export interface ReturnUpdatePlan {
  data: {
    returnStatus?: ReturnStatus;
    returnRequestedAt?: Date | null;
    returnTrackingCode?: string | null;
  };
  flagged: boolean;
  unflagged: boolean;
  trackingSaved: boolean;
}

/**
 * QUYẾT ĐỊNH thuần (không API, không DB) cho một đơn từ nhóm yêu cầu hoàn của
 * nó: gắn cờ AWAITING, hạ cờ khi mọi yêu cầu đã hủy, lưu mã vận đơn chiều hoàn.
 * Bất biến quan trọng: CHỈ đổi qua lại NONE ↔ AWAITING — đơn kho đã xử lý
 * (RECEIVED trở đi) không bao giờ bị đụng.
 */
export function planReturnUpdate(
  group: ShopeeReturnEntry[],
  order: ReturnFlagState,
  nowSec: number
): ReturnUpdatePlan {
  const alive = group.filter((e) => !isDeadReturn(e.status));
  // Mã vận đơn hoàn: ưu tiên của yêu cầu CÒN SỐNG mới nhất (yêu cầu cũ bị hủy
  // có thể mang tracking không còn dùng).
  const tracking =
    [...alive]
      .sort((a, b) => (b.update_time ?? 0) - (a.update_time ?? 0))
      .map((e) => e.tracking_number?.trim())
      .find(Boolean) ?? null;
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
  };

  if (alive.length > 0) {
    if (order.returnStatus === ReturnStatus.NONE) {
      plan.data.returnStatus = ReturnStatus.AWAITING;
      plan.data.returnRequestedAt = new Date((requestedSec ?? nowSec) * 1000);
      plan.flagged = true;
    } else if (
      order.returnStatus === ReturnStatus.AWAITING &&
      !order.returnRequestedAt &&
      requestedSec
    ) {
      plan.data.returnRequestedAt = new Date(requestedSec * 1000);
    }
    if (tracking && tracking !== order.returnTrackingCode) {
      plan.data.returnTrackingCode = tracking;
      plan.trackingSaved = true;
    }
  } else if (order.returnStatus === ReturnStatus.AWAITING) {
    // Mọi yêu cầu hoàn của đơn trong cửa sổ đều đã hủy → hạ cờ để danh sách
    // "Chờ về tay" không nuôi đơn không bao giờ về. Kiện sẽ không quay lại nên
    // mã vận đơn hoàn cũng xoá — giữ lại là lookup khớp nhầm kiện ma. (Người
    // mua mở yêu cầu MỚI thì nó nằm cùng cửa sổ biến động và đã vào `alive`.)
    plan.data.returnStatus = ReturnStatus.NONE;
    plan.data.returnRequestedAt = null;
    plan.data.returnTrackingCode = null;
    plan.unflagged = true;
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
  };

  // (1) Gom toàn bộ yêu cầu hoàn trong cửa sổ biến động.
  const entries: ShopeeReturnEntry[] = [];
  for (let pageNo = 1; pageNo <= MAX_RETURN_PAGES; pageNo++) {
    const page = await getReturnList({
      accessToken,
      shopId,
      pageNo,
      pageSize: 50,
      updateTimeFrom: nowSec - daysBack * 24 * 60 * 60,
      updateTimeTo: nowSec,
    });
    const list = page.response?.return ?? [];
    entries.push(...list);
    if (!page.response?.more || list.length === 0) break;
  }
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

  for (const [orderSn, group] of byOrder) {
    const alive = group.filter((e) => !isDeadReturn(e.status));

    let order = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode: orderSn } },
      select: {
        id: true,
        returnStatus: true,
        returnRequestedAt: true,
        returnTrackingCode: true,
      },
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
            select: {
              id: true,
              returnStatus: true,
              returnRequestedAt: true,
              returnTrackingCode: true,
            },
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

    const plan = planReturnUpdate(group, order, nowSec);
    if (plan.flagged) result.flagged++;
    if (plan.unflagged) result.unflagged++;
    if (plan.trackingSaved) result.trackingSaved++;

    if (Object.keys(plan.data).length > 0) {
      await prisma.order.update({ where: { id: order.id }, data: plan.data });
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
