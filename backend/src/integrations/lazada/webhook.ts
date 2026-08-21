// ============================================================
// LAZADA WEBHOOK (Push Mechanism / LPM) — CHỮ KÝ + PAYLOAD + XỬ LÝ ĐƠN
//
// Lazada push JSON khi đơn đổi trạng thái, ràng buộc GẮT: ack 200 trong 500ms
// (trượt thì retry mỗi 30 phút, tối đa 12 lần rồi bỏ). Route vì thế chỉ verify
// chữ ký + ack; việc nặng (gọi API lấy chi tiết đơn + upsert DB) chạy NỀN
// fire-and-forget — sự kiện lỡ (crash giữa chừng) đã có worker order-auto-sync
// 10 phút vét lại, đúng khuyến nghị "consume push, but pull with low frequency
// to protect from missing" trong tài liệu LPM.
//
// Chữ ký: header `Authorization` = HEX( HMAC-SHA256(app_secret, app_key + RAW_BODY) )
// — KHÔNG có URL trong chuỗi ký (khác Shopee). Bắt buộc kiểm trên req.rawBody:
// JSON.parse rồi serialize lại là sai chữ ký.
// ============================================================

import crypto from "crypto";
import type { Channel } from "@prisma/client";
import { prisma } from "../../prisma";
import { getLazadaConfig, type LazadaConfig } from "./config";
import { getMultipleOrderItems, getOrder } from "./client";
import { getValidLazadaAccessToken, upsertLazadaOrderTx } from "./service";
import { noticeLazadaDeliveryFail } from "./delivery-fail";
import { enqueueStockPush } from "../inventory-push";

// ---------- 1. Xác thực chữ ký ----------

/**
 * Kiểm chữ ký push Lazada trên body THÔ. So sánh timingSafeEqual chống timing
 * attack. `cfg` truyền được từ ngoài để unit test không phụ thuộc env.
 */
export function verifyLazadaWebhookSignature(
  rawBody: Buffer | string,
  authorizationHeader: string | undefined,
  cfg: LazadaConfig = getLazadaConfig()
): boolean {
  if (!authorizationHeader) return false;
  const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto
    .createHmac("sha256", cfg.appSecret)
    .update(cfg.appKey + bodyStr)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(authorizationHeader.trim().toLowerCase(), "utf8");
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  // Log chẩn đoán khi trượt: in body base64 + chữ ký nhận (MAC không lộ key,
  // payload push không chứa bí mật). KHÔNG bao giờ in key.
  console.warn(
    `[Webhook Lazada] Chữ ký không khớp — sig=${authorizationHeader.trim()}, ` +
      `bodyB64=${Buffer.from(bodyStr, "utf8").toString("base64")}`
  );
  return false;
}

// ---------- 2. Payload ----------

/**
 * Payload push LPM (message_type 0 = đơn hàng — loại DUY NHẤT Lazada đang bật;
 * product/stock ghi trong docs là "đang phát triển"). Cả message đơn thuận
 * (trade) lẫn đơn hoàn/huỷ (reverse) đều mang `trade_order_id` = order_id API.
 */
export interface LazadaPushPayload {
  seller_id?: number | string;
  message_type?: number;
  data?: {
    order_status?: string;
    status_update_time?: number;
    trade_order_id?: number | string;
    trade_order_line_id?: number | string;
    /** Chỉ có ở reverse order message (hoàn/huỷ). */
    reverse_order_id?: number | string;
    reverse_order_line_id?: number | string;
    [k: string]: unknown;
  };
  timestamp?: number;
  site?: string; // vd "lazada_vn"
  [k: string]: unknown;
}

export const LAZADA_MSG_ORDER = 0;

// ---------- 3. Xử lý sự kiện đơn (chạy NỀN, sau khi đã ack) ----------

/**
 * Kéo chi tiết một đơn từ API rồi upsert vào DB — dùng chung upsertLazadaOrderTx
 * với luồng đồng bộ lô nên idempotent tuyệt đối (LPM là "at least once", push
 * trùng là bình thường). Tồn kho biến động ngay trong transaction (hold/trừ/
 * hoàn — xem applyLazadaStockTx); SAU commit xếp job đẩy tồn khả dụng mới lên
 * các sàn đã liên kết.
 */
export async function processLazadaOrderPush(
  channel: Channel,
  tradeOrderId: string
): Promise<{ created: boolean; itemsCreated: number } | { skipped: string }> {
  const accessToken = await getValidLazadaAccessToken(channel);
  const order = await getOrder(accessToken, tradeOrderId);
  if (!order) return { skipped: "Lazada không trả dữ liệu đơn" };
  const items =
    (await getMultipleOrderItems(accessToken, [tradeOrderId])).get(
      String(tradeOrderId)
    ) ?? [];
  const outcome = await prisma.$transaction((tx) =>
    upsertLazadaOrderTx(tx, channel, order, items)
  );
  if (outcome.stockSync) {
    await enqueueStockPush(outcome.stockSync.productIds, {
      source: `webhook Lazada đơn ${order.order_number ?? tradeOrderId}`,
      oldAvailable: outcome.stockSync.oldAvailable,
    });
  }
  // Sàn báo giao không thành công → chuông Cứu đơn giao thất bại ngay theo
  // nhịp webhook (real-time hơn vòng quét 10'). Tự nuốt lỗi, không chặn ack.
  await noticeLazadaDeliveryFail(channel, order);
  return outcome;
}

/**
 * Tìm mọi gian Lazada đã uỷ quyền ứng với seller_id trong push. findMany vì
 * unique là (userId, sàn, shop_id) — cùng một shop về lý thuyết nối được vào
 * nhiều tài khoản Hubsell.
 */
export async function findLazadaChannelsBySellerId(sellerId: string) {
  return prisma.channel.findMany({
    where: {
      channelName: "LAZADA",
      externalShopId: sellerId,
      refreshToken: { not: null },
    },
  });
}
