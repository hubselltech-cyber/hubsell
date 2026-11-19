// ============================================================
// TÁC ĐỘNG TỒN KHO CHO ĐƠN TỪ SÀN (dùng chung TikTok / Shopee)
//
// Webhook đơn mới/đổi trạng thái cần trừ kho real-time, đơn hủy cần hoàn kho —
// cả hai phải IDEMPOTENT vì sàn retry cùng một sự kiện nhiều lần. Logic này
// từng nằm riêng trong integrations/tiktok/service.ts; tách ra đây khi Shopee
// cũng cần y hệt. `sourceLabel` (vd "webhook TikTok") chỉ để ghi lý do log.
// ============================================================

import type { Prisma } from "@prisma/client";
import { InventoryLogType, ReturnStatus, ShippingStatus } from "@prisma/client";
import { applyStockDelta, getStockSettings, stockCommittedOn } from "../services/stock-ledger";
import { adjustCommittedForOrdersTx, logShippedOrdersTx } from "../services/stock-committed";
import { CANCELLED_AFTER_SHIP } from "./cancelled-after-ship";

export type StockOutcome =
  | "none"
  | "deducted"
  | "already-deducted"
  | "restored"
  | "already-restored"
  // Hủy sau khi hàng rời kho, shop ở chế độ "cộng khi kho nhận kiện": chưa cộng, đơn chờ hàng về.
  | "awaiting-return"
  | "held"
  | "already-held";

/**
 * KHOÁ DÒNG ĐƠN (SELECT ... FOR UPDATE) — chốt chặn race condition.
 *
 * Các hàm dưới đây đều theo mẫu "đọc mốc idempotent → biến đổi kho → ghi mốc".
 * Không có khoá, hai webhook của CÙNG một đơn chạy song song (sàn bắn lại khi
 * mạng lag, hoặc nhiều instance backend) có thể cùng đọc mốc = null rồi cùng
 * trừ kho — trừ ĐÚP. Khoá dòng Order ngay đầu transaction buộc kẻ đến sau phải
 * đợi kẻ đến trước COMMIT xong mới đọc được mốc (lúc này đã có) và bỏ qua.
 *
 * Khoá theo DÒNG ĐƠN chứ không theo sản phẩm: hai ĐƠN KHÁC NHAU không chặn
 * nhau (tăng thông lượng); tranh chấp trên cùng sản phẩm đã có UPDATE
 * increment/decrement nguyên tử của Postgres lo. Gọi lặp trong cùng một
 * transaction (deduct → release hold) không sao — khoá đã giữ sẵn.
 */
async function lockOrderRow(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}

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
  await lockOrderRow(tx, orderId);
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
  await lockOrderRow(tx, orderId);
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
  await lockOrderRow(tx, orderId);
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
  // Trừ theo thứ tự mã cố định: hai đơn cùng chứa A và B luôn khóa A trước B, không khóa chéo
  // nhau (và không khóa chéo với lượt quét bù của bộ đếm giữ, cũng đi theo id tăng dần).
  const items = [...order.items].sort((x, y) => (x.productId! < y.productId! ? -1 : x.productId! > y.productId! ? 1 : 0));
  for (const it of items) {
    // Đợt B: sổ kho tự phân bổ theo thứ tự ưu tiên vị trí (nếu shop dùng vị trí)
    // và ghi vị trí vào nhật ký để hủy đơn trả về đúng chỗ.
    await applyStockDelta(tx, {
      productId: it.productId!,
      delta: -it.quantity,
      type: InventoryLogType.SYNC,
      reason: `Trừ kho tự động — ${sourceLabel} đơn ${order.orderCode}`,
      orderId,
      // Lát 1 chạy bóng: hàng vừa trừ khỏi tồn bán còn nằm trong kho → vào bộ đếm "đang giữ".
      reserve: true,
    });
    deducted += it.quantity;
    if (!productIds.includes(it.productId!)) productIds.push(it.productId!);
  }

  // Đánh mốc kể cả khi 0 dòng khớp SKU: coi như đã xử lý, tránh quét lại mỗi webhook.
  // stockCommittedAt chỉ đánh khi thật sự có hàng vào bộ đếm giữ.
  const now = new Date();
  await tx.order.update({
    where: { id: orderId },
    data: {
      stockDeductedAt: now,
      ...(deducted > 0 && stockCommittedOn() ? { stockCommittedAt: now } : {}),
    },
  });
  return { deducted, outcome: deducted > 0 ? "deducted" : "none", productIds };
}

