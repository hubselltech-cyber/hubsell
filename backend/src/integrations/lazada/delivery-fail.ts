// ============================================================
// CỨU ĐƠN GIAO THẤT BẠI — NHÁNH LAZADA (chỉ CẢNH BÁO, 22/08)
//
// Khác Shopee ở cả hai đầu:
//   · PHÁT HIỆN: Lazada không có API đếm từng lượt giao như get_tracking_info
//     — nhưng trạng thái thô của đơn (failed_delivery / shipped_back /
//     shipped_back_success, enum docs GetOrders) đã chảy qua upsert đơn ở CẢ
//     vòng quét 10' LẪN webhook LPM real-time. Móc vào đó là bắt được với
//     0 call API thêm; đổi lại chỉ biết "sàn đã kết luận giao thất bại",
//     không biết số lượt → failCount = 0 (UI hiện "Sàn báo").
//   · HÀNH ĐỘNG: Lazada chưa có chat API cho seller CHỦ ĐỘNG nhắn khách →
//     chỉ chuông + nhật ký; autoChatEnabled đang bật thì ghi SKIPPED kèm lý
//     do cho chủ shop khỏi tưởng hệ thống quên gửi.
//
// Dùng chung bảng DeliveryFailNotice + cấu hình + thẻ điều hành với Shopee
// (helper cấu hình sống ở integrations/shopee/delivery-fail.ts — nơi tính
// năng ra đời; tách file core riêng khi có sàn thứ ba).
// ============================================================

import type { Channel } from "@prisma/client";
import { DeliveryFailChatStatus } from "@prisma/client";
import { notify } from "../../notifications";
import { prisma } from "../../prisma";
import {
  DELIVERY_FAIL_TAB_HREF,
  effectiveDeliveryFailConfig,
} from "../shopee/delivery-fail";
import type { LazadaOrder } from "./client";

/** Trạng thái thô Lazada = sàn đã kết luận giao không thành công. */
const LAZADA_FAILED_STATUSES = new Set([
  "failed_delivery",
  "shipped_back",
  "shipped_back_success",
]);

/** PHẦN THUẦN (có vitest): đơn này có kiện bị sàn báo giao thất bại không. */
export function lazadaOrderDeliveryFailed(statuses?: string[]): boolean {
  return (statuses ?? []).some((s) =>
    LAZADA_FAILED_STATUSES.has(String(s).trim().toLowerCase())
  );
}

/**
 * Gọi SAU transaction upsert đơn (cả vòng quét lẫn webhook): trạng thái chạm
 * nhóm thất bại → tạo notice (orderId unique chống trùng — đơn nằm ở trạng
 * thái này suốt nhiều nhịp quét vẫn chỉ một cảnh báo) + chuông. KHÔNG BAO GIỜ
 * ném lỗi — cảnh báo là tiện ích, không được làm vỡ luồng đồng bộ đơn.
 * Trả true nếu vừa tạo cảnh báo mới.
 */
export async function noticeLazadaDeliveryFail(
  channel: Channel,
  order: LazadaOrder
): Promise<boolean> {
  try {
    // Check thuần trước — đơn bình thường (đại đa số) không tốn query nào.
    if (!lazadaOrderDeliveryFailed(order.statuses)) return false;

    const ownerId = channel.userId;
    const cfg = effectiveDeliveryFailConfig(
      await prisma.deliveryFailConfig.findUnique({ where: { ownerId } })
    );
    if (!cfg.alertEnabled) return false;

    const orderCode = String(order.order_number ?? order.order_id ?? "").trim();
    if (!orderCode) return false;
    const dbOrder = await prisma.order.findUnique({
      where: { channelId_orderCode: { channelId: channel.id, orderCode } },
      select: {
        id: true,
        customerName: true,
        deliveryFailNotice: { select: { id: true } },
      },
    });
    if (!dbOrder || dbOrder.deliveryFailNotice) return false;

    try {
      await prisma.deliveryFailNotice.create({
        data: {
          ownerId,
          orderId: dbOrder.id,
          // 0 = sàn kết luận thất bại nhưng KHÔNG cho biết số lượt (khác
          // Shopee đếm được ≥2) — UI hiện "Sàn báo" thay vì con số.
          failCount: 0,
          ...(cfg.autoChatEnabled
            ? {
                chatStatus: DeliveryFailChatStatus.SKIPPED,
                chatError: "Lazada chưa có API cho shop chủ động nhắn khách",
              }
            : {}),
        },
      });
    } catch (err) {
      // Đua với webhook/vòng quét chạy song song → unique orderId chặn bản
      // thứ hai (P2002): coi như đã có cảnh báo, êm.
      if ((err as { code?: string }).code === "P2002") return false;
      throw err;
    }

    await notify(ownerId, {
      type: "delivery-fail",
      title: `Đơn ${orderCode} bị Lazada báo giao không thành công`,
      body:
        `Gian ${channel.shopName} — khách ${dbOrder.customerName}. ` +
        "Kiện sẽ quay về; chủ động liên hệ khách để cứu đơn hoặc chốt đặt lại.",
      link: DELIVERY_FAIL_TAB_HREF,
    });
    return true;
  } catch (err) {
    console.warn(
      `[Delivery-fail] Lỗi cảnh báo Lazada đơn ${order.order_number ?? order.order_id}:`,
      (err as Error).message
    );
    return false;
  }
}
