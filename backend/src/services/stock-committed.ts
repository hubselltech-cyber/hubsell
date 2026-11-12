// ============================================================
// BỘ ĐẾM "ĐANG GIỮ CHO ĐƠN" — phần chạy THEO LÔ (kho chuẩn quốc tế, lát 1 chạy bóng 12/11/2026)
// Thiết kế: docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 13.
//
// Từng đơn một (webhook) đi qua integrations/order-stock.ts (deductStockTx { reserve },
// shipStockTx, releaseCommittedTx). Tệp này lo các việc nhiều đơn một lượt, mỗi lượt vài câu SQL,
// KHÔNG lặp từng đơn:
//   • shipOrdersTx            Biên bản bàn giao: cả lô đơn rời kho
//   • sweepShipped            quét bù: đơn đã sang Đang giao / Đã giao qua đường không đụng kho
//                             (quét lô, làn đọc con trỏ, sửa tay) + đơn của gian không còn hoạt động
//   • releaseCommittedOfChannelTx   xóa gian: nhả giữ trước khi xóa đơn
//   • cutoverCommittedStep    ngày chuyển: đưa các đơn đang chờ giao vào bộ đếm (một lần)
//   • checkCommitted          đối chiếu hằng đêm — lệch thì BÁO, không tự sửa
//
// CHẠY BÓNG: chưa màn nào đọc bộ đếm, số đẩy sàn không dùng. Không hàm nào ở đây đụng
// Product.quantityInStock.
// ============================================================
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { stockCommittedOn } from "./stock-ledger";
import type { ShipSource } from "../integrations/order-stock";

type Tx = Prisma.TransactionClient;

/**
 * Đơn ĐANG nằm trong bộ đếm giữ. PHẢI khớp từng chữ với vị từ của chỉ mục một phần
 * "Order_stock_committed_idx" (migration 20261112210000) — lệch là Postgres quét cả bảng đơn.
 */
const COMMITTED_ORDER = Prisma.sql`o."stockCommittedAt" IS NOT NULL AND o."stockShippedAt" IS NULL`;

/** Gian đang nối và không ngủ đông — cùng luật với services/stock-awaiting-ship.ts. */
const LIVE_CHANNEL = Prisma.sql`c."status" = 'ACTIVE' AND c."hibernatedAt" IS NULL`;

/** Giờ UTC cho cột TIMESTAMP(3) không múi giờ của Prisma (bẫy now() theo múi giờ phiên). */
const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/**
 * Cộng (sign = 1) hoặc trừ (sign = −1) phần của một nhóm đơn vào bộ đếm giữ, theo mã và theo vị
 * trí, bằng đúng các dòng nhật ký TRỪ của những đơn đó. Nơi gọi ĐÃ khóa các dòng đơn.
 *
 * Khóa dòng trước khi ghi, thứ tự cố định (vị trí rồi tới sản phẩm, mỗi loại theo id tăng dần) —
 * cùng chiều với đường trừ kho của đơn (applyStockDelta: khóa level → ghi Product) để hai bên
 * không khóa chéo nhau. Trả tổng số lượng đã cộng / trừ.
 */
export async function adjustCommittedForOrdersTx(tx: Tx, orderIds: string[], sign: 1 | -1): Promise<number> {
  if (orderIds.length === 0) return 0;
  await tx.$queryRaw`
    SELECT lv."id" FROM "product_stock_levels" lv
    WHERE (lv."productId", lv."locationId") IN (
      SELECT il."productId", il."locationId" FROM "InventoryLog" il
      WHERE il."orderId" = ANY(${orderIds}::text[]) AND il."changeQuantity" < 0 AND il."locationId" IS NOT NULL)
    ORDER BY lv."productId", lv."locationId" FOR UPDATE`;
  await tx.$queryRaw`
    SELECT p."id" FROM "Product" p
    WHERE p."id" IN (
      SELECT il."productId" FROM "InventoryLog" il
      WHERE il."orderId" = ANY(${orderIds}::text[]) AND il."changeQuantity" < 0)
    ORDER BY p."id" FOR UPDATE`;
  const rows = await tx.$queryRaw<{ qty: number }[]>`
    WITH q AS (
      SELECT il."productId", il."locationId", (SUM(-il."changeQuantity") * ${sign}::int)::int AS qty
      FROM "InventoryLog" il
      WHERE il."orderId" = ANY(${orderIds}::text[]) AND il."changeQuantity" < 0
      GROUP BY 1, 2
    ),
    p AS (
      UPDATE "Product" pr SET "committedQuantity" = pr."committedQuantity" + s.qty
      FROM (SELECT "productId", SUM(qty)::int AS qty FROM q GROUP BY 1) s
      WHERE pr."id" = s."productId"
      RETURNING 1
    ),
    l AS (
      UPDATE "product_stock_levels" lv SET "committed" = lv."committed" + q.qty
      FROM q
      WHERE lv."productId" = q."productId" AND lv."locationId" = q."locationId"
      RETURNING 1
    )
    SELECT COALESCE(SUM(qty), 0)::int AS qty FROM q`;
  return Math.abs(rows[0]?.qty ?? 0);
}