// ============================================================
// HỦY ĐƠN + NHẬN HÀNG HOÀN — kho chuẩn quốc tế LÁT 2 (20/11/2026, docs mục 5.2 + 15)
//
// Một bộ hàm có khóa dòng đơn cho MỌI đường: webhook sàn báo hủy, hủy tay, nhận hàng hoàn lẻ,
// nhập kho hàng hoàn theo lô. Luật:
//   • Hủy khi hàng CHƯA rời kho  → nhả giữ + cộng lại sổ ngay (như cũ).
//   • Hủy khi hàng ĐÃ rời kho    → theo cài đặt của shop (shop_sync_settings.restockOnReturn):
//       ON_CANCEL  (mặc định, cách cũ): cộng lại sổ ngay lúc sàn báo hủy;
//       ON_RECEIVE (chuẩn): KHÔNG cộng; đơn vào "Chờ hàng về", kho nhận kiện nguyên vẹn mới cộng.
//   • Mốc stockRestoredAt đọc DƯỚI khóa dòng đơn → hủy tay × webhook hủy × nhận hoàn chạy đua
//     nhau cũng chỉ cộng đúng một lần.
// ============================================================

/** Một dòng đã cộng lại sổ (cho câu trả lời của route và để đẩy tồn). */
export interface RestoredLine {
  productId: string;
  productName: string;
  restoredQuantity: number;
  newQuantity: number;
}

/**
 * Hàng của đơn đã thật sự RỜI KHO chưa. Ba dấu, có một là đủ:
 *   • sàn hủy đơn đang giao / đã giao (cờ CANCELLED_AFTER_SHIP do hàm ghi đơn cắm);
 *   • có mốc rời kho của lát 1 (Biên bản bàn giao / sàn báo / đổi tay) — trừ nguồn
 *     CHANNEL_INACTIVE: đó là gian chết nên thôi giữ, hàng chưa hề đi đâu;
 *   • trạng thái đang lưu là Đang giao / Đã giao (đường hủy tay: trạng thái chưa bị ghi đè).
 */
export function orderLeftWarehouse(o: {
  stockShippedAt: Date | null;
  stockShipSource: string | null;
  platformReturnStatus: string | null;
  shippingStatus: ShippingStatus;
}): boolean {
  if (o.platformReturnStatus === CANCELLED_AFTER_SHIP) return true;
  if (o.stockShippedAt && o.stockShipSource !== "CHANNEL_INACTIVE") return true;
  return hasLeftWarehouse(o.shippingStatus);
}

/**
 * Cộng lại sổ theo các dòng nhật ký TRỪ của đơn. Nơi gọi đã khóa dòng đơn và đã kiểm mốc.
 * `capByReturned`: chỉ cộng tối đa số lượng khách THỰC TRẢ của từng mã (OrderItem.returnedQuantity)
 * khi đơn có ghi số đó; đơn không dòng nào có số thực trả (kiện quay đầu nguyên đơn) thì cộng đủ.
 */
