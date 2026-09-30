// ============================================================
// SỔ CÁI ĐƠN — TẦNG DATABASE (docs/SO-CAI-DON.md)
//
// Mọi thao tác ghi/đọc hai bảng order_ledger + order_line_ledger đi qua đây:
//   · claimDirtyLedgerRows  : nhặt dòng bẩn (trigger đánh dấu) theo lô, an toàn
//                             nhiều worker (FOR UPDATE SKIP LOCKED + claimedAt).
//   · recomputeLedgerOrders : đọc đơn gốc kèm quan hệ, chạy buildLedgerRows, ghi
//                             sổ bằng SQL theo lô trong một transaction. Chỉ xóa
//                             dirtyAt khi không có mốc bẩn MỚI chen vào giữa lúc
//                             claim và lúc ghi (so IS NOT DISTINCT) → không mất
//                             cập nhật.
//   · ledgerSummary         : cộng theo nhóm × cột TRONG DATABASE (SUM FILTER).
//   · ensureLedgerFresh     : báo cáo gọi trước khi cộng — tính nốt dòng bẩn trong
//                             kỳ (có trần, trả về số còn lại: không im lặng).
//   · auditLedger           : job đêm lấy mẫu tính lại từ đơn gốc so với sổ.
//   · ensureLedgerPartitions, markFormulaVersionStale, markLedgerScope: bảo trì.
//
// Quy ước SQL thô: mọi tham số đều ép kiểu tường minh (::numeric, ::date,
// ::"ShippingStatus"...) vì Prisma gửi chuỗi dưới dạng text; VALUES nhiều dòng
// ghi theo lô ≤ 100 đơn/câu để dưới trần 65.535 tham số của Postgres.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  buildLedgerRows,
  diffLedgerRows,
  emptyGroupTotals,
  LEDGER_FORMULA_VERSION,
  LEDGER_GROUP_KEYS,
  LEDGER_GROUPS,
  LEDGER_INCLUDE,
  ORDER_LEDGER_MONEY_COLUMNS,
  summarizeLedgerRowsInMemory,
  type LedgerOrder,
  type LedgerSummary,
  type OrderLedgerRow,
  type OrderLineLedgerRow,
} from "../lib/order-ledger";
import type { ChannelScope } from "../lib/channel-filter";
import { toBusinessDateKey, type DateRangeFilter } from "../lib/date-range";

/** Dòng đang được worker cầm quá mốc này coi như worker đã chết → nhặt lại. */
export const LEDGER_CLAIM_STALE_MS = 10 * 60_000;
/** Số đơn mỗi câu INSERT (≈ 50 tham số/dòng đơn, ≈ 40/dòng hàng). */
const WRITE_CHUNK = 100;
/**
 * Nghỉ giữa hai lô ghi (ms) — nhường CPU/kết nối database cho luồng đơn của
 * seller khi dựng sổ hàng chục nghìn đơn. Mặc định tự chọn 250ms: lô 100 đơn
 * ≈ 300–600ms trên Supabase → sổ cái chiếm dưới 2/3 thời gian một kết nối.
 * LEDGER_CHUNK_PAUSE_MS=0 để tắt (chạy script drain lúc vắng khách).
 */
