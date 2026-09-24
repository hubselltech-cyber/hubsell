// ============================================================
// SỔ KHO — CỬA GHI TỒN DUY NHẤT (đợt B 24/09/2026)
//
// Trước đây 14 chỗ tự `product.update({ quantityInStock })` + tự tạo InventoryLog.
// Nay mọi chỗ đi qua đây để một lần lo đủ: (1) tồn TỔNG `Product.quantityInStock`
// (vẫn là số cache mọi chỗ đọc + engine đẩy sàn dựa vào — KHÔNG đổi), (2) tồn theo
// VỊ TRÍ `product_stock_levels` khi shop đã tạo vị trí, (3) nhật ký kèm vị trí +
// tồn sau + ai làm.
//
// Bất biến: shop có ≥ 1 vị trí ⇒ Σ level(sellable) = quantityInStock. Shop chưa
// tạo vị trí ⇒ không có dòng level nào (ẩn bằng vắng mặt tới tận DB).
// Ô "KHÔNG BÁN" (sellable=false, đợt 2: hàng lỗi / hàng hoàn chờ kiểm): hàng nằm
// đó KHÔNG cộng vào tồn bán — nhập/hoàn vào đó tổng không tăng, chuyển từ đó
// sang kho bán tổng mới tăng; đơn không bao giờ trừ ở đó.
//
// Không khoá dòng Product ở đây: tổng dùng increment/decrement nguyên tử; level
// dùng INSERT … ON CONFLICT … + (nguyên tử). Chỉ khi phải PHÂN BỔ trừ hàng (không
// chỉ định vị trí) mới SELECT … FOR UPDATE các level của SKU để hai đơn song song
// không cùng "thấy" một lô hàng.
// ============================================================
import { InventoryLogType, Prisma } from "@prisma/client";
import { allocateDeduction, type Allocation } from "../lib/stock-allocation";

type Tx = Prisma.TransactionClient;

export interface StockWrite {
  productId: string;
  /** + nhập / − xuất. 0 thì không ghi gì. */
  delta: number;
  type: InventoryLogType;
  reason: string;
  actorId?: string | null;
  orderId?: string | null;
  /** Vị trí chỉ định (nhập tay chọn kho, hoàn về đúng chỗ đã trừ, sửa số tại vị trí). */
  locationId?: string | null;
  /** Hàng hoàn không biết về đâu → vị trí nhận hoàn mặc định, không có thì gốc. */
  useReturnDefault?: boolean;
}

export interface StockWriteResult {
  productId: string;
  quantityInStock: number;
  /** Mỗi vị trí bị đụng một dòng (shop chưa dùng vị trí: một dòng locationId null). */
  logs: { id: string; locationId: string | null; changeQuantity: number }[];
}

interface LocationRow {
  id: string;
  sortOrder: number;
  isDefault: boolean;
  isReturnDefault: boolean;
  sellable: boolean;
}