async function restoreDeductionsTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  opts: {
    reason: string;
    actorId?: string | null;
    kind: "RELEASE" | "RETURN";
    /** Đơn vừa được nhả khỏi bộ đếm giữ ở giao dịch này → dòng nhật ký ghi Đang giữ −n. */
    heldReleased: boolean;
    useReturnDefault?: boolean;
    capByReturned?: boolean;
  }
): Promise<RestoredLine[]> {
  const deductions = await tx.inventoryLog.findMany({
    where: { orderId, changeQuantity: { lt: 0 } },
    orderBy: [{ productId: "asc" }, { createdAt: "asc" }],
    include: { product: { select: { productName: true } } },
  });
  let cap: Map<string, number> | null = null;
  if (opts.capByReturned) {
    const items = await tx.orderItem.findMany({
      where: { orderId, productId: { not: null } },
      select: { productId: true, returnedQuantity: true },
    });
    if (items.some((i) => i.returnedQuantity > 0)) {
      cap = new Map();
      for (const i of items) cap.set(i.productId!, (cap.get(i.productId!) ?? 0) + i.returnedQuantity);
    }
  }
  const lines: RestoredLine[] = [];
  for (const log of deductions) {
    let qty = Math.abs(log.changeQuantity);
    if (cap) {
      const left = cap.get(log.productId) ?? 0;
      qty = Math.min(qty, left);
      cap.set(log.productId, left - qty);
    }
    if (qty <= 0) continue;
    const written = await applyStockDelta(tx, {
      productId: log.productId,
      delta: qty,
      type: InventoryLogType.SYNC,
      reason: opts.reason,
      orderId,
      actorId: opts.actorId ?? null,
      // Trả về ĐÚNG vị trí đã trừ (log.locationId); hàng hoàn thì về "nơi nhận hoàn" nếu shop đặt.
      locationId: log.locationId,
      useReturnDefault: opts.useReturnDefault,
      kind: opts.kind,
      logHeldChange: opts.heldReleased ? -qty : 0,
    });
    lines.push({
      productId: log.productId,
      productName: log.product.productName,
      restoredQuantity: qty,
      newQuantity: written.quantityInStock,
    });
  }
  return lines;
}

/**
 * ĐƠN BỊ HỦY (webhook sàn, hủy tay). Khóa dòng đơn, nhả giữ, rồi:
 *   - đã cộng lại sổ từ trước → `already-restored`, không làm gì;
 *   - hàng đã rời kho + shop ở chế độ ON_RECEIVE → KHÔNG cộng, bảo đảm đơn nằm ở "Chờ hàng về",
 *     trả `awaiting-return`;
 *   - còn lại → cộng lại sổ đúng vị trí đã trừ, ghi mốc `stockRestoredAt`.
 * `lines` = từng dòng đã cộng (rỗng khi không cộng gì).
 */
export async function restoreStockTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  sourceLabel: string,
  opts: { actorId?: string | null; reason?: string } = {}
): Promise<{ restored: number; outcome: StockOutcome; productIds: string[]; lines: RestoredLine[] }> {
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      stockRestoredAt: true,
      orderCode: true,
      shippingStatus: true,
      returnStatus: true,
      platformReturnStatus: true,
      stockShippedAt: true,
      stockShipSource: true,
      channel: { select: { userId: true } },
    },
  });
  if (!order) return { restored: 0, outcome: "none", productIds: [], lines: [] };
  // Đơn hủy khi hàng CHƯA rời kho → ra khỏi bộ đếm "đang giữ" (đã rời kho rồi thì không còn gì
  // để nhả). Gọi trước chốt chặn stockRestoredAt: hàm tự chống lặp bằng dấu của nó.
  const rel = await releaseCommittedTx(tx, orderId);
  if (order.stockRestoredAt) {
    return { restored: 0, outcome: "already-restored", productIds: [], lines: [] };
  }

  const left = orderLeftWarehouse(order);
  if (left) {
    const settings = await getStockSettings(tx, order.channel.userId);
    if (settings.restockOnReturn === "ON_RECEIVE") {
      // Chuẩn: kiện còn trên đường về thì chưa phải hàng trong kho. Đơn phải nằm ở "Chờ hàng về"
      // để kho quét nhận (hàm ghi đơn của sàn thường đã cắm cờ; ở đây lo các đường còn lại).
      if (order.returnStatus === ReturnStatus.NONE) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            returnStatus: ReturnStatus.AWAITING,
            returnRequestedAt: new Date(),
            platformReturnStatus: order.platformReturnStatus ?? CANCELLED_AFTER_SHIP,
          },
        });
      }
      return { restored: 0, outcome: "awaiting-return", productIds: [], lines: [] };
    }
  }

  const lines = await restoreDeductionsTx(tx, orderId, {
    reason: opts.reason ?? `Hoàn kho tự động — ${sourceLabel} hủy đơn ${order.orderCode}`,
    actorId: opts.actorId,
    kind: left ? "RETURN" : "RELEASE",
    heldReleased: rel.released > 0,
  });
  const restored = lines.reduce((s, l) => s + l.restoredQuantity, 0);
  const productIds = [...new Set(lines.map((l) => l.productId))];
  if (restored > 0) {
    await tx.order.update({
      where: { id: orderId },
      data: { stockRestoredAt: new Date() },
    });
    return { restored, outcome: "restored", productIds, lines };
  }
  return { restored: 0, outcome: "none", productIds: [], lines: [] };
}

