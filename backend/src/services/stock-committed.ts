// ============================================================
// BỘ ĐẾM "ĐANG GIỮ CHO ĐƠN" — phần chạy THEO LÔ (kho chuẩn quốc tế, lát 1 chạy bóng)
// Thiết kế: docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 13 (12/11/2026) + mục 14 (thiết kế lại 19/11/2026).
//
// Từng đơn một (webhook) đi qua integrations/order-stock.ts (deductStockTx { reserve },
// shipStockTx, releaseCommittedTx). Tệp này lo các việc nhiều đơn một lượt, mỗi lượt vài câu SQL,
// KHÔNG lặp từng đơn:
//   • shipOrdersTx            Biên bản bàn giao: cả lô đơn rời kho
//   • sweepShipped            quét bù (LƯỚI AN TOÀN): đơn đã sang Đang giao / Đã giao mà chưa đi qua
//                             đường rời kho theo sự kiện + đơn của gian không còn hoạt động
//   • releaseCommittedOfChannel   xóa gian: nhả giữ trước khi xóa đơn
//   • cutoverCommittedStep    ngày chuyển: đưa các đơn đang chờ giao vào bộ đếm (một lần)
//   • clearShippedMarks       một lần khi chuyển từ bản hai cột sang một cột: gỡ dấu giữ còn sót
//   • checkCommitted          đối chiếu hằng đêm — lệch thì BÁO, không tự sửa
//
// CHẠY BÓNG: chưa màn nào đọc bộ đếm, số đẩy sàn không dùng. Không hàm nào ở đây đụng
// Product.quantityInStock.
//
// ⚠️ BA LUẬT VIẾT CÂU ĐỌC TẬP "ĐANG GIỮ" (mục 14.3 — đo bằng scripts/stock-committed-plan-probe.ts):
//   1. Vị từ duy nhất là HELD_ORDER, khớp từng chữ với chỉ mục một phần "Order_stock_held_idx".
//   2. KHÔNG đặt LIMIT cùng tầng với một điều kiện lọc thêm trên tập này (trạng thái, gian): máy
//      nhân các tỉ lệ như độc lập, đoán "còn nhiều dòng khớp" rồi đi dọc cả bảng đơn để tìm. Gom
//      tập trong CTE MATERIALIZED trước, lọc + cắt lô ở ngoài.
//   3. ORDER BY "id" chỉ khi đã cố định "channelId" (thứ tự lấy thẳng từ chỉ mục). Câu toàn nền
//      tảng không sắp xếp trong SQL; khóa dòng thì khóa theo danh sách mã đã chọn.
// Sửa câu nào trong tệp này thì sửa câu cùng dạng trong script và chạy lại script.
// ============================================================
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { stockCommittedOn } from "./stock-ledger";
import type { ShipSource } from "../integrations/order-stock";

type Tx = Prisma.TransactionClient;

/**
 * Đơn ĐANG nằm trong bộ đếm giữ = còn dấu stockCommittedAt (dấu bị xóa lúc rời kho và lúc hủy
 * trước khi rời kho). PHẢI khớp từng chữ với vị từ của chỉ mục một phần "Order_stock_held_idx"
 * (migration 20261120090000) — lệch là Postgres quét cả bảng đơn.
 */
const HELD_ORDER = Prisma.sql`o."stockCommittedAt" IS NOT NULL`;

/**
 * Chốt chặn cho dấu CÒN SÓT của bản hai cột (trước 20/11/2026 lúc rời kho chỉ ghi stockShippedAt,
 * không xóa dấu): đơn đã có mốc rời kho thì bộ đếm đã trừ rồi, không bao giờ trừ lần hai. Sau
 * clearShippedMarks điều kiện này luôn đúng với mọi đơn còn dấu; giữ lại vì đơn đã rời kho mà
 * quay lại bộ đếm là hỏng số, còn phép lọc thì gần như không tốn gì trên tập nhỏ.
 */
const NOT_SHIPPED = Prisma.sql`o."stockShippedAt" IS NULL`;

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
 * Đánh dấu CẢ LÔ đã rời kho: ghi mốc + nguồn và XÓA dấu giữ trong cùng một câu (mục 14.1 dòng 1).
 * Nơi gọi đã khóa các dòng đơn và đã trừ bộ đếm.
 */