const CHUNK_PAUSE_MS = Math.max(0, Number(process.env.LEDGER_CHUNK_PAUSE_MS ?? 500) || 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LedgerClaim {
  orderId: string;
  /** Mốc bẩn lúc nhặt — ghi xong chỉ xóa nếu mốc trên dòng vẫn là mốc này. */
  dirtyAt: Date | null;
}

// ------------------------------------------------------------
// Phạm vi (gian + kỳ) → mảnh WHERE dùng chung
// ------------------------------------------------------------

export type LedgerDateAxis = "created" | "delivered" | "settled";

const AXIS_COLUMNS: Record<LedgerDateAxis, { ts: string; date: string }> = {
  created: { ts: `"createdAt"`, date: `"createdDate"` },
  delivered: { ts: `"deliveredAt"`, date: `"deliveredDate"` },
  settled: { ts: `"settledAt"`, date: `"settledDate"` },
};

/**
 * WHERE cho phạm vi gian (cùng nghĩa với `channel: scope` của Prisma) + kỳ.
 * Kỳ lọc trên cột thời gian (đúng biên giờ VN) VÀ cột ngày (để Postgres cắt
 * phân mảnh theo tháng). `alias` = tên bảng/bí danh đứng trước cột.
 */
export function ledgerScopeSql(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  opts: { axis?: LedgerDateAxis; alias?: string } = {}
): Prisma.Sql {
  const a = opts.alias ? Prisma.raw(`${opts.alias}.`) : Prisma.empty;
  const parts: Prisma.Sql[] = [Prisma.sql`${a}"ownerId" = ${scope.userId}`];
  if (typeof scope.id === "string") {
    parts.push(Prisma.sql`${a}"channelId" = ${scope.id}`);
  } else if (scope.id && "in" in scope.id) {
    if (scope.id.in.length === 0) parts.push(Prisma.sql`FALSE`);
    else parts.push(Prisma.sql`${a}"channelId" IN (${Prisma.join(scope.id.in)})`);
  }
  if (scope.channelName) {
    parts.push(Prisma.sql`${a}"channelName" = ${scope.channelName}::"ChannelName"`);
  }
  if (range) {
    const col = AXIS_COLUMNS[opts.axis ?? "created"];
    parts.push(
      Prisma.sql`${a}${Prisma.raw(col.ts)} >= ${range.gte.toISOString()}::timestamp AND ${a}${Prisma.raw(col.ts)} <= ${range.lte.toISOString()}::timestamp`
    );
    parts.push(
      Prisma.sql`${a}${Prisma.raw(col.date)} >= ${toBusinessDateKey(range.gte)}::date AND ${a}${Prisma.raw(col.date)} <= ${toBusinessDateKey(range.lte)}::date`
    );
  }
  return Prisma.join(parts, " AND ");
}

// ------------------------------------------------------------
// Nhặt việc
// ------------------------------------------------------------

/**
 * Nhặt tối đa `limit` dòng bẩn, cũ nhất trước (FIFO), ghim claimedAt. Nhiều
 * worker song song không nhặt trùng (SKIP LOCKED). Dòng bị cầm quá
 * LEDGER_CLAIM_STALE_MS được nhặt lại. Tùy chọn thu hẹp theo phạm vi (báo cáo
 * tính nốt đơn của kỳ mình cần).
 */
export async function claimDirtyLedgerRows(
  limit: number,
  opts: { scope?: ChannelScope; range?: DateRangeFilter } = {}
): Promise<LedgerClaim[]> {
  const scopeSql = opts.scope
    ? Prisma.sql`AND ${ledgerScopeSql(opts.scope, opts.range, { alias: "l" })}`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ orderId: string; dirtyAt: Date | null }[]>(Prisma.sql`
    WITH picked AS (
      SELECT l."createdDate", l."orderId"
      FROM "order_ledger" l
      WHERE l."dirtyAt" IS NOT NULL
        AND (l."claimedAt" IS NULL OR l."claimedAt" < now() - (${LEDGER_CLAIM_STALE_MS}::int * INTERVAL '1 millisecond'))
        ${scopeSql}
      ORDER BY l."dirtyAt"
      LIMIT ${Math.max(1, Math.floor(limit))}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "order_ledger" u
    SET "claimedAt" = now()
    FROM picked p
    WHERE u."createdDate" = p."createdDate" AND u."orderId" = p."orderId"
    RETURNING u."orderId", u."dirtyAt"
  `);
  return rows.map((r) => ({ orderId: r.orderId, dirtyAt: r.dirtyAt }));
}

// ------------------------------------------------------------
// Ghi sổ
// ------------------------------------------------------------