/**
 * CẢ LÔ ĐƠN RỜI KHO (Biên bản bàn giao). Chỉ lấy đơn đang giữ, chưa rời kho; đơn khác bỏ qua êm.
 * Khóa dòng đơn (chờ webhook đang giữ khóa xong) rồi trừ bộ đếm + đánh mốc. Trả số đơn đã xuất.
 */
export async function shipOrdersTx(tx: Tx, orderIds: string[], source: ShipSource): Promise<number> {
  if (!stockCommittedOn() || orderIds.length === 0) return 0;
  const due = await tx.$queryRaw<{ id: string }[]>`
    SELECT o."id" FROM "Order" o
    WHERE o."id" = ANY(${orderIds}::text[]) AND ${COMMITTED_ORDER}
    ORDER BY o."id" FOR UPDATE OF o`;
  const ids = due.map((d) => d.id);
  if (ids.length === 0) return 0;
  await adjustCommittedForOrdersTx(tx, ids, -1);
  await tx.$executeRaw`
    UPDATE "Order" SET "stockShippedAt" = ${NOW_UTC}, "stockShipSource" = ${source}
    WHERE "id" = ANY(${ids}::text[])`;
  return ids.length;
}

export interface SweepResult {
  /** Đơn sàn đã báo Đang giao / Đã giao mà chưa qua webhook kho. */
  platform: number;
  /** Đơn của gian mất kết nối / ngủ đông — không còn được cập nhật nên ra khỏi bộ đếm. */
  channelInactive: number;
  /** Tổng số sản phẩm ra khỏi bộ đếm. */
  quantity: number;
}

/**
 * MỘT LÔ QUÉT BÙ. SKIP LOCKED: đơn đang bị webhook giữ khóa thì bỏ qua, lượt sau lấy.
 * Gian không còn hoạt động → nhả ngay, không chờ hạn tuổi (đơn của gian đó đứng im mãi).
 */
export async function sweepShippedBatch(batch: number): Promise<SweepResult> {
  return prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string; inactive: boolean }[]>`
      SELECT o."id", NOT (${LIVE_CHANNEL}) AS "inactive"
      FROM "Order" o JOIN "Channel" c ON c."id" = o."channelId"
      WHERE ${COMMITTED_ORDER}
        AND (o."shippingStatus" IN ('SHIPPING','DELIVERED') OR NOT (${LIVE_CHANNEL}))
      ORDER BY o."id" LIMIT ${batch}::int
      FOR UPDATE OF o SKIP LOCKED`;
    if (due.length === 0) return { platform: 0, channelInactive: 0, quantity: 0 };
    const inactive = due.filter((d) => d.inactive).map((d) => d.id);
    const platform = due.filter((d) => !d.inactive).map((d) => d.id);
    const quantity = await adjustCommittedForOrdersTx(tx, due.map((d) => d.id), -1);
    if (platform.length) {
      await tx.$executeRaw`
        UPDATE "Order" SET "stockShippedAt" = ${NOW_UTC}, "stockShipSource" = 'PLATFORM'
        WHERE "id" = ANY(${platform}::text[])`;
    }
    if (inactive.length) {
      await tx.$executeRaw`
        UPDATE "Order" SET "stockShippedAt" = ${NOW_UTC}, "stockShipSource" = 'CHANNEL_INACTIVE'
        WHERE "id" = ANY(${inactive}::text[])`;
    }
    return { platform: platform.length, channelInactive: inactive.length, quantity };
  });
}