async function markShippedTx(tx: Tx, orderIds: string[], source: ShipSource): Promise<void> {
  if (orderIds.length === 0) return;
  await tx.$executeRaw`
    UPDATE "Order" SET "stockShippedAt" = ${NOW_UTC}, "stockShipSource" = ${source}, "stockCommittedAt" = NULL
    WHERE "id" = ANY(${orderIds}::text[])`;
}

/**
 * CẢ LÔ ĐƠN RỜI KHO (Biên bản bàn giao). Chỉ lấy đơn đang giữ, chưa rời kho; đơn khác bỏ qua êm.
 * Khóa dòng đơn (chờ webhook đang giữ khóa xong) rồi trừ bộ đếm + đánh mốc. Trả số đơn đã xuất.
 */
export async function shipOrdersTx(tx: Tx, orderIds: string[], source: ShipSource): Promise<number> {
  if (!stockCommittedOn() || orderIds.length === 0) return 0;
  const due = await tx.$queryRaw<{ id: string }[]>`
    SELECT o."id" FROM "Order" o
    WHERE o."id" = ANY(${orderIds}::text[]) AND ${HELD_ORDER} AND ${NOT_SHIPPED}
    ORDER BY o."id" FOR UPDATE OF o`;
  const ids = due.map((d) => d.id);
  if (ids.length === 0) return 0;
  await adjustCommittedForOrdersTx(tx, ids, -1);
  await markShippedTx(tx, ids, source);
  return ids.length;
}

export interface SweepResult {
  /** Đơn sàn đã báo Đang giao / Đã giao mà chưa qua đường rời kho theo sự kiện. */
  platform: number;
  /** Đơn của gian mất kết nối / ngủ đông — không còn được cập nhật nên ra khỏi bộ đếm. */
  channelInactive: number;
  /** Tổng số sản phẩm ra khỏi bộ đếm. */
  quantity: number;
  /** Số đơn câu chọn trả về ở lô này (gồm cả đơn đang bị khóa nên chưa xử lý được). */
  picked: number;
}

/**
 * Chọn tối đa `batch` đơn cần quét bù — KHÔNG khóa, chạy ngoài giao dịch.
 *
 * Luật 2: tập đang giữ được gom trong CTE MATERIALIZED chỉ với vị từ của chỉ mục; điều kiện "đã
 * giao" / "gian không còn sống" và LIMIT nằm ở ngoài. Chi phí theo cỡ tập đang giữ (đo local:
 * 424 đơn giữ ≈ 90 khối, 20.000 đơn giữ ≈ 4.000 khối), không theo cỡ bảng đơn. Viết gộp vào một
 * tầng thì ở 20.000 đơn giữ máy đi dọc cả khóa chính (73.000 khối trên bảng thử 230 MB).
 */
export async function pickSweepCandidates(batch: number): Promise<{ id: string; inactive: boolean }[]> {
  return prisma.$queryRaw<{ id: string; inactive: boolean }[]>`
    WITH g AS MATERIALIZED (
      SELECT o."id", o."channelId", o."shippingStatus", o."stockShippedAt"
      FROM "Order" o WHERE ${HELD_ORDER}
    )
    SELECT g."id", NOT (${LIVE_CHANNEL}) AS "inactive"
    FROM g JOIN "Channel" c ON c."id" = g."channelId"
    WHERE g."stockShippedAt" IS NULL
      AND (g."shippingStatus" IN ('SHIPPING','DELIVERED') OR NOT (${LIVE_CHANNEL}))
    LIMIT ${batch}::int`;
}

/**
 * MỘT LÔ QUÉT BÙ: chọn đơn (không khóa) → trong một giao dịch ngắn khóa đúng các đơn đã chọn theo
 * khóa chính rồi trừ bộ đếm + đánh mốc. SKIP LOCKED: đơn đang bị webhook giữ khóa thì bỏ qua,
 * lượt sau lấy. Gian không còn hoạt động → nhả ngay, không chờ hạn tuổi (đơn của gian đó đứng im).
 */
