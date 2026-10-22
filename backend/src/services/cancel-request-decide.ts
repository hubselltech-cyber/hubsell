// ============================================================
// SHOP QUYẾT YÊU CẦU HỦY CỦA KHÁCH — chấp nhận / từ chối trên 3 sàn (23/10/2026)
//
// Khảo sát + trích docs: docs/HUY-DON-SAU-CHUAN-BI-HANG-KHAO-SAT.md.
//  · Shopee: handle_buyer_cancellation {order_sn, ACCEPT|REJECT} (đơn IN_CANCEL).
//  · TikTok: cancellations/{cancel_id}/approve | /reject (reject cần reason_key
//    hợp lệ của sàn → hỏi reject_reasons trước). cancel_id = cancelRequestRef.
//  · Lazada: /order/reverse/cancel/seller/decide {reverse_order_id, agree_cancel}.
// Sau khi sàn nhận lệnh: KÉO LẠI ĐƠN bằng đúng đường webhook (upsert + hoàn
// kho nếu CANCELLED) rồi hạ cờ — shop đã quyết, không còn gì chờ.
// ============================================================

import { ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { finishStockPush } from "../integrations/inventory-push";
import { CLEAR_CANCEL_REQUEST } from "../integrations/cancel-request";
import { getValidShopeeAccessToken, processShopeeOrderEvent } from "../integrations/shopee/service";
import { handleBuyerCancellation } from "../integrations/shopee/client";
import { getValidAccessToken, processTiktokOrderEvent } from "../integrations/tiktok/service";
import { approveCancellation, getRejectReasons, rejectCancellation } from "../integrations/tiktok/client";
import { syncTiktokCancelRequests } from "../integrations/tiktok/cancel-requests";
import { getValidLazadaAccessToken } from "../integrations/lazada/service";
import { decideReverseOrderCancel } from "../integrations/lazada/client";
import { processLazadaOrderPush } from "../integrations/lazada/webhook";

/** Lỗi nghiệp vụ mang mã HTTP để route trả thẳng cho người dùng. */
export class CancelDecideError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface CancelDecideResult {
  orderCode: string;
  accepted: boolean;
  shippingStatus: string;
  cancelRequestedAt: Date | null;
}

/** Ghi chú gửi kèm khi từ chối trên TikTok (sàn yêu cầu comment tự do kèm reason_key). */
const TIKTOK_REJECT_COMMENT = "Đơn đã được chuẩn bị hàng, shop tiếp tục giao.";

export async function decideCancelRequest(params: {
  ownerId: string;
  allowedChannelIds?: string[] | null;
  orderId: string;
  accept: boolean;
}): Promise<CancelDecideResult> {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, channel: { userId: params.ownerId } },
    include: { channel: true },
  });
  if (!order) throw new CancelDecideError(404, "Không tìm thấy đơn hàng");
  if (params.allowedChannelIds && !params.allowedChannelIds.includes(order.channelId)) {
    throw new CancelDecideError(403, "Bạn không có quyền xử lý đơn của kênh này");
  }
  if (!order.cancelRequestedAt) {
    throw new CancelDecideError(409, "Đơn này không có yêu cầu hủy đang chờ (sàn có thể đã tự chốt — tải lại danh sách)");
  }
  const channel = order.channel;
  const verb = params.accept ? "chấp nhận" : "từ chối";

  try {
    switch (channel.channelName) {
      case ChannelName.SHOPEE: {
        const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
        await handleBuyerCancellation(accessToken, shopId, order.orderCode, params.accept ? "ACCEPT" : "REJECT");
        // Kéo lại đơn đúng đường webhook: ACCEPT → CANCELLED + hoàn kho; REJECT → về trạng thái cũ, hạ cờ.
        const r = await processShopeeOrderEvent(channel, order.orderCode);
        await finishStockPush(r.stockTicket);
        break;
      }
      case ChannelName.TIKTOK: {
        if (!order.cancelRequestRef) {
          throw new CancelDecideError(409, "Chưa có mã yêu cầu hủy của TikTok cho đơn này — đợi đồng bộ rồi thử lại");
        }
        const { accessToken, shopCipher } = await getValidAccessToken(channel);
        const idempotencyKey = `hubsell-${order.id}-${order.cancelRequestRef}-${params.accept ? "approve" : "reject"}`;
        if (params.accept) {
          await approveCancellation({ accessToken, shopCipher, cancelId: order.cancelRequestRef, idempotencyKey });
        } else {
          const reasons = await getRejectReasons({ accessToken, shopCipher, orderId: order.orderCode });
          const picked =
            reasons.find((x) => /ship|giao|gửi|packed|đóng gói/i.test(`${x.reason_text ?? ""}`)) ?? reasons[0];
          if (!picked?.reason_key) {
            throw new CancelDecideError(502, "TikTok không trả lý do từ chối nào cho đơn này — từ chối trên Seller Center");
          }
          console.log(`[cancel-decide] TikTok reject đơn ${order.orderCode} reason_key=${picked.reason_key}`);
          await rejectCancellation({
            accessToken,
            shopCipher,
            cancelId: order.cancelRequestRef,
            idempotencyKey,
            rejectReason: String(picked.reason_key),
            comment: TIKTOK_REJECT_COMMENT,
          });
        }
        const r = await processTiktokOrderEvent(channel, order.orderCode);
        await finishStockPush(r.stockTicket);
        await syncTiktokCancelRequests(channel, { orderIds: [order.orderCode] });
        break;
      }
      case ChannelName.LAZADA: {
        if (!order.cancelRequestRef) {
          throw new CancelDecideError(409, "Chưa có mã yêu cầu hủy (reverse_order_id) của Lazada cho đơn này — đợi đồng bộ rồi thử lại");
        }
        const accessToken = await getValidLazadaAccessToken(channel);
        await decideReverseOrderCancel({ accessToken, reverseOrderId: order.cancelRequestRef, agree: params.accept });
        await processLazadaOrderPush(channel, order.orderCode);
        break;
      }
      default:
        throw new CancelDecideError(400, "Chỉ đơn Shopee / TikTok / Lazada mới có yêu cầu hủy từ sàn");
    }
  } catch (err) {
    if (err instanceof CancelDecideError) throw err;
    const msg = (err as Error).message || "lỗi không rõ";
    console.error(`[cancel-decide] ${channel.channelName} ${verb} đơn ${order.orderCode} lỗi:`, msg);
    throw new CancelDecideError(502, `Sàn không nhận lệnh ${verb}: ${msg}`);
  }

  // Shop đã quyết: hạ cờ nếu đồng bộ vừa rồi chưa hạ (sàn chốt trễ vài giây).
  const after = await prisma.order.update({
    where: { id: order.id },
    data: { ...CLEAR_CANCEL_REQUEST },
    select: { shippingStatus: true, cancelRequestedAt: true },
  });
  console.log(`[cancel-decide] ${channel.channelName} ${verb} đơn ${order.orderCode} → ${after.shippingStatus}`);
  return {
    orderCode: order.orderCode,
    accepted: params.accept,
    shippingStatus: after.shippingStatus,
    cancelRequestedAt: after.cancelRequestedAt,
  };
}