const money = (n: number) => Prisma.sql`${n.toFixed(2)}::numeric`;
const dateOrNull = (d: string | null) => (d === null ? Prisma.sql`NULL::date` : Prisma.sql`${d}::date`);
// Mốc thời gian gửi dưới dạng CHUỖI ISO (UTC, có "Z") rồi ép kiểu: cột
// timestamp (không múi) nhận chuỗi ISO và BỎ QUA phần múi → đúng giờ UTC như
// Prisma vẫn lưu; cột timestamptz đọc "Z" nên cũng đúng. Không gửi Date thô để
// khỏi phụ thuộc cách driver gán kiểu tham số và TimeZone của phiên.
const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`;
const tsOrNull = (d: Date | null) => (d === null ? Prisma.sql`NULL::timestamp` : ts(d));
const tstzOrNull = (d: Date | null) =>
  d === null ? Prisma.sql`NULL::timestamptz` : Prisma.sql`${d.toISOString()}::timestamptz`;

const ORDER_COLUMNS = [
  "orderId", "createdDate", "channelId", "ownerId", "channelName", "orderCode",
  "createdAt", "deliveredAt", "deliveredDate", "settledAt", "settledDate",
  "shippingStatus", "returnStatus", "isSettled", "returnType", "countsAsRevenue", "isReturning", "isLoss",
  "missingCostPrice", "itemCount", "totalQuantity", "returnedQuantity",
  ...ORDER_LEDGER_MONEY_COLUMNS,
  "refundEstimated", "refundSource",
  "formulaVersion", "computedAt", "dirtyAt", "claimedAt",
] as const;

function orderValues(r: OrderLedgerRow, claimedDirtyAt: Date | null): Prisma.Sql {
  const moneyCols = ORDER_LEDGER_MONEY_COLUMNS.map((c) => money(r[c]));
  return Prisma.sql`(
    ${r.orderId}, ${r.createdDate}::date, ${r.channelId}, ${r.ownerId}, ${r.channelName}::"ChannelName", ${r.orderCode},
    ${ts(r.createdAt)}, ${tsOrNull(r.deliveredAt)}, ${dateOrNull(r.deliveredDate)}, ${tsOrNull(r.settledAt)}, ${dateOrNull(r.settledDate)},
    ${r.shippingStatus}::"ShippingStatus", ${r.returnStatus}::"ReturnStatus", ${r.isSettled}::boolean,
    ${r.returnType}::"LedgerReturnType", ${r.countsAsRevenue}::boolean, ${r.isReturning}::boolean, ${r.isLoss}::boolean,
    ${r.missingCostPrice}::boolean, ${r.itemCount}::int, ${r.totalQuantity}::int, ${r.returnedQuantity}::int,
    ${Prisma.join(moneyCols)},
    ${r.refundEstimated}::boolean, ${r.refundSource},
    ${r.formulaVersion}::int, now(), NULL::timestamptz, ${tstzOrNull(claimedDirtyAt)}
  )`;
}

const LINE_COLUMNS = [
  "orderItemId", "createdDate", "orderId", "channelId", "ownerId", "channelName", "productId", "channelSku", "productName",
  "createdAt", "deliveredDate", "settledDate", "shippingStatus", "returnStatus", "isSettled", "countsAsRevenue", "missingCostPrice",
  "quantity", "returnedQuantity", "recoveredQuantity", "price", "costPriceAtSale", "lineGross", "lineCost", "costSnapshot", "recoveredCost",
  "share", "revenueGross", "actualRevenue", "platformRevenue", "platformDeduction", "refundedAmount", "feeGmvMax", "profit", "profitAfterTax",
  "formulaVersion",
] as const;

function lineValues(l: OrderLineLedgerRow): Prisma.Sql {
  return Prisma.sql`(
    ${l.orderItemId}, ${l.createdDate}::date, ${l.orderId}, ${l.channelId}, ${l.ownerId}, ${l.channelName}::"ChannelName",
    ${l.productId}, ${l.channelSku}, ${l.productName},
    ${ts(l.createdAt)}, ${dateOrNull(l.deliveredDate)}, ${dateOrNull(l.settledDate)},
    ${l.shippingStatus}::"ShippingStatus", ${l.returnStatus}::"ReturnStatus", ${l.isSettled}::boolean, ${l.countsAsRevenue}::boolean, ${l.missingCostPrice}::boolean,
    ${l.quantity}::int, ${l.returnedQuantity}::int, ${l.recoveredQuantity}::int,
    ${money(l.price)}, ${money(l.costPriceAtSale)}, ${money(l.lineGross)}, ${money(l.lineCost)}, ${money(l.costSnapshot)}, ${money(l.recoveredCost)},
    ${l.share.toFixed(10)}::numeric,
    ${money(l.revenueGross)}, ${money(l.actualRevenue)}, ${money(l.platformRevenue)}, ${money(l.platformDeduction)}, ${money(l.refundedAmount)},
    ${money(l.feeGmvMax)}, ${money(l.profit)}, ${money(l.profitAfterTax)},
    ${l.formulaVersion}::int
  )`;
}

const quoteList = (cols: readonly string[]) => Prisma.raw(cols.map((c) => `"${c}"`).join(", "));

/** SET của ON CONFLICT: mọi cột tính toán lấy từ EXCLUDED; dirtyAt theo luật "không mất mốc mới". */
const ORDER_UPSERT_SET = Prisma.raw(
  ORDER_COLUMNS.filter((c) => !["orderId", "createdDate", "dirtyAt", "claimedAt"].includes(c))
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(",\n      ") +
    `,\n      "dirtyAt" = CASE WHEN "order_ledger"."dirtyAt" IS NOT DISTINCT FROM EXCLUDED."claimedAt" THEN NULL ELSE "order_ledger"."dirtyAt" END` +
    `,\n      "claimedAt" = NULL`
);

/**
 * Ghi sổ cho các đơn đã nhặt. Đọc đơn gốc kèm quan hệ (LEDGER_INCLUDE), dựng
 * dòng bằng buildLedgerRows, ghi theo lô. Đơn không còn tồn tại → dòng sổ đã
 * bị FK CASCADE xóa, bỏ qua. Trả số đơn ghi + số đơn mất.
 */
export async function recomputeLedgerOrders(
  claims: LedgerClaim[]
): Promise<{ written: number; missing: number; lines: number }> {
  if (claims.length === 0) return { written: 0, missing: 0, lines: 0 };
  const claimedAt = new Map(claims.map((c) => [c.orderId, c.dirtyAt]));
  const ids = claims.map((c) => c.orderId);
  let written = 0;
  let lines = 0;
  const seen = new Set<string>();

  for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
    const chunkIds = ids.slice(i, i + WRITE_CHUNK);
    const orders: LedgerOrder[] = await prisma.order.findMany({
      where: { id: { in: chunkIds } },
      include: LEDGER_INCLUDE,
    });
    if (orders.length === 0) continue;
    const built = orders.map((o) => buildLedgerRows(o));
    for (const o of orders) seen.add(o.id);
    try {
      await writeLedgerChunk(built, claimedAt);
    } catch (err) {
      // Ghi hỏng (DB timeout, mất kết nối) → nhả ngay các dòng đã nhặt để lượt
      // sau thử lại, thay vì đợi hết hạn cầm 10 phút. Không nuốt lỗi.
      await prisma
        .$executeRaw(Prisma.sql`
          UPDATE "order_ledger" SET "claimedAt" = NULL
          WHERE ("createdDate", "orderId") IN (${Prisma.join(
            built.map((b) => Prisma.sql`(${b.order.createdDate}::date, ${b.order.orderId})`)
          )}) AND "claimedAt" IS NOT NULL
        `)
        .catch(() => undefined);
      throw err;
    }
    written += built.length;
    lines += built.reduce((s, b) => s + b.lines.length, 0);
    if (CHUNK_PAUSE_MS > 0 && i + WRITE_CHUNK < ids.length) await sleep(CHUNK_PAUSE_MS);
  }
  return { written, missing: ids.length - seen.size, lines };
}

async function writeLedgerChunk(
  built: ReturnType<typeof buildLedgerRows>[],
  claimedAt: Map<string, Date | null>
): Promise<void> {
  // Mọi điều kiện đều kèm "createdDate" để Postgres CẮT MẢNH: chỉ chạm 1–2 mảnh
  // tháng thay vì quét chỉ mục của cả 84 mảnh mỗi câu (30/09/2026 trên prod:
  // lô dựng sổ 42.000 đơn làm database chậm, pool 5 kết nối của worker cạn,
  // hàng đợi webhook TikTok và đẩy tồn báo timeout).
  const keys = Prisma.join(
    built.map((b) => Prisma.sql`(${b.order.createdDate}::date, ${b.order.orderId})`)
  );
  const orderRows = Prisma.join(
    built.map((b) => orderValues(b.order, claimedAt.get(b.order.orderId) ?? null))
  );
  const lineRows = built.flatMap((b) => b.lines.map(lineValues));

  await prisma.$transaction(async (tx) => {
    // Đơn đổi ngày tạo sang tháng khác: trigger order_ledger_mark đã dời dòng
    // sang mảnh đúng nên ON CONFLICT trúng. Trường hợp hiếm lọt (đổi ngày đúng
    // lúc worker ghi) sinh dòng đôi → job đối soát đêm đếm và tự sửa
    // (auditLedger.duplicateOrders), không trả giá quét 84 mảnh ở đường nóng.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "order_ledger" (${quoteList(ORDER_COLUMNS)})
      VALUES ${orderRows}
      ON CONFLICT ("createdDate", "orderId") DO UPDATE SET
      ${ORDER_UPSERT_SET}
    `);
    // Dòng vừa INSERT mới (không có dòng nháp) mang claimedAt = mốc nhặt → xóa.
    await tx.$executeRaw(Prisma.sql`
      UPDATE "order_ledger" SET "claimedAt" = NULL
      WHERE ("createdDate", "orderId") IN (${keys}) AND "claimedAt" IS NOT NULL AND "dirtyAt" IS NULL
    `);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "order_line_ledger" WHERE ("createdDate", "orderId") IN (${keys})
    `);
    if (lineRows.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "order_line_ledger" (${quoteList(LINE_COLUMNS)})
        VALUES ${Prisma.join(lineRows)}
      `);
    }
  }, { timeout: 60_000, maxWait: 15_000 });
}