export async function sweepShippedBatch(batch: number): Promise<SweepResult> {
  const picked = await pickSweepCandidates(batch);
  if (picked.length === 0) return { platform: 0, channelInactive: 0, quantity: 0, picked: 0 };
  const inactiveById = new Map(picked.map((p) => [p.id, p.inactive]));
  const ids = [...inactiveById.keys()].sort();
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT o."id" FROM "Order" o
      WHERE o."id" = ANY(${ids}::text[]) AND ${HELD_ORDER} AND ${NOT_SHIPPED}
      ORDER BY o."id" FOR UPDATE OF o SKIP LOCKED`;
    const due = locked.map((d) => d.id);
    if (due.length === 0) return { platform: 0, channelInactive: 0, quantity: 0, picked: picked.length };
    const inactive = due.filter((id) => inactiveById.get(id));
    const platform = due.filter((id) => !inactiveById.get(id));
    const quantity = await adjustCommittedForOrdersTx(tx, due, -1);
    await markShippedTx(tx, platform, "PLATFORM");
    await markShippedTx(tx, inactive, "CHANNEL_INACTIVE");
    return { platform: platform.length, channelInactive: inactive.length, quantity, picked: picked.length };
  });
}

/** Quét bù tới khi hết việc (hoặc chạm trần số lô của một nhịp). */
export async function sweepShipped(opts: { batch: number; maxBatches: number }): Promise<Omit<SweepResult, "picked">> {
  const total = { platform: 0, channelInactive: 0, quantity: 0 };
  if (!stockCommittedOn()) return total;
  for (let i = 0; i < opts.maxBatches; i++) {
    const r = await sweepShippedBatch(opts.batch);
    total.platform += r.platform;
    total.channelInactive += r.channelInactive;
    total.quantity += r.quantity;
    // Hết việc, hoặc cả lô đang bị khóa (không xử lý được đơn nào) → để nhịp sau.
    if (r.picked < opts.batch || r.platform + r.channelInactive === 0) break;
  }
  return total;
}

/**
 * XÓA GIAN: nhả giữ toàn bộ đơn đang giữ của gian TRƯỚC khi xóa đơn (đơn bị xóa thì nhật ký mất
 * orderId, không còn cách nào trừ bộ đếm). Gian bị xóa đã ngắt kết nối nên thường quét bù đã nhả
 * rồi; hàm này chặn khoảng hở "ngắt xong xóa ngay". Trả số đơn đã nhả.
 *
 * Luật 3: "channelId" cố định nên ORDER BY "id" LIMIT lấy thứ tự thẳng từ chỉ mục
 * ("channelId", "id") — đo local gian 3.000 đơn giữ: 870 khối (chỉ mục chỉ có "channelId": 30.000).
 */
export async function releaseCommittedOfChannel(channelId: string): Promise<number> {
  if (!stockCommittedOn()) return 0;
  let released = 0;
  for (;;) {
    const n = await prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT o."id" FROM "Order" o
        WHERE o."channelId" = ${channelId} AND ${HELD_ORDER}
        ORDER BY o."id" LIMIT 500 FOR UPDATE OF o`;
      if (due.length === 0) return 0;
      // Dấu còn sót của bản hai cột (đã có mốc rời kho): bộ đếm đã trừ rồi → chỉ gỡ dấu.
      const stale = await tx.$queryRaw<{ id: string }[]>`
        SELECT o."id" FROM "Order" o
        WHERE o."id" = ANY(${due.map((d) => d.id)}::text[]) AND o."stockShippedAt" IS NOT NULL`;
      const staleIds = new Set(stale.map((s) => s.id));
      const ids = due.map((d) => d.id).filter((id) => !staleIds.has(id));
      await adjustCommittedForOrdersTx(tx, ids, -1);
      await markShippedTx(tx, ids, "CHANNEL_INACTIVE");
      if (staleIds.size) {
        await tx.$executeRaw`UPDATE "Order" SET "stockCommittedAt" = NULL WHERE "id" = ANY(${[...staleIds]}::text[])`;
      }
      return due.length;
    });
    released += n;
    if (n < 500) return released;
  }
}

// ---------- NGÀY CHUYỂN ----------

export const CUTOVER_JOB_KEY = "stock-committed-cutover";

/**
 * MỘT LÔ của ngày chuyển: đơn đã trừ kho, còn Chờ xử lý / Đã xử lý, chưa hủy, gian đang hoạt động
 * (đúng tập của cột "Chờ giao") mà CHƯA có dấu giữ và CHƯA rời kho → cộng vào bộ đếm, đánh dấu =
 * lúc đã trừ kho. Đơn chốt sau khi bản này lên đã tự có dấu (deductStockTx) nên không bị lấy lại.
 * Đơn ngoài tập (đã giao, đã hủy, gian chết, đã bàn giao cho vận chuyển) không vào bộ đếm.
 *
 * Luật 2: tập "chờ giao" được gom trong CTE MATERIALIZED đúng với vị từ của chỉ mục
 * "Order_stock_awaiting_ship_idx"; "chưa có dấu" + gian sống + LIMIT nằm ở ngoài. Sau đó khóa theo
 * danh sách mã và kiểm lại mọi điều kiện dưới khóa. Trả số đơn câu chọn lấy ra (`picked`, để
 * biết còn lô nữa không) và số đơn thật sự vào bộ đếm (`committed`).
 */