/** Danh sách vị trí của shop (rỗng = chưa dùng tính năng). */
export async function listLocations(tx: Tx, userId: string): Promise<LocationRow[]> {
  return tx.stockLocation.findMany({
    where: { userId },
    select: { id: true, sortOrder: true, isDefault: true, isReturnDefault: true, sellable: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

function pickDefault(locs: LocationRow[]): LocationRow {
  return locs.find((l) => l.isDefault) ?? locs[0];
}

/** Cộng/trừ level tại một vị trí — nguyên tử, tự tạo dòng nếu chưa có. */
async function bumpLevel(tx: Tx, productId: string, locationId: string, delta: number) {
  await tx.$executeRaw`
    INSERT INTO "product_stock_levels" ("id", "productId", "locationId", "quantity")
    VALUES (gen_random_uuid()::text, ${productId}, ${locationId}, ${delta})
    ON CONFLICT ("productId", "locationId")
    DO UPDATE SET "quantity" = "product_stock_levels"."quantity" + EXCLUDED."quantity"`;
}

/** Khoá + đọc level hiện có của SKU (cho phân bổ trừ hàng). */
async function lockLevels(tx: Tx, productId: string) {
  return tx.$queryRaw<{ locationId: string; quantity: number }[]>`
    SELECT "locationId", "quantity" FROM "product_stock_levels"
    WHERE "productId" = ${productId} FOR UPDATE`;
}

/**
 * GHI MỘT BÚT TOÁN TỒN. Trả về tồn tổng mới + các dòng nhật ký đã tạo.
 * Cho phép tổng âm (bán vượt phơi bày) — nơi gọi muốn chặn thì tự kiểm trước
 * (như /inventory/adjust đã làm).
 */
export async function applyStockDelta(tx: Tx, w: StockWrite): Promise<StockWriteResult> {
  if (!Number.isInteger(w.delta) || w.delta === 0) {
    const p = await tx.product.findUniqueOrThrow({
      where: { id: w.productId },
      select: { quantityInStock: true },
    });
    return { productId: w.productId, quantityInStock: p.quantityInStock, logs: [] };
  }

  const product = await tx.product.findUniqueOrThrow({
    where: { id: w.productId },
    select: { id: true, userId: true, quantityInStock: true },
  });

  const locs = await listLocations(tx, product.userId);
  const logs: StockWriteResult["logs"] = [];

  if (locs.length === 0) {
    const updated = await tx.product.update({
      where: { id: w.productId },
      data: { quantityInStock: { increment: w.delta } },
      select: { quantityInStock: true },
    });
    const balanceAfter = updated.quantityInStock;
    const log = await tx.inventoryLog.create({
      data: {
        productId: w.productId,
        changeQuantity: w.delta,
        type: w.type,
        reason: w.reason,
        orderId: w.orderId ?? null,
        actorId: w.actorId ?? null,
        balanceAfter,
      },
      select: { id: true },
    });
    logs.push({ id: log.id, locationId: null, changeQuantity: w.delta });
    return { productId: w.productId, quantityInStock: balanceAfter, logs };
  }

  const byId = new Map(locs.map((l) => [l.id, l]));
  const root = pickDefault(locs);
  // Vị trí chỉ định không còn (đã xóa) → về gốc thay vì vỡ transaction.
  const wanted = w.locationId && byId.has(w.locationId) ? w.locationId : null;

  let allocations: Allocation[];
  if (w.delta > 0) {
    // Hàng hoàn: shop đặt "nơi nhận hoàn" thì về đó (để kiểm trước khi trộn vào
    // kho bán); không đặt thì về đúng vị trí đã trừ; không biết thì về gốc.
    const returnLoc = w.useReturnDefault ? locs.find((l) => l.isReturnDefault)?.id : undefined;
    const target = returnLoc ?? wanted ?? root.id;
    allocations = [{ locationId: target, quantity: w.delta }];
  } else if (wanted) {
    allocations = [{ locationId: wanted, quantity: -w.delta }];
  } else {
    const levels = await lockLevels(tx, w.productId);
    allocations = allocateDeduction(
      levels
        .filter((lv) => byId.has(lv.locationId))
        .map((lv) => {
          const l = byId.get(lv.locationId)!;
          return { locationId: lv.locationId, quantity: lv.quantity, sortOrder: l.sortOrder, sellable: l.sellable };
        }),
      -w.delta,
      root.id
    );
  }

  // Tổng = Σ vị trí BÁN ĐƯỢC: phần rơi vào ô "không bán" không cộng/trừ vào tồn bán.
  const sellableDelta = allocations.reduce((sum, a) => {
    const sellable = byId.get(a.locationId)?.sellable !== false;
    return sum + (sellable ? (w.delta > 0 ? a.quantity : -a.quantity) : 0);
  }, 0);
  let balanceAfter = product.quantityInStock;
  if (sellableDelta !== 0) {
    const updated = await tx.product.update({
      where: { id: w.productId },
      data: { quantityInStock: { increment: sellableDelta } },
      select: { quantityInStock: true },
    });
    balanceAfter = updated.quantityInStock;
  }

  for (const a of allocations) {
    const signed = w.delta > 0 ? a.quantity : -a.quantity;
    await bumpLevel(tx, w.productId, a.locationId, signed);
    const log = await tx.inventoryLog.create({
      data: {
        productId: w.productId,
        changeQuantity: signed,
        type: w.type,
        reason: w.reason,
        orderId: w.orderId ?? null,
        actorId: w.actorId ?? null,
        locationId: a.locationId,
        balanceAfter,
      },
      select: { id: true },
    });
    logs.push({ id: log.id, locationId: a.locationId, changeQuantity: signed });
  }
  return { productId: w.productId, quantityInStock: balanceAfter, logs };
}

/**
 * ĐẶT TỒN TỔNG về một số tuyệt đối (sửa số trên bảng, Excel đè, gieo tồn từ sàn).
 * Khoá dòng Product để tính đúng chênh lệch rồi đi qua applyStockDelta.
 * Trả về delta đã ghi (0 = không đổi, không tạo nhật ký).
 */
export async function setStockAbsolute(
  tx: Tx,
  w: Omit<StockWrite, "delta"> & { quantity: number }
): Promise<StockWriteResult & { delta: number; previous: number }> {
  const rows = await tx.$queryRaw<{ quantityInStock: number }[]>`
    SELECT "quantityInStock" FROM "Product" WHERE "id" = ${w.productId} FOR UPDATE`;
  const previous = rows[0]?.quantityInStock ?? 0;
  const { quantity, ...rest } = w;
  const delta = quantity - previous;
  const res = await applyStockDelta(tx, { ...rest, delta });
  return { ...res, delta, previous };
}

/**
 * SỬA SỐ TẠI MỘT VỊ TRÍ (chi tiết "Đang ở"): chênh lệch tính trên level của
 * vị trí đó, tổng đổi theo. Ghi ADJUST kèm vị trí.
 */
export async function setLevelAbsolute(
  tx: Tx,
  w: { productId: string; locationId: string; quantity: number; reason: string; actorId?: string | null }
): Promise<StockWriteResult & { delta: number; previous: number }> {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT "quantity" FROM "product_stock_levels"
    WHERE "productId" = ${w.productId} AND "locationId" = ${w.locationId} FOR UPDATE`;
  const previous = rows[0]?.quantity ?? 0;
  const delta = w.quantity - previous;
  const res = await applyStockDelta(tx, {
    productId: w.productId,
    delta,
    type: InventoryLogType.ADJUST,
    reason: w.reason,
    actorId: w.actorId,
    locationId: w.locationId,
  });
  return { ...res, delta, previous };
}

/**
 * CHUYỂN VỊ TRÍ: hai dòng TRANSFER (− ở nơi đi, + ở nơi đến). Tổng KHÔNG đổi,
 * TRỪ khi chuyển giữa kho bán và ô "không bán": vào ô không bán thì tồn bán giảm,
 * từ ô không bán ra kho bán thì tồn bán tăng (`totalChanged` = true → nơi gọi đẩy sàn).
 * Chặn khi nơi đi không đủ hàng (chuyển là việc chủ động, khác đơn sàn).
 */
export async function transferStockTx(
  tx: Tx,
  w: {
    productId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    reason: string;
    actorId?: string | null;
  }
): Promise<{ from: number; to: number; quantityInStock: number; totalChanged: boolean }> {
  if (w.fromLocationId === w.toLocationId) {
    throw Object.assign(new Error("Nơi đi và nơi đến phải khác nhau"), { statusCode: 400 });
  }
  if (!Number.isInteger(w.quantity) || w.quantity <= 0) {
    throw Object.assign(new Error("Số lượng chuyển phải là số nguyên dương"), { statusCode: 400 });
  }
  const levels = await lockLevels(tx, w.productId);
  const fromQty = levels.find((l) => l.locationId === w.fromLocationId)?.quantity ?? 0;
  if (fromQty < w.quantity) {
    throw Object.assign(
      new Error(`Nơi đi chỉ còn ${fromQty}, không đủ để chuyển ${w.quantity}`),
      { statusCode: 400 }
    );
  }
  let product = await tx.product.findUniqueOrThrow({
    where: { id: w.productId },
    select: { userId: true, quantityInStock: true },
  });
  const locs = await listLocations(tx, product.userId);
  const fromSellable = locs.find((l) => l.id === w.fromLocationId)?.sellable !== false;
  const toSellable = locs.find((l) => l.id === w.toLocationId)?.sellable !== false;
  const totalDelta = fromSellable === toSellable ? 0 : toSellable ? w.quantity : -w.quantity;
  await bumpLevel(tx, w.productId, w.fromLocationId, -w.quantity);
  await bumpLevel(tx, w.productId, w.toLocationId, w.quantity);
  if (totalDelta !== 0) {
    product = await tx.product.update({
      where: { id: w.productId },
      data: { quantityInStock: { increment: totalDelta } },
      select: { userId: true, quantityInStock: true },
    });
  }
  const base = {
    productId: w.productId,
    type: InventoryLogType.TRANSFER,
    reason: w.reason,
    actorId: w.actorId ?? null,
    balanceAfter: product.quantityInStock,
  };
  await tx.inventoryLog.createMany({
    data: [
      { ...base, changeQuantity: -w.quantity, locationId: w.fromLocationId },
      { ...base, changeQuantity: w.quantity, locationId: w.toLocationId },
    ],
  });
  const toQty = levels.find((l) => l.locationId === w.toLocationId)?.quantity ?? 0;
  return {
    from: fromQty - w.quantity,
    to: toQty + w.quantity,
    quantityInStock: product.quantityInStock,
    totalChanged: totalDelta !== 0,
  };
}

/**
 * BẬT VỊ TRÍ LẦN ĐẦU: tạo gốc "Kho chính" (mặc định) và đổ TOÀN BỘ tồn hiện có
 * của shop vào gốc bằng một câu INSERT … SELECT (set-based, không lặp từng SKU).
 * Gọi trong transaction, chỉ khi shop chưa có vị trí nào.
 */
export async function createRootLocationTx(tx: Tx, userId: string, name = "Kho chính") {
  const root = await tx.stockLocation.create({
    data: { userId, name, isDefault: true, sortOrder: 0 },
    select: { id: true, name: true },
  });
  await tx.$executeRaw`
    INSERT INTO "product_stock_levels" ("id", "productId", "locationId", "quantity")
    SELECT gen_random_uuid()::text, "id", ${root.id}, "quantityInStock"
    FROM "Product" WHERE "userId" = ${userId} AND "quantityInStock" <> 0`;
  return root;
}
