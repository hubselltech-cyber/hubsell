// ============================================================
// VIỆC SỰ KIỆN SHOPEE của hàng đợi bền pg-boss (workers/event-queue.ts,
// docs/HANG-DOI-BEN.md mục 4.4).
//
// Route (routes/webhooks.ts) kiểm chữ ký, ghi webhook_events + xếp việc evt.order
// / evt.auth trong một giao dịch rồi ack; worker gọi các hàm dưới đây.
//
// Trước 05/10/2026 tệp này còn chứa hàng đợi cũ trên bảng shopee_webhook_logs
// (một luồng FIFO + việc đối soát tồn nhét chung bảng). Đường đó đã gỡ ở bước 6b;
// bảng còn giữ tới sau 31/10/2026 chỉ để HQ tra nhật ký cũ.
// ============================================================

import { findShopeeChannelByShopId, processShopeeAuthorizationEvent, processShopeeOrderEvent } from "./service";
import { syncShopeeEscrowEstimateForOrder } from "./settlements";
import { createSyncAlert } from "./inventory-sync";
import { finishStockPush } from "../inventory-push";
import { describeChannelFailure } from "../../services/sync-alert-text";

/**
 * Kéo lại MỘT đơn Shopee rồi upsert + tác động kho, xếp việc đẩy tồn, kéo phí
 * tạm tính. Ném lỗi = hỏng lượt này (hàng đợi tự thử lại); trả ghi chú khi
 * không có gì để làm, null khi trọn vẹn.
 */
export async function handleShopeeOrderJob(
  shopId: string,
  orderSn: string,
  trackingNo?: string
): Promise<string | null> {
  const channel = await findShopeeChannelByShopId(shopId);
  if (!channel) return "shop chưa kết nối Hubsell";

  const result = await processShopeeOrderEvent(channel, orderSn, { trackingNo: trackingNo || undefined });
  console.log(
    `[Webhook Shopee] đơn ${orderSn} (shop ${shopId}) →`,
    JSON.stringify({ ...result, stockTicket: undefined, stockSync: result.stockSync ? result.stockSync.productIds.length : undefined })
  );

  // Dòng chờ đẩy đã lập phiếu trong giao dịch đơn — chốt phiếu sau commit.
  await finishStockPush(result.stockTicket);

  // PHÍ TẠM TÍNH REAL-TIME — best-effort: lỗi chỉ ghi log, vòng
  // quét ước tính sẽ vét lại, KHÔNG làm hỏng việc đã xử lý xong đơn.
  try {
    await syncShopeeEscrowEstimateForOrder(channel, orderSn);
  } catch (err) {
    console.warn(
      `[Webhook Shopee] Chưa lấy được phí ước tính đơn ${orderSn} (vòng quét sẽ vét lại):`,
      (err as Error).message
    );
  }
  return result.found ? null : "sàn không trả chi tiết đơn";
}

/** Sự kiện ủy quyền / thu hồi ủy quyền của một shop. */
export async function handleShopeeAuthJob(shopId: string): Promise<string | null> {
  const r = await processShopeeAuthorizationEvent(shopId);
  console.log(`[Webhook Shopee] Uỷ quyền shop ${shopId} →`, r?.status ?? "shop chưa nối");
  return r ? null : "shop chưa kết nối Hubsell";
}

/** Việc của hàng đợi bền hỏng hẳn sau khi hết lượt thử — cảnh báo lên UI cho chủ shop xử lý tay. */
export async function alertShopeeJobFailed(
  shopId: string,
  orderSn: string | null,
  attempts: number,
  message: string
): Promise<void> {
  const channel = await findShopeeChannelByShopId(shopId).catch(() => null);
  if (!channel) return; // shop chưa nối Hubsell — không có chỗ treo cảnh báo
  await createSyncAlert(channel.id, {
    orderSn: orderSn ?? undefined,
    message: describeChannelFailure(
      channel.shopName,
      `sự kiện Shopee${orderSn ? ` đơn ${orderSn}` : ""} xử lý thất bại sau ${attempts} lần: ${message}`
    ),
  });
}