/** Một lượt worker: nhặt → ghi. Trả số đã xử lý (0 = hết việc). */
export async function drainLedgerOnce(
  batch: number,
  opts: { scope?: ChannelScope; range?: DateRangeFilter } = {}
): Promise<{ claimed: number; written: number; missing: number }> {
  const claims = await claimDirtyLedgerRows(batch, opts);
  if (claims.length === 0) return { claimed: 0, written: 0, missing: 0 };
  const r = await recomputeLedgerOrders(claims);
  return { claimed: claims.length, written: r.written, missing: r.missing };
}

// ------------------------------------------------------------
// Đọc: cộng trong database
// ------------------------------------------------------------

export interface LedgerFreshness {
  /** Dòng còn bẩn trong phạm vi (chưa tính lại). */
  dirty: number;
  /** Dòng tính bằng phiên bản công thức cũ. */
  staleVersion: number;
}

export async function ledgerFreshness(
  scope: ChannelScope,
  range?: DateRangeFilter,
  axis: LedgerDateAxis = "created"
): Promise<LedgerFreshness> {
  const rows = await prisma.$queryRaw<{ dirty: bigint; stale: bigint }[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE "dirtyAt" IS NOT NULL) AS dirty,
           count(*) FILTER (WHERE "dirtyAt" IS NULL AND "formulaVersion" <> ${LEDGER_FORMULA_VERSION}::int) AS stale
    FROM "order_ledger"
    WHERE ${ledgerScopeSql(scope, range, { axis })}
  `);
  return { dirty: Number(rows[0]?.dirty ?? 0), staleVersion: Number(rows[0]?.stale ?? 0) };
}

/**
 * Báo cáo gọi TRƯỚC khi cộng: tính nốt các dòng bẩn của phạm vi (tối đa
 * `maxInline` đơn — mặc định 2.000, chừng 3–6 giây). Trả số còn lại để nơi gọi
 * báo "X đơn đang chờ cập nhật" thay vì cộng thiếu trong im lặng.
 */
export async function ensureLedgerFresh(
  scope: ChannelScope,
  range?: DateRangeFilter,
  opts: { maxInline?: number; axis?: LedgerDateAxis } = {}
): Promise<LedgerFreshness & { recomputed: number }> {
  const max = opts.maxInline ?? 2000;
  let recomputed = 0;
  while (recomputed < max) {
    const r = await drainLedgerOnce(Math.min(200, max - recomputed), { scope, range });
    if (r.claimed === 0) break;
    recomputed += r.claimed;
  }
  const fresh = await ledgerFreshness(scope, range, opts.axis);
  return { ...fresh, recomputed };
}

/**
 * TỔNG THEO NHÓM × CỘT trong database — một câu SELECT, SUM ... FILTER theo
 * điều kiện nhóm (LEDGER_GROUPS). Chỉ cộng dòng đã tính bằng phiên bản công
 * thức hiện tại (dòng bẩn vẫn cộng theo số cũ của nó — nơi gọi kiểm freshness).
 */
export async function ledgerSummary(
  scope: ChannelScope,
  range?: DateRangeFilter,
  opts: { axis?: LedgerDateAxis } = {}
): Promise<LedgerSummary> {
  const selects: string[] = [];
  for (const g of LEDGER_GROUP_KEYS) {
    const cond = LEDGER_GROUPS[g].sql;
    selects.push(`count(*) FILTER (WHERE ${cond}) AS "${g}__count"`);
    selects.push(`count(*) FILTER (WHERE ${cond} AND "missingCostPrice") AS "${g}__missingCostCount"`);
    selects.push(
      `COALESCE(sum("profitAfterTax") FILTER (WHERE ${cond} AND "missingCostPrice"), 0) AS "${g}__missingCostExcludedProfit"`
    );
    selects.push(`count(*) FILTER (WHERE ${cond} AND "isLoss") AS "${g}__lossCount"`);
    selects.push(`count(*) FILTER (WHERE ${cond} AND "returnType" IS NOT NULL) AS "${g}__returnCount"`);
    selects.push(`COALESCE(sum("totalQuantity") FILTER (WHERE ${cond}), 0) AS "${g}__totalQuantity"`);
    for (const c of ORDER_LEDGER_MONEY_COLUMNS) {
      selects.push(`COALESCE(sum("${c}") FILTER (WHERE ${cond}), 0) AS "${g}__${c}"`);
    }
  }
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT ${Prisma.raw(selects.join(",\n      "))}
    FROM "order_ledger"
    WHERE ${ledgerScopeSql(scope, range, { axis: opts.axis })}
      AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
  `);
  const raw = rows[0] ?? {};
  const out = {} as LedgerSummary;
  for (const g of LEDGER_GROUP_KEYS) {
    const t = emptyGroupTotals();
    for (const k of Object.keys(t) as (keyof typeof t)[]) {
      t[k] = Number(raw[`${g}__${k}`] ?? 0);
    }
    out[g] = t;
  }
  return out;
}

