// ============================================================
// HỎI SÀN ĐÚNG MỘT ĐƠN KHI KHO QUÉT KIỆN MÀ ĐƠN CÒN "KHÔNG HOÀN" (lát C, 29/10/2026)
//
// docs/DON-HOAN-VA-SAO-KE.md mục 8: màn Quét đơn hoàn tra đơn trong DB; đơn
// thấy mà trục hoàn còn NONE thì trước đây trả "Không hoàn" ngay, dù sàn đã báo
// (webhook còn nằm trong hàng đợi 10–50 phút lúc kẹt, hoặc lượt quét yêu cầu
// hoàn chưa tới nhịp). Lát A (hủy sau giao = Chờ hàng về) và lát B (webhook
// type 12 hỏi ngay) đã bịt phần lớn; đây là lưới đỡ cuối: kiện ĐÃ RỜI SHOP
// (đang giao / đã giao) mà còn NONE → hỏi sàn đúng đơn này MỘT lần rồi tra lại.
//
// Hai bước, mỗi sàn 2–3 call: (1) kéo lại chi tiết đơn qua đúng đường webhook
// (upsert + tác động kho + luật lát A), (2) hỏi yêu cầu hoàn theo mã đơn. Lỗi
// ở bước nào cũng nuốt + log — lượt quét chỉ mất thêm vài giây, không bao giờ
// hỏng vì sàn. Nghỉ 5 phút mỗi đơn (bộ nhớ tiến trình, mất khi khởi động lại
// là vô hại) để quét lặp cùng kiện không đốt quota.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import { isHibernated } from "../services/plan-hibernation";
import { finishStockPush } from "./inventory-push";
import { isShopeeConfigured } from "./shopee/config";
import { processShopeeOrderEvent } from "./shopee/service";
import { syncShopeeReturnsForOrder } from "./shopee/returns-sync";
import { isTikTokConfigured } from "./tiktok/config";
import { processTiktokOrderEvent } from "./tiktok/service";
import { syncTiktokReturnsForOrders } from "./tiktok/returns-sync";
import { isLazadaConfigured } from "./lazada/config";
import { processLazadaOrderPush } from "./lazada/webhook";
import { syncLazadaReturnsForOrder } from "./lazada/returns-sync";

/** Mỗi đơn chỉ hỏi sàn một lần trong khoảng này (quét lặp, quét trùng). */
export const RETURN_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
/** Trần số đơn nhớ mốc — vượt thì bỏ mốc cũ nhất (Map giữ thứ tự chèn). */
const MAX_REMEMBERED = 5_000;
const lastRefreshAt = new Map<string, number>();

/** Kiện đã rời shop (đã bàn giao / đã giao) mà trục hoàn còn trống → đáng hỏi sàn. */
export function needsReturnRefresh(order: { shippingStatus: ShippingStatus; returnStatus: ReturnStatus }): boolean {
  return (
    order.returnStatus === ReturnStatus.NONE &&
    (order.shippingStatus === ShippingStatus.SHIPPING || order.shippingStatus === ShippingStatus.DELIVERED)
  );
}

/** Đơn vừa hỏi trong cooldown thì bỏ qua; ngược lại ghi mốc và cho hỏi. Thuần theo `now`. */
export function claimReturnRefresh(orderId: string, now: number = Date.now()): boolean {
  const last = lastRefreshAt.get(orderId);
  if (last !== undefined && now - last < RETURN_REFRESH_COOLDOWN_MS) return false;
  lastRefreshAt.delete(orderId);
  lastRefreshAt.set(orderId, now);
  if (lastRefreshAt.size > MAX_REMEMBERED) {
    const oldest = lastRefreshAt.keys().next().value;
    if (oldest !== undefined) lastRefreshAt.delete(oldest);
  }
  return true;
}

/** Chỉ dùng cho test. */
export function resetReturnRefreshMemory(): void {
  lastRefreshAt.clear();
}

