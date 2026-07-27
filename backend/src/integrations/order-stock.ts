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
  | "already-restored"
  | "held"
  | "already-held";

// ---------- GIỮ KHO TẠM (Hold Stock) ----------
//
// Đơn sàn mới đổ về nhưng CHƯA chốt (UNPAID/INVOICE_PENDING) chưa được trừ
// thẳng quantityInStock (khách có thể bỏ thanh toán), nhưng cũng không thể coi
// như chưa bán — chờ đến lúc chốt mới trừ là khoảng hở bán vượt kho. Giải pháp
// hai nấc: HOLD ngay khi webhook về (cộng Product.holdQuantity), tồn KHẢ DỤNG
// đẩy lên sàn = quantityInStock − holdQuantity; đơn chốt thì NHẢ hold và trừ
// thật, đơn hủy thì chỉ nhả. Mốc stockHeldAt/stockHoldReleasedAt trên Order
// giữ cho cả hai chiều idempotent khi sàn bắn lại cùng sự kiện.

/**
 * Đặt HOLD cho một đơn ĐÚNG MỘT LẦN. Bỏ qua nếu đã hold, đã trừ thật, hoặc
 * hold đã từng được nhả (đơn đi tiếp vòng đời rồi — không quay lại giữ nữa).
 * Trả về danh sách productId bị tác động để tầng gọi đẩy tồn mới lên sàn.
 */
export async function holdStockTx(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ held: number; outcome: StockOutcome; productIds: string[] }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      stockHeldAt: true,
      stockHoldReleasedAt: true,
      stockDeductedAt: true,
      items: {
        where: { productId: { not: null } },
        select: { productId: true, quantity: true },
      },
    },
  });
  if (!order) return { held: 0, outcome: "none", productIds: [] };
  if (order.stockHeldAt) return { held: 0, outcome: "already-held", productIds: [] };
  if (order.stockDeductedAt || order.stockHoldReleasedAt) {
    return { held: 0, outcome: "none", productIds: [] };
  }

  let held = 0;
  const productIds: string[] = [];
  for (const it of order.items) {
    await tx.product.update({
      where: { id: it.productId! },
      data: { holdQuantity: { increment: it.quantity } },
    });
    held += it.quantity;
    productIds.push(it.productId!);
  }

  // Đánh mốc kể cả khi 0 dòng khớp SKU — tránh quét lại mỗi lần webhook bắn lại.
  await tx.order.update({ where: { id: orderId }, data: { stockHeldAt: new Date() } });
  return { held, outcome: held > 0 ? "held" : "none", productIds };
}

/**
 * NHẢ hold của một đơn (khi đơn chốt → chuyển thành trừ thật, hoặc đơn hủy).
 * Chỉ nhả khi thực sự đang hold; hold/nhả luôn đi theo cặp mốc nên decrement
 * đối xứng, không cần chặn âm.
 */
export async function releaseStockHoldTx(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ released: number; productIds: string[] }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      stockHeldAt: true,
      stockHoldReleasedAt: true,
      items: {
        where: { productId: { not: null } },
        select: { productId: true, quantity: true },
      },
    },
  });
  if (!order?.stockHeldAt || order.stockHoldReleasedAt) {
    return { released: 0, productIds: [] };
  }

  let released = 0;
  const productIds: string[] = [];
  for (const it of order.items) {
    await tx.product.update({
      where: { id: it.productId! },
      data: { holdQuantity: { decrement: it.quantity } },
    });
    released += it.quantity;
    productIds.push(it.productId!);
  }

  await tx.order.update({
    where: { id: orderId },
    data: { stockHoldReleasedAt: new Date() },
  });
  return { released, productIds };
}

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
): Promise<{ deducted: number; outcome: StockOutcome; productIds: string[] }> {
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
  if (!order) return { deducted: 0, outcome: "none", productIds: [] };
  if (order.stockDeductedAt) {
    return { deducted: 0, outcome: "already-deducted", productIds: [] };
  }

  // Đơn đang được HOLD thì nhả trước khi trừ thật — quantityInStock giảm đúng
  // bằng phần holdQuantity trả lại nên tồn KHẢ DỤNG không đổi (sàn đã biết từ
  // lúc hold), không bị trừ đúp.
  const productIds: string[] = [];
  const rel = await releaseStockHoldTx(tx, orderId);
  productIds.push(...rel.productIds);

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
    if (!productIds.includes(it.productId!)) productIds.push(it.productId!);
  }

  // Đánh mốc kể cả khi 0 dòng khớp SKU: coi như đã xử lý, tránh quét lại mỗi webhook.
  await tx.order.update({
    where: { id: orderId },
    data: { stockDeductedAt: new Date() },
  });
  return { deducted, outcome: deducted > 0 ? "deducted" : "none", productIds };
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
): Promise<{ restored: number; outcome: StockOutcome; productIds: string[] }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { stockRestoredAt: true, orderCode: true },
  });
  if (!order) return { restored: 0, outcome: "none", productIds: [] };
  if (order.stockRestoredAt) {
    return { restored: 0, outcome: "already-restored", productIds: [] };
  }

  const deductions = await tx.inventoryLog.findMany({
    where: { orderId, changeQuantity: { lt: 0 } },
  });

  let restored = 0;
  const productIds: string[] = [];
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
    if (!productIds.includes(log.productId)) productIds.push(log.productId);
  }

  if (restored > 0) {
    await tx.order.update({
      where: { id: orderId },
      data: { stockRestoredAt: new Date() },
    });
    return { restored, outcome: "restored", productIds };
  }
  return { restored: 0, outcome: "none", productIds: [] };
}