// ------------------------------------------------------------
// Bảo trì
// ------------------------------------------------------------

/** Tạo sẵn phân mảnh tới `monthsAhead` tháng sau (idempotent). Trả số mảnh mới. */
export async function ensureLedgerPartitions(monthsAhead = 3): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT "order_ledger_ensure_partitions"(date_trunc('month', now() AT TIME ZONE 'UTC')::date, ${monthsAhead}::int) AS n
  `);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Đổi công thức: đánh bẩn (theo lô) các dòng còn mang phiên bản cũ để worker
 * tính lại nền. Trả số dòng vừa đánh; gọi lặp tới khi trả 0.
 */
export async function markFormulaVersionStale(limit = 5000): Promise<number> {
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "order_ledger" l SET "dirtyAt" = clock_timestamp(), "dirtyReason" = ${`formula:v${LEDGER_FORMULA_VERSION}`}
    FROM (
      SELECT "createdDate", "orderId" FROM "order_ledger"
      WHERE "formulaVersion" <> ${LEDGER_FORMULA_VERSION}::int AND "dirtyAt" IS NULL
      LIMIT ${limit}::int
    ) s
    WHERE l."createdDate" = s."createdDate" AND l."orderId" = s."orderId"
  `);
  return n;
}

/**
 * Đánh bẩn toàn bộ dòng của một phạm vi (công cụ HQ / script: "tính lại sổ cho
 * shop X kỳ Y"). Đồng thời tạo dòng nháp cho đơn nào chưa có trong sổ (phòng
 * trường hợp trigger từng bị tắt). Trả số dòng đánh + số nháp tạo.
 */
