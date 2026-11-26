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
  /** Phiếu nhập / xuất kho chứa bút toán này (05/11/2026) — bỏ trống = bút toán lẻ. */
  voucherId?: string | null;
  /** Hàng hoàn không biết về đâu → vị trí nhận hoàn mặc định, không có thì gốc. */
  useReturnDefault?: boolean;
  /**
   * GIỮ CHO ĐƠN (lát 1 chạy bóng 12/11/2026): bút toán TRỪ của đơn đã chốt — hàng ra khỏi tồn
   * bán nhưng còn trong kho → cộng đúng số đó vào bộ đếm "đang giữ" (Product.committedQuantity +
   * committed của từng vị trí bị trừ) ngay trong cùng câu ghi. Chỉ có nghĩa khi delta < 0.
   */
  reserve?: boolean;
  /**
   * LOẠI DÒNG ghi vào InventoryLog.kind (kho chuẩn quốc tế lát 3): RESERVE · RELEASE · RETURN ·
   * STOCKTAKE · SET · mã lý do nhập / xuất tay (lib/stock-reason.ts). Bỏ trống: bút toán có
   * `reserve` tự là RESERVE, còn lại để NULL.
   */
  kind?: string | null;
  /**
   * Phần đổi của ngăn "Đang giữ" CHỈ ĐỂ GHI NHẬT KÝ — nơi gọi đã tự cộng / trừ bộ đếm (ví dụ
   * đơn hủy trước khi rời kho: releaseCommittedTx trừ bộ đếm, dòng cộng lại sổ ghi heldChange = −n).
   * Bút toán có `reserve` tự ghi +n, không cần truyền.
   */
  logHeldChange?: number;
}

/** Hai cài đặt kho theo shop của kho chuẩn quốc tế (shop_sync_settings; chưa có dòng = mặc định cũ). */
export type StockModel = "LEGACY" | "ON_HAND";
export type RestockOnReturn = "ON_CANCEL" | "ON_RECEIVE";
export interface StockSettings {
  stockModel: StockModel;
  restockOnReturn: RestockOnReturn;
}

/**
 * Cách hiển thị của shop CHƯA có dòng cài đặt (đa số shop). Dòng có sẵn thì theo đúng giá trị của
 * dòng — muốn cho MỘT shop về cách cũ: đặt stockModel = 'LEGACY' ở dòng của shop đó.
 * 26/11/2026: đổi LEGACY → ON_HAND — mở cách "hàng trong kho" cho MỌI shop (anh Trung: "bật cho tất
 * cả các shop luôn"), cùng migration 20261126130000 (mặc định của cột + chuyển các dòng đang LEGACY).
 */
export const DEFAULT_STOCK_MODEL: StockModel = "ON_HAND";

/**
 * CÔNG TẮC KHẨN cho cách hiển thị (26/11/2026): STOCK_MODEL_FORCE=LEGACY trên dịch vụ web → MỌI shop
 * về cách cũ ngay sau khi tiến trình khởi động lại, không cần deploy mã, không đụng database. Dùng
 * khi bộ đếm "đang giữ" bị lệch (HQ Sức khỏe đỏ dấu hiệu "Bộ đếm kho") và chưa kịp tìm nguyên nhân.
 * Chỉ nhận đúng hai giá trị LEGACY | ON_HAND; giá trị khác coi như không đặt.
 */
export function forcedStockModel(): StockModel | null {
  const v = process.env.STOCK_MODEL_FORCE;
  return v === "LEGACY" || v === "ON_HAND" ? v : null;
}

/** Đọc cài đặt kho của một chủ shop. Giá trị lạ trong database → coi như cách cũ. */
export async function getStockSettings(
  db: Pick<Tx, "shopSyncSetting">,
  userId: string
): Promise<StockSettings> {
  const row = await db.shopSyncSetting.findUnique({
    where: { userId },
    select: { stockModel: true, restockOnReturn: true },
  });
  return resolveStockSettings(row);
}