export async function cutoverCommittedBatch(batch: number): Promise<{ picked: number; committed: number }> {
  const picked = await prisma.$queryRaw<{ id: string }[]>`
    WITH w AS MATERIALIZED (
      SELECT o."id", o."channelId", o."stockCommittedAt", o."stockShippedAt"
      FROM "Order" o
      WHERE o."shippingStatus" IN ('PENDING','PROCESSED') AND o."stockRestoredAt" IS NULL
        AND o."stockDeductedAt" IS NOT NULL
    )
    SELECT w."id" FROM w JOIN "Channel" c ON c."id" = w."channelId" AND ${LIVE_CHANNEL}
    WHERE w."stockCommittedAt" IS NULL AND w."stockShippedAt" IS NULL
    LIMIT ${batch}::int`;
  if (picked.length === 0) return { picked: 0, committed: 0 };
  const pickedIds = picked.map((p) => p.id).sort();
  const committed = await prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT o."id" FROM "Order" o
      WHERE o."id" = ANY(${pickedIds}::text[])
        AND o."shippingStatus" IN ('PENDING','PROCESSED') AND o."stockRestoredAt" IS NULL
        AND o."stockDeductedAt" IS NOT NULL AND o."stockCommittedAt" IS NULL AND ${NOT_SHIPPED}
      ORDER BY o."id" FOR UPDATE OF o`;
    const ids = due.map((d) => d.id);
    if (ids.length === 0) return 0;
    await adjustCommittedForOrdersTx(tx, ids, 1);
    await tx.$executeRaw`
      UPDATE "Order" SET "stockCommittedAt" = "stockDeductedAt" WHERE "id" = ANY(${ids}::text[])`;
    return ids.length;
  });
  return { picked: picked.length, committed };
}

/**
 * Chạy ngày chuyển tới khi xong, ghi tiến độ ở maintenance_jobs. Đã xong (doneAt) thì chỉ đọc một
 * dòng rồi thôi. Trả số đơn đã đưa vào bộ đếm ở LƯỢT GỌI NÀY (0 = đã xong từ trước / không có gì).
 */
export async function runCutoverIfNeeded(
  batch: number
): Promise<{ alreadyDone: boolean; orders: number; done: boolean }> {
  if (!stockCommittedOn()) return { alreadyDone: true, orders: 0, done: true };
  const job = await prisma.maintenanceJob.findUnique({ where: { key: CUTOVER_JOB_KEY } });
  if (job?.doneAt) return { alreadyDone: true, orders: 0, done: true };
  let orders = 0;
  for (;;) {
    const r = await cutoverCommittedBatch(batch);
    orders += r.committed;
    if (r.committed > 0) {
      await prisma.maintenanceJob.upsert({
        where: { key: CUTOVER_JOB_KEY },
        create: { key: CUTOVER_JOB_KEY, processed: r.committed },
        update: { processed: { increment: r.committed }, updatedAt: new Date() },
      });
    }
    if (r.picked < batch) break;
    // Cả lô vừa chọn đã đổi trạng thái trước khi khóa được (không đơn nào vào): KHÔNG đánh dấu
    // xong — nhịp sau chạy tiếp, tránh vòng lặp vô ích trong nhịp này.
    if (r.committed === 0) return { alreadyDone: false, orders, done: false };
  }
  await prisma.maintenanceJob.upsert({
    where: { key: CUTOVER_JOB_KEY },
    create: { key: CUTOVER_JOB_KEY, processed: orders, doneAt: new Date() },
    update: { doneAt: new Date(), updatedAt: new Date() },
  });
  return { alreadyDone: false, orders, done: true };
}

// ---------- CHUYỂN TỪ HAI CỘT SANG MỘT CỘT (một lần) ----------

export const SINGLE_MARK_JOB_KEY = "stock-committed-single-mark";

/**
 * Gỡ dấu giữ CÒN SÓT của bản hai cột: đơn đã có stockShippedAt mà stockCommittedAt chưa xóa (bộ đếm
 * đã trừ từ lúc rời kho — ở đây KHÔNG đụng bộ đếm). Đọc qua chỉ mục một phần mới (tập = mọi đơn
 * còn dấu, không quét bảng), ghi theo lô 500. Chạy lại bao nhiêu lần cũng được. Trả số đơn đã gỡ.
 */
export async function clearShippedMarks(): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o."id" FROM "Order" o WHERE ${HELD_ORDER} AND o."stockShippedAt" IS NOT NULL`;
  let cleared = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id);
    cleared += await prisma.$executeRaw`
      UPDATE "Order" SET "stockCommittedAt" = NULL
      WHERE "id" = ANY(${ids}::text[]) AND "stockShippedAt" IS NOT NULL AND "stockCommittedAt" IS NOT NULL`;
  }
  return cleared;
}