/** Gian có hỏi sàn được không: sàn API thật, đang nối, còn token, không ngủ đông, app có cấu hình. */
export function canAskPlatform(channel: Channel): boolean {
  if (channel.status !== "ACTIVE" || !channel.refreshToken || isHibernated(channel)) return false;
  switch (channel.channelName) {
    case ChannelName.SHOPEE:
      return isShopeeConfigured();
    case ChannelName.TIKTOK:
      return isTikTokConfigured();
    case ChannelName.LAZADA:
      return isLazadaConfigured();
    default:
      return false;
  }
}

export interface ReturnRefreshOutcome {
  /** Có hỏi sàn (ít nhất một bước chạy) — tầng gọi tra lại đơn. */
  asked: boolean;
  /** Vì sao không hỏi (cooldown / gian không hỏi được) — để log. */
  skipped?: string;
  orderRefreshed: boolean;
  returnsChecked: boolean;
}

/**
 * Hỏi sàn đúng một đơn: kéo lại chi tiết đơn rồi hỏi yêu cầu hoàn. Không ném
 * lỗi; từng bước lỗi thì log và đi tiếp.
 */
export async function refreshReturnStateForOrder(
  channel: Channel,
  order: { id: string; orderCode: string },
  now: number = Date.now()
): Promise<ReturnRefreshOutcome> {
  const out: ReturnRefreshOutcome = { asked: false, orderRefreshed: false, returnsChecked: false };
  if (!canAskPlatform(channel)) return { ...out, skipped: "gian không hỏi sàn được" };
  if (!claimReturnRefresh(order.id, now)) return { ...out, skipped: "vừa hỏi trong 5 phút" };
  out.asked = true;
  const tag = `[Lookup] Hỏi sàn đơn ${order.orderCode} gian "${channel.shopName}"`;

  // (1) Chi tiết đơn — đúng đường webhook: upsert + kho + luật lát A (hủy sau giao).
  try {
    if (channel.channelName === ChannelName.TIKTOK) {
      const r = await processTiktokOrderEvent(channel, order.orderCode);
      await finishStockPush(r.stockTicket);
      out.orderRefreshed = r.found;
    } else if (channel.channelName === ChannelName.SHOPEE) {
      const r = await processShopeeOrderEvent(channel, order.orderCode);
      await finishStockPush(r.stockTicket);
      out.orderRefreshed = r.found;
    } else {
      const r = await processLazadaOrderPush(channel, order.orderCode);
      out.orderRefreshed = !("skipped" in r);
    }
  } catch (err) {
    console.warn(`${tag}: chi tiết đơn lỗi:`, (err as Error).message);
  }

  // (2) Yêu cầu hoàn theo mã đơn.
  try {
    if (channel.channelName === ChannelName.TIKTOK) {
      const r = await syncTiktokReturnsForOrders(channel, [order.orderCode]);
      out.returnsChecked = true;
      if (r.flagged || r.unflagged) console.log(`${tag}: +${r.flagged} chờ về tay, ${r.unflagged} hạ cờ (${r.scanned} yêu cầu)`);
    } else if (channel.channelName === ChannelName.SHOPEE) {
      const r = await syncShopeeReturnsForOrder(channel, order.orderCode);
      out.returnsChecked = true;
      if (r.flagged || r.unflagged) console.log(`${tag}: +${r.flagged} chờ về tay, ${r.unflagged} hạ cờ (${r.scanned} yêu cầu)`);
    } else {
      const r = await syncLazadaReturnsForOrder(channel, order.orderCode);
      out.returnsChecked = true;
      if (r.flagged || r.unflagged) console.log(`${tag}: +${r.flagged} chờ về tay, ${r.unflagged} hạ cờ (${r.scanned} yêu cầu)`);
    }
  } catch (err) {
    console.warn(`${tag}: yêu cầu hoàn lỗi:`, (err as Error).message);
  }
  return out;
}