/**
 * Từ dòng cài đặt (hoặc null = shop chưa có dòng) ra hai cài đặt đang ÁP DỤNG. MỘT chỗ quyết định
 * cho mọi nơi đọc — route nào đã có sẵn dòng cài đặt trong tay thì gọi thẳng hàm này, đừng tự so chuỗi.
 */
export function resolveStockSettings(
  row: { stockModel?: string | null; restockOnReturn?: string | null } | null | undefined
): StockSettings {
  const own: StockModel = row ? (row.stockModel === "ON_HAND" ? "ON_HAND" : "LEGACY") : DEFAULT_STOCK_MODEL;
  return {
    stockModel: forcedStockModel() ?? own,
    restockOnReturn: row?.restockOnReturn === "ON_RECEIVE" ? "ON_RECEIVE" : "ON_CANCEL",
  };
}

/**
 * Tổng hàng đang nằm ở các ô "KHÔNG BÁN" của một SKU (ngăn Unavailable). Shop không có ô không
 * bán → 0, không tốn câu đọc nào (nơi gọi truyền danh sách vị trí đã đọc).
 */
export async function unsellableQuantityTx(tx: Tx, productId: string, locs: LocationRow[]): Promise<number> {
  const ids = locs.filter((l) => l.sellable === false).map((l) => l.id);
  if (ids.length === 0) return 0;
  const agg = await tx.productStockLevel.aggregate({
    where: { productId, locationId: { in: ids } },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

/**
 * Công tắc khẩn của bộ đếm "đang giữ" (lát 1 chạy bóng): STOCK_COMMITTED_OFF=1 → mọi chỗ ghi bỏ
 * qua phần bộ đếm, sổ và số đẩy sàn chạy y như trước. Bật lại thì phải dựng lại bộ đếm
 * (services/stock-committed.ts → rebuildCommitted).
 */
export function stockCommittedOn(): boolean {
  return process.env.STOCK_COMMITTED_OFF !== "1";
}

export interface StockWriteResult {
  productId: string;
  quantityInStock: number;
  /** Mỗi vị trí bị đụng một dòng (shop chưa dùng vị trí: một dòng locationId null). */
  logs: { id: string; locationId: string | null; changeQuantity: number }[];
}

export interface LocationRow {
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

/**
 * Cộng/trừ level tại một vị trí — nguyên tử, tự tạo dòng nếu chưa có. `committedDelta` (mặc
 * định 0) cộng vào phần "đang giữ cho đơn" của vị trí trong cùng câu.
 */
async function bumpLevel(tx: Tx, productId: string, locationId: string, delta: number, committedDelta = 0) {
  await tx.$executeRaw`
    INSERT INTO "product_stock_levels" ("id", "productId", "locationId", "quantity", "committed")
    VALUES (gen_random_uuid()::text, ${productId}, ${locationId}, ${delta}, ${committedDelta})
    ON CONFLICT ("productId", "locationId")
    DO UPDATE SET "quantity" = "product_stock_levels"."quantity" + EXCLUDED."quantity",
                  "committed" = "product_stock_levels"."committed" + EXCLUDED."committed"`;
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
    select: { id: true, userId: true, quantityInStock: true, committedQuantity: true, holdQuantity: true },
  });

  const locs = await listLocations(tx, product.userId);
  const logs: StockWriteResult["logs"] = [];
  // Số cộng vào bộ đếm "đang giữ": đúng bằng số vừa trừ cho đơn (mọi dòng nhật ký trừ của đơn).
  const reserved = w.reserve && w.delta < 0 && stockCommittedOn() ? -w.delta : 0;
  // Ba ngăn số của Nhật ký kho (lát 3): loại dòng + phần đổi của "Đang giữ".
  const kind = w.kind ?? (reserved ? "RESERVE" : null);
  const heldChangeTotal = reserved || (w.logHeldChange ?? 0);

  if (locs.length === 0) {
    const updated = await tx.product.update({
      where: { id: w.productId },
      data: {
        quantityInStock: { increment: w.delta },
        ...(reserved ? { committedQuantity: { increment: reserved } } : {}),
      },
      select: { quantityInStock: true, committedQuantity: true, holdQuantity: true },
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
        voucherId: w.voucherId ?? null,
        balanceAfter,
        kind,
        heldChange: heldChangeTotal,
        heldAfter: updated.committedQuantity + updated.holdQuantity,
        onHandAfter: updated.quantityInStock + updated.committedQuantity,
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
  let committedAfter = product.committedQuantity;
  let holdAfter = product.holdQuantity;
  if (sellableDelta !== 0 || reserved) {
    const updated = await tx.product.update({
      where: { id: w.productId },
      data: {
        quantityInStock: { increment: sellableDelta },
        ...(reserved ? { committedQuantity: { increment: reserved } } : {}),
      },
      select: { quantityInStock: true, committedQuantity: true, holdQuantity: true },
    });
    balanceAfter = updated.quantityInStock;
    committedAfter = updated.committedQuantity;
    holdAfter = updated.holdQuantity;
  }

  for (const a of allocations) {
    const signed = w.delta > 0 ? a.quantity : -a.quantity;
    await bumpLevel(tx, w.productId, a.locationId, signed, reserved ? a.quantity : 0);
  }
  // "Tồn kho" (hàng trong kho) sau bút toán = sổ + đang giữ cho đơn + ô không bán (đọc SAU khi đã
  // cộng trừ các vị trí; shop không có ô không bán thì không tốn câu đọc).
  const onHandAfter = balanceAfter + committedAfter + (await unsellableQuantityTx(tx, w.productId, locs));
  // Phần đổi của "Đang giữ" chia cho từng dòng vị trí theo đúng tỉ lệ số lượng của dòng đó.
  const totalQty = allocations.reduce((s, a) => s + a.quantity, 0);

  for (const a of allocations) {
    const signed = w.delta > 0 ? a.quantity : -a.quantity;
    const heldChange =
      reserved ? a.quantity : totalQty > 0 ? Math.round((heldChangeTotal * a.quantity) / totalQty) : 0;
    const log = await tx.inventoryLog.create({
      data: {
        productId: w.productId,
        changeQuantity: signed,
        type: w.type,
        reason: w.reason,
        orderId: w.orderId ?? null,
        actorId: w.actorId ?? null,
        locationId: a.locationId,
        voucherId: w.voucherId ?? null,
        balanceAfter,
        kind,
        heldChange,
        heldAfter: committedAfter + holdAfter,
        onHandAfter,
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
 * Ba ngăn số của MỘT SKU đọc dưới khóa dòng Product (kho chuẩn quốc tế lát 3):
 *   sellable   = sổ quantityInStock (tồn bán)
 *   committed  = đang giữ cho đơn đã chốt, hàng còn trong kho
 *   unsellable = hàng ở các ô không bán
 *   onHand     = hàng TRONG KHO = sellable + committed + unsellable
 * Khóa FOR UPDATE để hai lượt sửa số cùng lúc không tính chênh trên cùng một số cũ.
 */
export async function lockStockCompartments(
  tx: Tx,
  productId: string
): Promise<{ userId: string; sellable: number; committed: number; hold: number; unsellable: number; onHand: number }> {
  const rows = await tx.$queryRaw<
    { userId: string; quantityInStock: number; committedQuantity: number; holdQuantity: number }[]
  >`
    SELECT "userId", "quantityInStock", "committedQuantity", "holdQuantity"
    FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
  const p = rows[0];
  if (!p) throw Object.assign(new Error("Không tìm thấy sản phẩm"), { statusCode: 404 });
  const unsellable = await unsellableQuantityTx(tx, productId, await listLocations(tx, p.userId));
  return {
    userId: p.userId,
    sellable: p.quantityInStock,
    committed: p.committedQuantity,
    hold: p.holdQuantity,
    unsellable,
    onHand: p.quantityInStock + p.committedQuantity + unsellable,
  };
}

/**
 * ĐẶT SỐ TRONG KHO của một SKU (shop chạy chế độ ON_HAND: sửa ô Tồn kho, Excel). Số gõ là hàng
 * thực có trong kho, GỒM cả hàng đang giữ cho đơn và hàng ở ô không bán → tồn bán mới = số gõ −
 * đang giữ − không bán. Phần chênh đi qua applyStockDelta như mọi bút toán khác.
 * `belowHeld` = số gõ thấp hơn phần đang giữ cho đơn (kho thiếu hàng cho đơn đã chốt): nơi gọi
 * quyết định cảnh báo hay cho qua — hàm này vẫn ghi (tồn bán được phép âm để lộ bán vượt).
 */
export async function setOnHandAbsolute(
  tx: Tx,
  w: Omit<StockWrite, "delta"> & { onHand: number }
): Promise<StockWriteResult & { delta: number; previous: number; committed: number; unsellable: number; belowHeld: boolean }> {
  const c = await lockStockCompartments(tx, w.productId);
  const { onHand, ...rest } = w;
  const delta = onHand - c.onHand;
  const res = await applyStockDelta(tx, { ...rest, delta, kind: rest.kind ?? "SET" });
  return {
    ...res,
    delta,
    previous: c.onHand,
    committed: c.committed,
    unsellable: c.unsellable,
    belowHeld: onHand < c.committed + c.unsellable,
  };
}

/**
 * SỬA SỐ TẠI MỘT VỊ TRÍ (chi tiết "Đang ở"): chênh lệch tính trên level của
 * vị trí đó, tổng đổi theo. Ghi ADJUST kèm vị trí.
 * `onHand: true` (shop ON_HAND): số gõ là hàng TRONG KHO tại vị trí = phần bán được + phần đang giữ
 * cho đơn tại đó → `previous` cũng tính cả phần đang giữ.
 */
export async function setLevelAbsolute(
  tx: Tx,
  w: {
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
    actorId?: string | null;
    onHand?: boolean;
    kind?: string | null;
  }
): Promise<StockWriteResult & { delta: number; previous: number }> {
  const rows = await tx.$queryRaw<{ quantity: number; committed: number }[]>`
    SELECT "quantity", "committed" FROM "product_stock_levels"
    WHERE "productId" = ${w.productId} AND "locationId" = ${w.locationId} FOR UPDATE`;
  const previous = (rows[0]?.quantity ?? 0) + (w.onHand ? (rows[0]?.committed ?? 0) : 0);
  const delta = w.quantity - previous;
  const res = await applyStockDelta(tx, {
    productId: w.productId,
    delta,
    type: InventoryLogType.ADJUST,
    reason: w.reason,
    actorId: w.actorId,
    locationId: w.locationId,
    kind: w.kind ?? "SET",
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
    select: { userId: true, quantityInStock: true, committedQuantity: true, holdQuantity: true },
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
      select: { userId: true, quantityInStock: true, committedQuantity: true, holdQuantity: true },
    });
  }
  const base = {
    productId: w.productId,
    type: InventoryLogType.TRANSFER,
    reason: w.reason,
    actorId: w.actorId ?? null,
    balanceAfter: product.quantityInStock,
    // Chuyển vị trí không đổi hàng trong kho; qua ô không bán thì chỉ tồn bán đổi.
    kind: "TRANSFER",
    heldChange: 0,
    heldAfter: product.committedQuantity + product.holdQuantity,
    onHandAfter:
      product.quantityInStock + product.committedQuantity + (await unsellableQuantityTx(tx, w.productId, locs)),
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