/**
 * KHO NHẬN KIỆN HOÀN NGUYÊN VẸN → cộng lại sổ (nhận lẻ, nhập kho theo lô). Khóa dòng đơn và đọc
 * mốc `stockRestoredAt` DƯỚI khóa: đơn đã cộng từ lúc hủy (chế độ ON_CANCEL) thì không cộng nữa.
 * Hàng về "nơi nhận hoàn" nếu shop đặt, không thì về đúng vị trí đã trừ. Shop ở chế độ chuẩn
 * (ON_RECEIVE) cộng theo số lượng khách thực trả từng mã khi sàn có báo số đó.
 * Tự ghi `stockRestoredAt` khi có cộng.
 */
export async function restoreReturnedStockTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string,
  actorId: string | null = null
): Promise<{ lines: RestoredLine[]; alreadyRestored: boolean }> {
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { stockRestoredAt: true, channel: { select: { userId: true } } },
  });
  if (!order) return { lines: [], alreadyRestored: false };
  // Đơn chưa từng được ghi "rời kho" mà kho đã nhận lại hàng → ra khỏi bộ đếm "đang giữ".
  const rel = await releaseCommittedTx(tx, orderId);
  if (order.stockRestoredAt) return { lines: [], alreadyRestored: true };
  const settings = await getStockSettings(tx, order.channel.userId);
  const lines = await restoreDeductionsTx(tx, orderId, {
    reason,
    actorId,
    kind: "RETURN",
    heldReleased: rel.released > 0,
    useReturnDefault: true,
    capByReturned: settings.restockOnReturn === "ON_RECEIVE",
  });
  if (lines.length > 0) {
    await tx.order.update({ where: { id: orderId }, data: { stockRestoredAt: new Date() } });
  }
  return { lines, alreadyRestored: false };
}

// ============================================================
// BỘ ĐẾM "ĐANG GIỮ" + MỐC HÀNG RỜI KHO — kho chuẩn quốc tế, LÁT 1 CHẠY BÓNG (12/11/2026;
// thiết kế lại 19/11/2026) — docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 13 + 14.
//
// Chuẩn quốc tế: đơn chốt chỉ GIỮ hàng, hàng rời kho mới trừ tồn. Sổ Hubsell trừ từ lúc chốt
// (deductStockTx) và lát này KHÔNG đổi điều đó. Lát này chỉ ghi thêm hai điều sổ chưa biết:
//   • hàng nào đang giữ cho đơn  → Product.committedQuantity (+ committed từng vị trí),
//     cộng ngay trong bút toán trừ của deductStockTx (applyStockDelta { reserve: true });
//   • đơn nào đã rời kho         → Order.stockShippedAt (shipStockTx trừ bộ đếm).
// MỘT DẤU DUY NHẤT cho "đang giữ": Order.stockCommittedAt khác NULL. Dấu được đặt lúc chốt và
// bị XÓA lúc rời kho (shipStockTx) hoặc lúc hủy trước khi rời kho (releaseCommittedTx).
// Bất biến: Product.committedQuantity = tổng các dòng nhật ký TRỪ của những đơn còn dấu.
// Sổ, holdQuantity, số đẩy sàn KHÔNG đổi ở đây → không nơi gọi nào phải đẩy tồn sau các hàm này.
// ============================================================