/** Quét bù tới khi hết việc (hoặc chạm trần số lô của một nhịp). */
export async function sweepShipped(opts: { batch: number; maxBatches: number }): Promise<SweepResult> {
  const total: SweepResult = { platform: 0, channelInactive: 0, quantity: 0 };
  if (!stockCommittedOn()) return total;
  for (let i = 0; i < opts.maxBatches; i++) {
    const r = await sweepShippedBatch(opts.batch);
    total.platform += r.platform;
    total.channelInactive += r.channelInactive;
    total.quantity += r.quantity;
    if (r.platform + r.channelInactive < opts.batch) break;
  }
  return total;
}

/**
 * XÓA GIAN: nhả giữ toàn bộ đơn đang giữ của gian TRƯỚC khi xóa đơn (đơn bị xóa thì nhật ký mất
 * orderId, không còn cách nào trừ bộ đếm). Gian bị xóa đã ngắt kết nối nên thường quét bù đã nhả
 * rồi; hàm này chặn khoảng hở "ngắt xong xóa ngay". Trả số đơn đã nhả.
 */
export async function releaseCommittedOfChannel(channelId: string): Promise<number> {
  if (!stockCommittedOn()) return 0;
  let released = 0;
  for (;;) {
    const n = await prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT o."id" FROM "Order" o
        WHERE o."channelId" = ${channelId} AND ${COMMITTED_ORDER}
        ORDER BY o."id" LIMIT 500 FOR UPDATE OF o`;
      const ids = due.map((d) => d.id);
      if (ids.length === 0) return 0;
      await adjustCommittedForOrdersTx(tx, ids, -1);
      await tx.$executeRaw`
        UPDATE "Order" SET "stockShippedAt" = ${NOW_UTC}, "stockShipSource" = 'CHANNEL_INACTIVE'
        WHERE "id" = ANY(${ids}::text[])`;
      return ids.length;
    });
    released += n;
    if (n < 500) return released;
  }
}

// ---------- NGÀY CHUYỂN ----------

export const CUTOVER_JOB_KEY = "stock-committed-cutover";

/**
 * MỘT LÔ của ngày chuyển: đơn đã trừ kho, còn Chờ xử lý / Đã xử lý, chưa hủy, gian đang hoạt động
 * (đúng tập của cột "Chờ giao") mà CHƯA có mốc giữ → cộng vào bộ đếm, đánh mốc = lúc đã trừ kho.
 * Đơn chốt sau khi bản này lên đã tự có mốc (deductStockTx) nên không bị lấy lại. Đơn ngoài tập
 * (đã giao, đã hủy, gian chết) không bao giờ vào bộ đếm. Trả số đơn của lô.
 */
export async function cutoverCommittedBatch(batch: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT o."id" FROM "Order" o
      JOIN "Channel" c ON c."id" = o."channelId" AND ${LIVE_CHANNEL}
      WHERE o."shippingStatus" IN ('PENDING','PROCESSED') AND o."stockRestoredAt" IS NULL
        AND o."stockDeductedAt" IS NOT NULL AND o."stockCommittedAt" IS NULL
      ORDER BY o."id" LIMIT ${batch}::int
      FOR UPDATE OF o`;
    const ids = due.map((d) => d.id);
    if (ids.length === 0) return 0;
    await adjustCommittedForOrdersTx(tx, ids, 1);
    await tx.$executeRaw`
      UPDATE "Order" SET "stockCommittedAt" = "stockDeductedAt" WHERE "id" = ANY(${ids}::text[])`;
    return ids.length;
  });
}

/**
 * Chạy ngày chuyển tới khi xong, ghi tiến độ ở maintenance_jobs. Đã xong (doneAt) thì chỉ đọc một
 * dòng rồi thôi. Trả số đơn đã đưa vào bộ đếm ở LƯỢT GỌI NÀY (0 = đã xong từ trước / không có gì).
 */