export async function markLedgerScope(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  reason: string
): Promise<{ marked: number; stubbed: number }> {
  const stubbed = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "order_ledger" (
      "orderId", "createdDate", "channelId", "ownerId", "channelName", "orderCode",
      "createdAt", "shippingStatus", "returnStatus", "dirtyAt", "dirtyReason"
    )
    SELECT o."id", (o."createdAt" + INTERVAL '7 hours')::date, o."channelId", c."userId", c."channelName", o."orderCode",
           o."createdAt", o."shippingStatus", o."returnStatus", clock_timestamp(), ${reason}
    FROM "Order" o
    JOIN "Channel" c ON c."id" = o."channelId"
    WHERE c."userId" = ${scope.userId}
      ${typeof scope.id === "string" ? Prisma.sql`AND c."id" = ${scope.id}` : Prisma.empty}
      ${scope.id && typeof scope.id !== "string" ? (scope.id.in.length ? Prisma.sql`AND c."id" IN (${Prisma.join(scope.id.in)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
      ${scope.channelName ? Prisma.sql`AND c."channelName" = ${scope.channelName}::"ChannelName"` : Prisma.empty}
      ${range ? Prisma.sql`AND o."createdAt" >= ${range.gte.toISOString()}::timestamp AND o."createdAt" <= ${range.lte.toISOString()}::timestamp` : Prisma.empty}
      AND NOT EXISTS (SELECT 1 FROM "order_ledger" l WHERE l."orderId" = o."id")
    ON CONFLICT ("createdDate", "orderId") DO NOTHING
  `);
  const marked = await prisma.$executeRaw(Prisma.sql`
    UPDATE "order_ledger" SET "dirtyAt" = clock_timestamp(), "dirtyReason" = ${reason}
    WHERE ${ledgerScopeSql(scope, range)} AND "dirtyAt" IS NULL
  `);
  return { marked, stubbed };
}

// ------------------------------------------------------------
// Đối soát đêm: sổ ↔ đơn gốc
// ------------------------------------------------------------

export interface LedgerAuditResult {
  sampled: number;
  mismatched: number;
  /** Đơn có dòng ở hai mảnh (đã xóa dòng lạc + đánh bẩn). Phải luôn 0. */
  duplicateOrders: number;
  dirtyBacklog: number;
  staleDirty: number;
  defaultRows: number;
  durationMs: number;
  mismatches: { orderId: string; orderCode: string; diffs: ReturnType<typeof diffLedgerRows> }[];
}

/**
 * Lấy mẫu `sampleSize` dòng đã tính (không bẩn, phiên bản hiện tại, tính xong
 * ≥ 1 giờ), tính lại từ đơn gốc và so từng cột tiền. Lệch ≥ 0,5 đồng → ghi
 * chi tiết + đánh bẩn để worker sửa (tự lành). Kết quả lưu order_ledger_audit
 * cho trang HQ; lệch > 0 là dấu hiệu trigger/worker có lỗ hổng, phải điều tra
 * chứ không chỉ sửa số.
 */
export async function auditLedger(
  sampleSize = 200,
  opts: { minAgeMs?: number } = {}
): Promise<LedgerAuditResult> {
  const t0 = Date.now();
  // Mặc định chỉ lấy dòng tính xong ≥ 1 giờ (đêm): dòng vừa ghi vài giây trước
  // mà đơn còn đang được đồng bộ thì so sánh vô nghĩa. Script/HQ có thể đặt 0.
  const minAgeMs = Math.max(0, opts.minAgeMs ?? 3_600_000);
  // Sổ nhỏ: ORDER BY random(); sổ lớn (ước lượng từ pg_class): TABLESAMPLE để
  // không quét toàn bảng mỗi đêm.
  const est = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT COALESCE(sum(c.reltuples), 0)::bigint AS n
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = '"order_ledger"'::regclass
  `);
  const estimated = Number(est[0]?.n ?? 0);
  const eligible = Prisma.sql`"dirtyAt" IS NULL AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int AND "computedAt" <= now() - (${minAgeMs}::int * INTERVAL '1 millisecond')`;
  let sample: { orderId: string }[];
  if (estimated < 200_000) {
    sample = await prisma.$queryRaw<{ orderId: string }[]>(Prisma.sql`
      SELECT "orderId" FROM "order_ledger" WHERE ${eligible} ORDER BY random() LIMIT ${sampleSize}::int
    `);
  } else {
    const pct = Math.min(50, Math.max(0.01, ((sampleSize * 20) / estimated) * 100));
    sample = await prisma.$queryRaw<{ orderId: string }[]>(Prisma.sql`
      SELECT "orderId" FROM "order_ledger" TABLESAMPLE SYSTEM (${pct}::real) WHERE ${eligible} LIMIT ${sampleSize}::int
    `);
  }

  const mismatches: LedgerAuditResult["mismatches"] = [];
  if (sample.length > 0) {
    const ids = sample.map((s) => s.orderId);
    const [orders, stored] = await Promise.all([
      prisma.order.findMany({ where: { id: { in: ids } }, include: LEDGER_INCLUDE }) as Promise<LedgerOrder[]>,
      prisma.orderLedger.findMany({ where: { orderId: { in: ids } } }),
    ]);
    const storedById = new Map(stored.map((s) => [s.orderId, s]));
    for (const o of orders) {
      const s = storedById.get(o.id);
      if (!s) continue;
      const fresh = buildLedgerRows(o).order;
      const diffs = diffLedgerRows(s, fresh);
      if (diffs.length > 0) mismatches.push({ orderId: o.id, orderCode: o.orderCode, diffs });
    }
    if (mismatches.length > 0) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "order_ledger" SET "dirtyAt" = clock_timestamp(), "dirtyReason" = 'audit:mismatch'
        WHERE "orderId" IN (${Prisma.join(mismatches.map((m) => m.orderId))})
      `);
    }
  }

  // DÒNG ĐÔI: một đơn nằm ở hai mảnh (đổi ngày tạo đúng lúc worker ghi — đường
  // nóng không còn bước "kéo về mảnh" để khỏi quét 84 mảnh). Giữ dòng có
  // createdDate khớp đơn hiện tại, xóa dòng lạc, đánh bẩn để tính lại.
  const duplicates = await prisma.$queryRaw<{ orderId: string }[]>(Prisma.sql`
    SELECT "orderId" FROM "order_ledger" GROUP BY "orderId" HAVING count(*) > 1 LIMIT 1000
  `);
  if (duplicates.length > 0) {
    const dupIds = duplicates.map((d) => d.orderId);
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "order_ledger" l
      USING "Order" o
      WHERE l."orderId" = o."id" AND l."orderId" IN (${Prisma.join(dupIds)})
        AND l."createdDate" <> (o."createdAt" + INTERVAL '7 hours')::date
    `);
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "order_line_ledger" l
      USING "Order" o
      WHERE l."orderId" = o."id" AND l."orderId" IN (${Prisma.join(dupIds)})
        AND l."createdDate" <> (o."createdAt" + INTERVAL '7 hours')::date
    `);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "order_ledger" SET "dirtyAt" = clock_timestamp(), "dirtyReason" = 'audit:duplicate'
      WHERE "orderId" IN (${Prisma.join(dupIds)})
    `);
  }

  const counters = await prisma.$queryRaw<{ dirty: bigint; stale: bigint; def: bigint }[]>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "order_ledger" WHERE "dirtyAt" IS NOT NULL) AS dirty,
      (SELECT count(*) FROM "order_ledger" WHERE "dirtyAt" IS NOT NULL AND "dirtyAt" < now() - (${LEDGER_CLAIM_STALE_MS}::int * INTERVAL '1 millisecond')) AS stale,
      (SELECT count(*) FROM "order_ledger_default") AS def
  `);
  const c = counters[0];
  const result: LedgerAuditResult = {
    sampled: sample.length,
    mismatched: mismatches.length,
    duplicateOrders: duplicates.length,
    dirtyBacklog: Number(c?.dirty ?? 0),
    staleDirty: Number(c?.stale ?? 0),
    defaultRows: Number(c?.def ?? 0),
    durationMs: Date.now() - t0,
    mismatches: mismatches.slice(0, 50),
  };
  await prisma.orderLedgerAudit.create({
    data: {
      durationMs: result.durationMs,
      sampled: result.sampled,
      mismatched: result.mismatched,
      dirtyBacklog: result.dirtyBacklog,
      staleDirty: result.staleDirty,
      defaultRows: result.defaultRows,
      details: { duplicateOrders: result.duplicateOrders, mismatches: result.mismatches } as unknown as Prisma.InputJsonValue,
    },
  });
  return result;
}

