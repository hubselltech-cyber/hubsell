// ============================================================
// TÁC ĐỘNG TỒN KHO CHO ĐƠN TỪ SÀN (dùng chung TikTok / Shopee)
//
// Webhook đơn mới/đổi trạng thái cần trừ kho real-time, đơn hủy cần hoàn kho —
// cả hai phải IDEMPOTENT vì sàn retry cùng một sự kiện nhiều lần. Logic này
// từng nằm riêng trong integrations/tiktok/service.ts; tách ra đây khi Shopee
// cũng cần y hệt. `sourceLabel` (vd "webhook TikTok") chỉ để ghi lý do log.
// ============================================================

import type { Prisma } from "@prisma/client";
import { InventoryLogType } from "@prisma/client";

export type StockOutcome =
  | "none"
  | "deducted"
  | "already-deducted"
  | "restored"
  | "already-restored";

/**
 * Trừ kho cho một đơn ĐÚNG MỘT LẦN. Chốt chặn: nếu `stockDeductedAt` đã có thì
 * bỏ qua (webhook đẩy lại nhiều lần). Dùng `decrement` nguyên tử (an toàn khi
 * nhiều đơn cùng trừ một SKU); CHO PHÉP tồn về âm để phơi bày tình trạng bán
 * vượt kho thay vì âm thầm chặn — đơn đã phát sinh thật trên sàn rồi.
 * Chỉ trừ các dòng đã liên kết SKU (productId != null); dòng chưa liên kết bỏ qua.
 */
export async function deductStockTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  sourceLabel: string
): Promise<{ deducted: number; outcome: StockOutcome }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      stockDeductedAt: true,
      orderCode: true,
      items: {
        where: { productId: { not: null } },
        select: { productId: true, quantity: true },
      },
    },
  });
  if (!order) return { deducted: 0, outcome: "none" };
  if (order.stockDeductedAt) return { deducted: 0, outcome: "already-deducted" };

  let deducted = 0;
  for (const it of order.items) {
    await tx.product.update({
      where: { id: it.productId! },
      data: { quantityInStock: { decrement: it.quantity } },
    });
    await tx.inventoryLog.create({
      data: {
        productId: it.productId!,
        changeQuantity: -it.quantity,
        type: InventoryLogType.SYNC,
        reason: `Trừ kho tự động — ${sourceLabel} đơn ${order.orderCode}`,
        orderId,
      },
    });
    deducted += it.quantity;
  }

  // Đánh mốc kể cả khi 0 dòng khớp SKU: coi như đã xử lý, tránh quét lại mỗi webhook.
  await tx.order.update({
    where: { id: orderId },
    data: { stockDeductedAt: new Date() },
  });
  return { deducted, outcome: deducted > 0 ? "deducted" : "none" };
}

/**
 * Hoàn kho khi đơn bị hủy — mirror luồng hủy đơn thủ công ở routes/orders.ts:
 * tìm các bút toán TRỪ kho gắn với đơn, cộng trả lại, ghi mốc `stockRestoredAt`
 * để không hoàn lần hai. Chỉ hoàn khi trước đó thực sự đã trừ.
 */
export async function restoreStockTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  sourceLabel: string
): Promise<{ restored: number; outcome: StockOutcome }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { stockRestoredAt: true, orderCode: true },
  });
  if (!order) return { restored: 0, outcome: "none" };
  if (order.stockRestoredAt) return { restored: 0, outcome: "already-restored" };

  const deductions = await tx.inventoryLog.findMany({
    where: { orderId, changeQuantity: { lt: 0 } },
  });

  let restored = 0;
  for (const log of deductions) {
    const qty = Math.abs(log.changeQuantity);
    await tx.product.update({
      where: { id: log.productId },
      data: { quantityInStock: { increment: qty } },
    });
    await tx.inventoryLog.create({
      data: {
        productId: log.productId,
        changeQuantity: qty,
        type: InventoryLogType.SYNC,
        reason: `Hoàn kho tự động — ${sourceLabel} hủy đơn ${order.orderCode}`,
        orderId,
      },
    });
    restored += qty;
  }

  if (restored > 0) {
    await tx.order.update({
      where: { id: orderId },
      data: { stockRestoredAt: new Date() },
    });
    return { restored, outcome: "restored" };
  }
  return { restored: 0, outcome: "none" };
}