export async function runCutoverIfNeeded(batch: number): Promise<{ alreadyDone: boolean; orders: number }> {
  if (!stockCommittedOn()) return { alreadyDone: true, orders: 0 };
  const job = await prisma.maintenanceJob.findUnique({ where: { key: CUTOVER_JOB_KEY } });
  if (job?.doneAt) return { alreadyDone: true, orders: 0 };
  let orders = 0;
  for (;;) {
    const n = await cutoverCommittedBatch(batch);
    orders += n;
    if (n > 0) {
      await prisma.maintenanceJob.upsert({
        where: { key: CUTOVER_JOB_KEY },
        create: { key: CUTOVER_JOB_KEY, processed: n },
        update: { processed: { increment: n }, updatedAt: new Date() },
      });
    }
    if (n < batch) break;
  }
  await prisma.maintenanceJob.upsert({
    where: { key: CUTOVER_JOB_KEY },
    create: { key: CUTOVER_JOB_KEY, processed: orders, doneAt: new Date() },
    update: { doneAt: new Date(), updatedAt: new Date() },
  });
  return { alreadyDone: false, orders };
}

/**
 * DỰNG LẠI TỪ ĐẦU (sau khi tắt công tắc STOCK_COMMITTED_OFF một thời gian rồi bật lại — trong lúc
 * tắt, đơn rời kho / hủy không trừ bộ đếm nên số cũ không còn tin được): về 0 mọi bộ đếm, gỡ mốc
 * của các đơn đang giữ, xóa dấu "đã chuyển". Nhịp worker kế tiếp tự chạy lại ngày chuyển.
 * KHÔNG tự chạy ở đâu — gọi tay khi cần.
 */
export async function resetCommitted(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Order" o SET "stockCommittedAt" = NULL WHERE ${COMMITTED_ORDER}`;
    await tx.$executeRaw`UPDATE "Product" SET "committedQuantity" = 0 WHERE "committedQuantity" <> 0`;
    await tx.$executeRaw`UPDATE "product_stock_levels" SET "committed" = 0 WHERE "committed" <> 0`;
    await tx.maintenanceJob.deleteMany({ where: { key: CUTOVER_JOB_KEY } });
  });
}

// ---------- ĐỐI CHIẾU ----------

export const CHECK_JOB_KEY = "stock-committed-check";

export interface CommittedCheck {
  /** Tổng bộ đếm trên Product. */
  counterTotal: number;
  /** Tổng tính lại từ nhật ký trừ của các đơn đang giữ. */
  ordersTotal: number;
  /** Số mã mà bộ đếm ≠ số tính lại từ đơn đang giữ. PHẢI bằng 0 — khác 0 là sót một đường ghi. */
  counterMismatch: number;
  /** Tổng theo cách tính của cột "Chờ giao" (theo trạng thái giao hàng, độc lập với các mốc mới). */
  awaitingTotal: number;
  /** Số mã mà bộ đếm ≠ "Chờ giao". Lệch thoáng qua là do quét bù chưa tới; lệch đứng yên là lỗi. */
  awaitingMismatch: number;
  /** Số cặp (mã, vị trí) mà committed của vị trí ≠ số tính lại từ đơn đang giữ. PHẢI bằng 0. */
  levelMismatch: number;
  /** Đơn đang giữ. */
  committedOrders: number;
  /** Đơn đang giữ mà trạng thái đã là Đã hủy (hủy ghi qua đường không cộng lại sổ — lỗ có sẵn). */
  cancelledStillCommitted: number;
  /** Tuổi (giờ) của đơn giữ lâu nhất. */
  oldestHours: number;
}

/**
 * Ba phép so của mục 13.5. Toàn nền tảng, vài câu SQL; tập đơn đang giữ đi qua chỉ mục một phần.
 * Phần đọc Product lọc "committedQuantity <> 0" là quét bảng Product — chấp nhận ở nhịp một lần
 * mỗi đêm khi bảng còn vài chục nghìn dòng; lớn lên thì thêm chỉ mục một phần.
 */