// ------------------------------------------------------------
// So khớp: SUM trong DB trên sổ ↔ tính lại trong RAM từ đơn gốc
// (công cụ nghiệm thu giai đoạn 1; dùng bởi route HQ và script)
// ------------------------------------------------------------

/** Đọc TOÀN BỘ đơn của phạm vi theo trang, dựng dòng sổ trong RAM — đường đối soát, KHÔNG phải đường báo cáo. */
export async function buildLedgerRowsInMemory(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  max: number
): Promise<{ rows: OrderLedgerRow[]; truncated: boolean }> {
  const rows: OrderLedgerRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page: LedgerOrder[] = await prisma.order.findMany({
      where: { channel: scope, createdAt: range },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: LEDGER_INCLUDE,
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const o of page) rows.push(buildLedgerRows(o).order);
    if (page.length < 1000) return { rows, truncated: false };
    if (rows.length >= max) return { rows, truncated: true };
    cursor = page[page.length - 1].id;
  }
}

export interface LedgerCompareDiff {
  group: string;
  metric: string;
  ledger: number;
  recomputed: number;
  diff: number;
}

/** Chênh lệch từng nhóm × cột giữa hai bản tổng; bỏ qua lệch dưới 0,5 đồng. */
export function diffLedgerSummaries(sql: LedgerSummary, mem: LedgerSummary): LedgerCompareDiff[] {
  const out: LedgerCompareDiff[] = [];
  const metrics = [
    "count", "missingCostCount", "missingCostExcludedProfit", "lossCount", "returnCount", "totalQuantity",
    ...ORDER_LEDGER_MONEY_COLUMNS,
  ] as const;
  for (const g of LEDGER_GROUP_KEYS) {
    for (const m of metrics) {
      const diff = sql[g][m] - mem[g][m];
      if (Math.abs(diff) > 0.5) out.push({ group: g, metric: m, ledger: sql[g][m], recomputed: mem[g][m], diff });
    }
  }
  return out;
}