/** Chạy clearShippedMarks đúng một lần (nhớ ở maintenance_jobs). Muốn chạy lại: xóa dòng khóa này. */
export async function runSingleMarkIfNeeded(): Promise<{ alreadyDone: boolean; cleared: number }> {
  if (!stockCommittedOn()) return { alreadyDone: true, cleared: 0 };
  const job = await prisma.maintenanceJob.findUnique({ where: { key: SINGLE_MARK_JOB_KEY } });
  if (job?.doneAt) return { alreadyDone: true, cleared: 0 };
  const cleared = await clearShippedMarks();
  await prisma.maintenanceJob.upsert({
    where: { key: SINGLE_MARK_JOB_KEY },
    create: { key: SINGLE_MARK_JOB_KEY, processed: cleared, doneAt: new Date() },
    update: { processed: cleared, doneAt: new Date(), updatedAt: new Date() },
  });
  return { alreadyDone: false, cleared };
}

/**
 * DỰNG LẠI TỪ ĐẦU (sau khi tắt công tắc STOCK_COMMITTED_OFF một thời gian rồi bật lại — trong lúc
 * tắt, đơn rời kho / hủy không trừ bộ đếm nên số cũ không còn tin được): về 0 mọi bộ đếm, gỡ dấu
 * của các đơn đang giữ, xóa dấu "đã chuyển". Nhịp worker kế tiếp tự chạy lại ngày chuyển.
 * KHÔNG tự chạy ở đâu — gọi tay khi cần.
 */
export async function resetCommitted(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Order" o SET "stockCommittedAt" = NULL WHERE ${HELD_ORDER}`;
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
  /**
   * Đơn đã có mốc rời kho mà còn dấu giữ. PHẢI bằng 0 sau khi clearShippedMarks chạy — khác 0 là
   * còn một đường ghi mốc rời kho mà không xóa dấu (hoặc bản cũ còn chạy lúc deploy).
   */
  shippedStillMarked: number;
  /** Đơn đang giữ mà trạng thái đã là Đã hủy (hủy ghi qua đường không cộng lại sổ — lỗ có sẵn). */
  cancelledStillCommitted: number;
  /** Tuổi (giờ) của đơn giữ lâu nhất. */
  oldestHours: number;
}

/** Số chỗ lệch CỨNG của một lần đối chiếu — phải bằng 0. */
export function hardMismatch(c: CommittedCheck): number {
  return c.counterMismatch + c.levelMismatch + c.shippedStillMarked;
}