export async function checkCommitted(): Promise<CommittedCheck> {
  const [byProduct] = await prisma.$queryRaw<
    { counterTotal: number; ordersTotal: number; counterMismatch: number; awaitingTotal: number; awaitingMismatch: number }[]
  >`
    WITH truth AS (
      SELECT il."productId" AS pid, SUM(-il."changeQuantity")::int AS qty
      FROM "Order" o JOIN "InventoryLog" il ON il."orderId" = o."id" AND il."changeQuantity" < 0
      WHERE ${COMMITTED_ORDER} GROUP BY 1
    ),
    aw AS (
      SELECT il."productId" AS pid, SUM(-il."changeQuantity")::int AS qty
      FROM "Order" o
      JOIN "Channel" c ON c."id" = o."channelId" AND ${LIVE_CHANNEL}
      JOIN "InventoryLog" il ON il."orderId" = o."id" AND il."changeQuantity" < 0
      WHERE o."shippingStatus" IN ('PENDING','PROCESSED') AND o."stockRestoredAt" IS NULL AND o."stockDeductedAt" IS NOT NULL
      GROUP BY 1
    ),
    cnt AS (SELECT "id" AS pid, "committedQuantity" AS qty FROM "Product" WHERE "committedQuantity" <> 0),
    keys AS (SELECT pid FROM truth UNION SELECT pid FROM aw UNION SELECT pid FROM cnt)
    SELECT COALESCE(SUM(c.qty), 0)::int AS "counterTotal",
           COALESCE(SUM(t.qty), 0)::int AS "ordersTotal",
           (COUNT(*) FILTER (WHERE COALESCE(c.qty, 0) <> COALESCE(t.qty, 0)))::int AS "counterMismatch",
           COALESCE(SUM(a.qty), 0)::int AS "awaitingTotal",
           (COUNT(*) FILTER (WHERE COALESCE(c.qty, 0) <> COALESCE(a.qty, 0)))::int AS "awaitingMismatch"
    FROM keys k
    LEFT JOIN truth t ON t.pid = k.pid
    LEFT JOIN aw a ON a.pid = k.pid
    LEFT JOIN cnt c ON c.pid = k.pid`;

  const [byLevel] = await prisma.$queryRaw<{ levelMismatch: number }[]>`
    WITH truth AS (
      SELECT il."productId" AS pid, il."locationId" AS lid, SUM(-il."changeQuantity")::int AS qty
      FROM "Order" o JOIN "InventoryLog" il ON il."orderId" = o."id" AND il."changeQuantity" < 0
      WHERE ${COMMITTED_ORDER} AND il."locationId" IS NOT NULL GROUP BY 1, 2
    ),
    cnt AS (SELECT "productId" AS pid, "locationId" AS lid, "committed" AS qty FROM "product_stock_levels" WHERE "committed" <> 0)
    SELECT (COUNT(*) FILTER (WHERE COALESCE(c.qty, 0) <> COALESCE(t.qty, 0)))::int AS "levelMismatch"
    FROM truth t FULL JOIN cnt c USING (pid, lid)`;

  const [orders] = await prisma.$queryRaw<{ committedOrders: number; cancelledStillCommitted: number; oldestHours: number }[]>`
    SELECT COUNT(*)::int AS "committedOrders",
           (COUNT(*) FILTER (WHERE o."shippingStatus" = 'CANCELLED'))::int AS "cancelledStillCommitted",
           COALESCE(EXTRACT(EPOCH FROM (${NOW_UTC} - MIN(o."stockCommittedAt"))) / 3600, 0)::int AS "oldestHours"
    FROM "Order" o WHERE ${COMMITTED_ORDER}`;

  return { ...byProduct, levelMismatch: byLevel.levelMismatch, ...orders };
}

/** Chạy đối chiếu + ghi kết quả vào maintenance_jobs (cursor = JSON, processed = tổng số chỗ lệch cứng). */
export async function runCommittedCheck(): Promise<CommittedCheck> {
  const check = await checkCommitted();
  const hard = check.counterMismatch + check.levelMismatch;
  const summary = JSON.stringify({ at: new Date().toISOString(), ...check });
  await prisma.maintenanceJob.upsert({
    where: { key: CHECK_JOB_KEY },
    create: { key: CHECK_JOB_KEY, cursor: summary, processed: hard },
    update: { cursor: summary, processed: hard, updatedAt: new Date() },
  });
  return check;
}