export interface LedgerCompareResult {
  freshness: LedgerFreshness & { recomputed: number };
  timing: { ledgerMs: number; recomputeMs: number; recomputedOrders: number; recomputeTruncated: boolean };
  match: boolean;
  diffs: LedgerCompareDiff[];
  ledger: LedgerSummary;
  recomputed: LedgerSummary;
}

/**
 * Hai bản tổng cho cùng phạm vi: (1) SUM trong DB trên sổ; (2) đọc đơn gốc,
 * tính lại trong RAM rồi cộng. `fresh` → tính nốt dòng bẩn của kỳ trước khi so.
 */
export async function compareLedger(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  opts: { fresh?: boolean; maxInline?: number; maxOrders?: number } = {}
): Promise<LedgerCompareResult> {
  const freshness = opts.fresh
    ? await ensureLedgerFresh(scope, range, { maxInline: opts.maxInline ?? 5000 })
    : { ...(await ledgerFreshness(scope, range)), recomputed: 0 };
  const t1 = Date.now();
  const ledger = await ledgerSummary(scope, range);
  const ledgerMs = Date.now() - t1;
  const t2 = Date.now();
  const { rows, truncated } = await buildLedgerRowsInMemory(scope, range, opts.maxOrders ?? 50_000);
  const recomputed = summarizeLedgerRowsInMemory(rows);
  const recomputeMs = Date.now() - t2;
  const diffs = diffLedgerSummaries(ledger, recomputed);
  return {
    freshness,
    timing: { ledgerMs, recomputeMs, recomputedOrders: rows.length, recomputeTruncated: truncated },
    match: diffs.length === 0 && !truncated,
    diffs,
    ledger,
    recomputed,
  };
}

// ------------------------------------------------------------
// Trạng thái cho trang HQ
// ------------------------------------------------------------

export interface LedgerStatus {
  formulaVersion: number;
  rows: number;
  computedRows: number;
  dirty: number;
  oldestDirtyAgeSec: number | null;
  claimed: number;
  staleVersion: number;
  defaultRows: number;
  lineRows: number;
  partitions: { name: string; estimatedRows: number }[];
  lastAudit: { ranAt: Date; sampled: number; mismatched: number; dirtyBacklog: number; staleDirty: number; defaultRows: number } | null;
}

export async function ledgerStatus(): Promise<LedgerStatus> {
  const [main, parts, lastAudit] = await Promise.all([
    prisma.$queryRaw<
      { rows: bigint; computed: bigint; dirty: bigint; oldest: Date | null; claimed: bigint; stale: bigint; def: bigint; lines: bigint }[]
    >(Prisma.sql`
      SELECT
        (SELECT count(*) FROM "order_ledger") AS rows,
        (SELECT count(*) FROM "order_ledger" WHERE "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int AND "dirtyAt" IS NULL) AS computed,
        (SELECT count(*) FROM "order_ledger" WHERE "dirtyAt" IS NOT NULL) AS dirty,
        (SELECT min("dirtyAt") FROM "order_ledger" WHERE "dirtyAt" IS NOT NULL) AS oldest,
        (SELECT count(*) FROM "order_ledger" WHERE "claimedAt" IS NOT NULL) AS claimed,
        (SELECT count(*) FROM "order_ledger" WHERE "dirtyAt" IS NULL AND "formulaVersion" <> ${LEDGER_FORMULA_VERSION}::int) AS stale,
        (SELECT count(*) FROM "order_ledger_default") AS def,
        (SELECT count(*) FROM "order_line_ledger") AS lines
    `),
    prisma.$queryRaw<{ name: string; est: number }[]>(Prisma.sql`
      SELECT c.relname AS name, c.reltuples::float8 AS est
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = '"order_ledger"'::regclass
      ORDER BY c.relname
    `),
    prisma.orderLedgerAudit.findFirst({ orderBy: { ranAt: "desc" } }),
  ]);
  const m = main[0];
  return {
    formulaVersion: LEDGER_FORMULA_VERSION,
    rows: Number(m?.rows ?? 0),
    computedRows: Number(m?.computed ?? 0),
    dirty: Number(m?.dirty ?? 0),
    oldestDirtyAgeSec: m?.oldest ? Math.round((Date.now() - m.oldest.getTime()) / 1000) : null,
    claimed: Number(m?.claimed ?? 0),
    staleVersion: Number(m?.stale ?? 0),
    defaultRows: Number(m?.def ?? 0),
    lineRows: Number(m?.lines ?? 0),
    partitions: parts.map((p) => ({ name: p.name, estimatedRows: Math.max(0, Math.round(Number(p.est))) })),
    lastAudit: lastAudit
      ? {
          ranAt: lastAudit.ranAt,
          sampled: lastAudit.sampled,
          mismatched: lastAudit.mismatched,
          dirtyBacklog: lastAudit.dirtyBacklog,
          staleDirty: lastAudit.staleDirty,
          defaultRows: lastAudit.defaultRows,
        }
      : null,
  };
}