export type ShipSource = "HANDOVER" | "PLATFORM" | "CHANNEL_INACTIVE" | "MANUAL";

/** Trạng thái = kiện đã rời shop (đã giao cho đơn vị vận chuyển). */
export function hasLeftWarehouse(status: ShippingStatus | null | undefined): boolean {
  return status === ShippingStatus.SHIPPING || status === ShippingStatus.DELIVERED;
}

/**
 * HÀNG CỦA ĐƠN ĐÃ RỜI KHO — đúng một lần, nơi nào tới trước thì thắng: lập Biên bản bàn giao
 * (theo lô, services/stock-committed.ts), mọi đường ghi trạng thái đơn của ba sàn (webhook, quét
 * lô, làn đọc con trỏ — gọi trong hàm ghi đơn dùng chung), đổi trạng thái tay, và lượt quét bù
 * làm lưới an toàn. Chỉ đụng bộ đếm giữ + mốc; KHÔNG đụng sổ.
 */
export async function shipStockTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  source: ShipSource
): Promise<{ shipped: number }> {
  if (!stockCommittedOn()) return { shipped: 0 };
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { stockCommittedAt: true, stockShippedAt: true },
  });
  if (!order?.stockCommittedAt) return { shipped: 0 };
  if (order.stockShippedAt) {
    // Dấu còn sót của bản hai cột (trước 20/11/2026 rời kho không xóa dấu): bộ đếm đã trừ rồi →
    // chỉ gỡ dấu, KHÔNG trừ lần hai.
    await tx.order.update({ where: { id: orderId }, data: { stockCommittedAt: null } });
    return { shipped: 0 };
  }
  const shipped = await adjustCommittedForOrdersTx(tx, [orderId], -1);
  // Nhật ký kho: dòng "Xuất cho đơn" (Đang giữ −n, Tồn kho −n, Có thể bán không đổi).
  await logShippedOrdersTx(tx, [orderId], source);
  // Một dấu duy nhất cho "đang giữ" (mục 14.1): ghi mốc rời kho và XÓA dấu giữ trong cùng một câu.
  // Không mất thông tin — stockCommittedAt luôn bằng stockDeductedAt.
  await tx.order.update({
    where: { id: orderId },
    data: { stockShippedAt: new Date(), stockShipSource: source, stockCommittedAt: null },
  });
  return { shipped };
}

/**
 * ĐƠN HỦY KHI HÀNG CHƯA RỜI KHO → ra khỏi bộ đếm giữ, đúng một lần (xóa mốc stockCommittedAt
 * nên gọi lại không trừ nữa). Đơn đã rời kho thì không làm gì. KHÔNG cộng lại sổ — việc đó
 * vẫn do nơi gọi làm như trước (restoreStockTx, hủy tay, nhận hàng hoàn).
 */
export async function releaseCommittedTx(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ released: number }> {
  if (!stockCommittedOn()) return { released: 0 };
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { stockCommittedAt: true, stockShippedAt: true },
  });
  if (!order?.stockCommittedAt) return { released: 0 };
  // Đã có mốc rời kho mà còn dấu (sót của bản hai cột): bộ đếm đã trừ rồi → chỉ gỡ dấu.
  const released = order.stockShippedAt ? 0 : await adjustCommittedForOrdersTx(tx, [orderId], -1);
  await tx.order.update({ where: { id: orderId }, data: { stockCommittedAt: null } });
  return { released };
}