/**
 * Ba phép so của mục 13.5 + số đơn "đã rời kho còn dấu" (mục 14.5). Toàn nền tảng, vài câu SQL;
 * tập đơn đang giữ đi qua chỉ mục một phần, không câu nào có LIMIT (luật 2 không áp).
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
      WHERE ${HELD_ORDER} AND ${NOT_SHIPPED} GROUP BY 1
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
      WHERE ${HELD_ORDER} AND ${NOT_SHIPPED} AND il."locationId" IS NOT NULL GROUP BY 1, 2
    ),
    cnt AS (SELECT "productId" AS pid, "locationId" AS lid, "committed" AS qty FROM "product_stock_levels" WHERE "committed" <> 0)
    SELECT (COUNT(*) FILTER (WHERE COALESCE(c.qty, 0) <> COALESCE(t.qty, 0)))::int AS "levelMismatch"
    FROM truth t FULL JOIN cnt c USING (pid, lid)`;

  const [orders] = await prisma.$queryRaw<
    { committedOrders: number; shippedStillMarked: number; cancelledStillCommitted: number; oldestHours: number }[]
  >`
    SELECT (COUNT(*) FILTER (WHERE ${NOT_SHIPPED}))::int AS "committedOrders",
           (COUNT(*) FILTER (WHERE o."stockShippedAt" IS NOT NULL))::int AS "shippedStillMarked",
           (COUNT(*) FILTER (WHERE ${NOT_SHIPPED} AND o."shippingStatus" = 'CANCELLED'))::int AS "cancelledStillCommitted",
           COALESCE(EXTRACT(EPOCH FROM (${NOW_UTC} - MIN(o."stockCommittedAt") FILTER (WHERE ${NOT_SHIPPED}))) / 3600, 0)::int AS "oldestHours"
    FROM "Order" o WHERE ${HELD_ORDER}`;

  return { ...byProduct, levelMismatch: byLevel.levelMismatch, ...orders };
}

/** Nội dung cột cursor của dòng đối chiếu: kết quả lần cuối + chuỗi tự đếm (mục 14.5). */
export interface CommittedCheckRecord extends CommittedCheck {
  at: string;
  /** Số lần đối chiếu LIÊN TIẾP lệch cứng 0, tính cả lần này. Điều kiện sang lát 2: đủ 7. */
  streak: number;
  /** Lần gần nhất có lệch cứng (null = chưa lần nào kể từ khi đếm). */
  lastMismatchAt: string | null;
}

/**
 * Chuỗi mới sau một lần đối chiếu, `periodHours` = nhịp đối chiếu. Thuần, để test được:
 *   • lần này lệch cứng → 0;
 *   • lần trước cách quá nhịp + 2 giờ (đối chiếu bỏ nhịp) → đếm lại từ 1, vì "liên tiếp" nghĩa là
 *     đêm nào cũng có — đúng luật đã áp bằng tay trong tuần chạy bóng đầu (dòng cách > 26 giờ không tính);
 *   • lần trước cách CHƯA tới nửa nhịp (chạy lại bằng tay, hoặc hai tiến trình worker cùng đối
 *     chiếu) → giữ nguyên chuỗi, không cộng: một đêm chỉ được tính một lần. Chốt chặn này tính từ
 *     dòng ở DB nên đúng cả khi có nhiều tiến trình;
 *   • còn lại → chuỗi cũ + 1. Dòng cũ không có `streak` (bản trước 20/11) coi như 0.
 */
export function nextStreak(
  prev: { at?: string; streak?: number } | null,
  hard: number,
  now: Date,
  periodHours: number
): number {
  if (hard > 0) return 0;
  const prevAt = prev?.at ? Date.parse(prev.at) : NaN;
  if (!Number.isFinite(prevAt)) return 1;
  const gapHours = (now.getTime() - prevAt) / 3_600_000;
  if (gapHours > periodHours + 2) return 1;
  const streak = prev?.streak ?? 0;
  return gapHours < periodHours / 2 ? Math.max(streak, 1) : streak + 1;
}

/**
 * Chạy đối chiếu + ghi kết quả vào maintenance_jobs (cursor = JSON CommittedCheckRecord, processed =
 * tổng số chỗ lệch cứng). `periodHours` = nhịp đối chiếu (mặc định 24).
 */
export async function runCommittedCheck(periodHours = 24): Promise<CommittedCheckRecord> {
  const check = await checkCommitted();
  const hard = hardMismatch(check);
  const now = new Date();
  const prevRow = await prisma.maintenanceJob.findUnique({ where: { key: CHECK_JOB_KEY }, select: { cursor: true } });
  let prev: Partial<CommittedCheckRecord> | null = null;
  try {
    prev = prevRow?.cursor ? (JSON.parse(prevRow.cursor) as Partial<CommittedCheckRecord>) : null;
  } catch {
    prev = null;
  }
  const record: CommittedCheckRecord = {
    at: now.toISOString(),
    ...check,
    streak: nextStreak(prev, hard, now, periodHours),
    lastMismatchAt: hard > 0 ? now.toISOString() : (prev?.lastMismatchAt ?? null),
  };
  const summary = JSON.stringify(record);
  await prisma.maintenanceJob.upsert({
    where: { key: CHECK_JOB_KEY },
    create: { key: CHECK_JOB_KEY, cursor: summary, processed: hard },
    update: { cursor: summary, processed: hard, updatedAt: now },
  });
  return record;
}
