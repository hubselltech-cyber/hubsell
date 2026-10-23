// ============================================================
// TIKTOK — YÊU CẦU HỦY CỦA NGƯỜI MUA CHỜ SHOP DUYỆT (23/10/2026)
//
// Docs (docs/HUY-DON-SAU-CHUAN-BI-HANG-KHAO-SAT.md): khách chỉ xin hủy khi đơn
// còn AWAITING_SHIPMENT; sau 1 giờ hối hận, yêu cầu (cancel_type BUYER_CANCEL,
// cancel_status CANCELLATION_REQUEST_PENDING) chờ shop 48 h, im lặng = sàn tự
// chấp nhận. Webhook type 11 chỉ báo "có đổi", không mang chi tiết → hỏi
// cancellations/search theo order_ids; lượt auto-sync quét PENDING theo cửa sổ
// biến động làm lưới đỡ (webhook rơi). Trục cờ: cancelRequestedAt/Ref/Reason/
// DueAt trên Order; cancel_id là thứ API approve/reject cần (KHÔNG phải order_id).
// ============================================================

import type { Channel, Prisma } from "@prisma/client";
import { ShippingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { CLEAR_CANCEL_REQUEST, notifyCancelRequest } from "../cancel-request";
import { searchCancellations, type TikTokCancellation } from "./client";
import { getValidAccessToken } from "./service";

/** Sàn tự chấp nhận sau 48 h (Policy for Responding to Buyer Requests). */
export const TIKTOK_CANCEL_DECISION_WINDOW_MS = 48 * 60 * 60 * 1000;

const PENDING = "CANCELLATION_REQUEST_PENDING";

let shapeLogged = false;
function logShapeOnce(sample: TikTokCancellation): void {
  if (shapeLogged) return;
  shapeLogged = true;
  console.log("[TikTok cancel] hình dạng cancellation (lần đầu):", JSON.stringify(sample).slice(0, 800));
}

/** Yêu cầu hủy do NGƯỜI MUA mở và còn chờ shop. */
export function isPendingBuyerCancel(c: TikTokCancellation): boolean {
  const status = (c.cancel_status ?? "").toUpperCase();
  if (status !== PENDING) return false;
  const type = (c.cancel_type ?? "").toUpperCase();
  const who = (c.role ?? c.cancel_user ?? "").toString().toUpperCase();
  // BUYER_CANCEL là đủ; thiếu type (payload lạ) thì nhìn người mở.
  if (type) return type === "BUYER_CANCEL";
  return who === "BUYER" || who === "";
}

export interface TiktokCancelFlagState {
  id: string;
  orderCode: string;
  shippingStatus: ShippingStatus;
  cancelRequestedAt: Date | null;
  cancelRequestRef: string | null;
}

export interface TiktokCancelPlan {
  orderId: string;
  orderCode: string;
  data: Prisma.OrderUpdateInput;
  flagged: boolean;
  unflagged: boolean;
  reason: string | null;
  dueAt: Date | null;
}

/**
 * QUYẾT ĐỊNH thuần cho MỘT đơn từ các yêu cầu hủy sàn trả về (có thể nhiều,
 * khách rút rồi mở lại). Bật cờ khi có yêu cầu người mua còn chờ và đơn còn
 * Chờ xử lý; hạ cờ khi không còn yêu cầu chờ nào. Idempotent.
 */
export function planTiktokCancelFlag(
  order: TiktokCancelFlagState,
  cancellations: TikTokCancellation[],
  now: Date
): TiktokCancelPlan | null {
  const pending = cancellations
    .filter(isPendingBuyerCancel)
    .sort((a, b) => Number(b.create_time ?? 0) - Number(a.create_time ?? 0))[0];
  const base = { orderId: order.id, orderCode: order.orderCode, reason: null, dueAt: null };

  // Sàn còn trả yêu cầu chờ thì bật cờ dù đơn đã chuẩn bị (23/10 tối: thực tế khách
  // hủy được sau chuẩn bị; chỉ bỏ qua đơn đã hủy / đã giao).
  if (
    pending &&
    order.shippingStatus !== ShippingStatus.CANCELLED &&
    order.shippingStatus !== ShippingStatus.DELIVERED
  ) {
    const ref = pending.cancel_id ? String(pending.cancel_id) : null;
    const reason = (pending.cancel_reason_text || pending.cancel_reason || "").toString().trim() || null;
    const createdMs = Number(pending.create_time ?? 0) > 0 ? Number(pending.create_time) * 1000 : now.getTime();
    const dueMs =
      Number(pending.seller_next_response_due_time ?? 0) > 0
        ? Number(pending.seller_next_response_due_time) * 1000
        : createdMs + TIKTOK_CANCEL_DECISION_WINDOW_MS;
    // Đã có cờ cùng mã yêu cầu → không ghi lại (tránh đổi mốc, tránh rung chuông lần 2).
    if (order.cancelRequestedAt && order.cancelRequestRef === ref) return null;
    return {
      ...base,
      data: {
        cancelRequestedAt: new Date(createdMs),
        cancelRequestReason: reason,
        cancelRequestRef: ref,
        cancelRequestDueAt: new Date(dueMs),
      },
      flagged: !order.cancelRequestedAt,
      unflagged: false,
      reason,
      dueAt: new Date(dueMs),
    };
  }

  if (order.cancelRequestedAt) {
    return { ...base, data: { ...CLEAR_CANCEL_REQUEST }, flagged: false, unflagged: true };
  }
  return null;
}

export interface SyncTiktokCancelResult {
  scanned: number;
  flagged: number;
  unflagged: number;
  ordersNotFound: number;
}

const FLAG_SELECT = {
  id: true,
  orderCode: true,
  shippingStatus: true,
  cancelRequestedAt: true,
  cancelRequestRef: true,
} satisfies Prisma.OrderSelect;

/**
 * Hỏi sàn rồi phản ánh vào Order. Hai cách gọi:
 *  · `orderIds`: sau webhook type 11 / sau khi shop vừa quyết — hỏi đúng đơn đó;
 *  · `sinceMs`: lượt auto-sync — quét yêu cầu BIẾN ĐỘNG từ mốc đó, đồng thời hạ
 *    cờ các đơn đang cờ mà sàn không còn báo chờ (webhook rơi, khách rút).
 */
export async function syncTiktokCancelRequests(
  channel: Channel,
  opts: { orderIds?: string[]; sinceMs?: number; historical?: boolean } = {}
): Promise<SyncTiktokCancelResult> {
  const result: SyncTiktokCancelResult = { scanned: 0, flagged: 0, unflagged: 0, ordersNotFound: 0 };
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const now = new Date();

  // (1) Gom yêu cầu theo mã đơn.
  const byOrder = new Map<string, TikTokCancellation[]>();
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await searchCancellations({
      accessToken,
      shopCipher,
      orderIds: opts.orderIds,
      ...(opts.sinceMs ? { updateTimeGe: Math.floor(opts.sinceMs / 1000) } : {}),
      pageToken,
    });
    for (const c of r.cancellations) {
      logShapeOnce(c);
      const code = String(c.order_id ?? "").trim();
      if (!code) continue;
      const list = byOrder.get(code);
      if (list) list.push(c);
      else byOrder.set(code, [c]);
    }
    result.scanned += r.cancellations.length;
    pageToken = r.next_page_token || undefined;
    if (!pageToken || r.cancellations.length === 0) break;
  }

  // (2) Đơn cần xét = đơn sàn vừa báo + (lượt quét) đơn đang cờ của gian.
  const codes = new Set<string>([...byOrder.keys(), ...(opts.orderIds ?? [])]);
  const orders = await prisma.order.findMany({
    where: {
      channelId: channel.id,
      OR: [
        { orderCode: { in: [...codes] } },
        ...(opts.sinceMs ? [{ cancelRequestedAt: { not: null } }] : []),
      ],
    },
    select: FLAG_SELECT,
  });
  const found = new Set(orders.map((o) => o.orderCode));
  for (const code of codes) if (!found.has(code)) result.ordersNotFound++;

  for (const order of orders) {
    const plan = planTiktokCancelFlag(order, byOrder.get(order.orderCode) ?? [], now);
    if (!plan) continue;
    await prisma.order.update({ where: { id: order.id }, select: { id: true }, data: plan.data });
    if (plan.flagged) {
      result.flagged++;
      if (!opts.historical) {
        await notifyCancelRequest(channel, order.orderCode, plan.reason, plan.dueAt, { prevStatus: order.shippingStatus });
      }
    }
    if (plan.unflagged) result.unflagged++;
  }
  return result;
}
