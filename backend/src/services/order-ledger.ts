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

import { Prisma, type ShippingStatus } from "@prisma/client";
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
import type { LedgerCashFlowBreakdown } from "../lib/cash-flow-totals";
import type { LedgerOverviewBreakdown } from "../lib/overview-totals";
import {
  emptyPnlSummaryTotals,
  escapeLike,
  type LedgerPnlFilter,
  type PnlListCursor,
  type PnlSummaryTotals,
} from "../lib/realized-pnl-totals";
import type { DeclarationRawRow, TaxReportTotals } from "../lib/tax-totals";
import type {
  LossOrderBasis,
  LossOrdersData,
  OpenCashByChannel,
  OpenCashTotals,
  SkuAgg,
} from "../lib/finance-views";
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
 * Mốc thời gian / mốc ngày ở dạng BIỂU THỨC BẤT BIẾN trên tham số số nguyên.
 *
 * Prisma gửi chuỗi dưới dạng text, nên `$n::timestamp` / `$n::date` là phép đổi
 * chuỗi → kiểu: Postgres xếp loại "ổn định" chứ không "bất biến", không gộp
 * thành hằng và chạy lại ở TỪNG dòng quét. Đo trên DB dev 30/09/2026: mỗi mốc
 * thời gian thêm khoảng 1,9 micro giây mỗi dòng, mỗi mốc ngày khoảng 1,1 — câu
 * quét 405.000 dòng hàng mất thêm khoảng 2 giây chỉ để đổi kiểu. Viết thành
 * "mốc 1970 + số" thì Postgres gộp thành hằng lúc lập kế hoạch: không tốn gì ở
 * từng dòng, ước lượng số dòng đúng, cắt mảnh tháng ngay lúc lập kế hoạch.
 * Cùng giá trị với `${d.toISOString()}::timestamp` (giờ UTC, không phụ thuộc
 * TimeZone của phiên).
 */
export const timestampConst = (d: Date): Prisma.Sql =>
  Prisma.sql`(TIMESTAMP '1970-01-01 00:00:00' + ${BigInt(d.getTime())} * INTERVAL '1 millisecond')`;

/** "yyyy-mm-dd" → mốc ngày dạng hằng (xem timestampConst). */
export const dateConst = (dateKey: string): Prisma.Sql =>
  Prisma.sql`(DATE '1970-01-01' + ${Math.round(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000)}::int)`;

/**
 * WHERE cho phạm vi gian (cùng nghĩa với `channel: scope` của Prisma) + kỳ.
 * Kỳ lọc trên cột thời gian (đúng biên giờ VN) VÀ cột ngày (để Postgres cắt
 * phân mảnh theo tháng). `alias` = tên bảng/bí danh đứng trước cột.
 * `constParams`: mốc kỳ viết dạng hằng (xem timestampConst) — cho câu quét
 * nhiều dòng; cùng điều kiện, cùng kết quả.
 */
export function ledgerScopeSql(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  opts: { axis?: LedgerDateAxis; alias?: string; constParams?: boolean } = {}
): Prisma.Sql {
  const a = opts.alias ? Prisma.raw(`${opts.alias}.`) : Prisma.empty;
  const ts = (d: Date) => (opts.constParams ? timestampConst(d) : Prisma.sql`${d.toISOString()}::timestamp`);
  const day = (d: Date) =>
    opts.constParams ? dateConst(toBusinessDateKey(d)) : Prisma.sql`${toBusinessDateKey(d)}::date`;
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
      Prisma.sql`${a}${Prisma.raw(col.ts)} >= ${ts(range.gte)} AND ${a}${Prisma.raw(col.ts)} <= ${ts(range.lte)}`
    );
    parts.push(
      Prisma.sql`${a}${Prisma.raw(col.date)} >= ${day(range.gte)} AND ${a}${Prisma.raw(col.date)} <= ${day(range.lte)}`
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
  // Hai câu đếm RIÊNG để mỗi câu đi đúng chỉ mục nhỏ thay vì quét cả phạm vi ở
  // mỗi lượt xem báo cáo (shop vài trăm nghìn đơn): dòng bẩn qua chỉ mục cục bộ
  // "order_ledger_dirty_idx"; dòng công thức cũ qua "order_ledger_formulaVersion_idx"
  // — viết (< hiện tại OR > hiện tại) thay cho <> để B-tree dùng được, và vẫn bắt
  // được dòng do bản MỚI hơn ghi khi vừa lùi bản.
  const where = ledgerScopeSql(scope, range, { axis });
  const v = Prisma.sql`${LEDGER_FORMULA_VERSION}::int`;
  const rows = await prisma.$queryRaw<{ dirty: bigint; stale: bigint }[]>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "order_ledger" WHERE ${where} AND "dirtyAt" IS NOT NULL) AS dirty,
      (SELECT count(*) FROM "order_ledger"
        WHERE ${where} AND "dirtyAt" IS NULL AND ("formulaVersion" < ${v} OR "formulaVersion" > ${v})) AS stale
  `);
  return { dirty: Number(rows[0]?.dirty ?? 0), staleVersion: Number(rows[0]?.stale ?? 0) };
}

/**
 * Báo cáo gọi TRƯỚC khi cộng: tính nốt các dòng bẩn của phạm vi (tối đa
 * `maxInline` đơn — mặc định 2.000, chừng 3–6 giây). Trả số còn lại để nơi gọi
 * báo "X đơn đang chờ cập nhật" thay vì cộng thiếu trong im lặng.
 * ĐẾM TRƯỚC: sổ đang sạch (trường hợp thường gặp khi worker chạy) thì trả về
 * ngay sau một câu đếm, không chạy câu nhặt việc (UPDATE … SKIP LOCKED) ở mỗi
 * lượt xem báo cáo.
 */
export async function ensureLedgerFresh(
  scope: ChannelScope,
  range?: DateRangeFilter,
  opts: { maxInline?: number; axis?: LedgerDateAxis } = {}
): Promise<LedgerFreshness & { recomputed: number }> {
  const before = await ledgerFreshness(scope, range, opts.axis);
  if (before.dirty === 0) return { ...before, recomputed: 0 };
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

// ------------------------------------------------------------
// Báo cáo dòng tiền: ba bảng bóc GROUP BY trong database (lib/cash-flow-totals.ts)
// ------------------------------------------------------------

/**
 * Bóc theo chiều cho nhóm ĐƠN TÍNH DOANH THU của phạm vi — một câu SELECT mỗi
 * chiều, chỉ cộng dòng đã tính bằng phiên bản công thức hiện tại (như
 * ledgerSummary). `byDaySince` = chỉ lấy chuỗi ngày từ mốc này (biểu đồ 14
 * ngày) để không trả về cả năm khi kỳ dài.
 */
export async function ledgerCashFlowBreakdown(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  opts: { byDaySince?: string } = {}
): Promise<LedgerCashFlowBreakdown> {
  const where = Prisma.sql`${ledgerScopeSql(scope, range)}
      AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
      AND "countsAsRevenue"`;
  const [cogs, gmv, days] = await Promise.all([
    prisma.$queryRaw<{ key: string; v: unknown }[]>(Prisma.sql`
      SELECT "channelName"::text AS key, COALESCE(sum("costSnapshot"), 0) AS v
      FROM "order_ledger" WHERE ${where}
      GROUP BY "channelName"
    `),
    prisma.$queryRaw<{ key: string; v: unknown }[]>(Prisma.sql`
      SELECT "channelId" AS key, COALESCE(sum("feeGmvMax"), 0) AS v
      FROM "order_ledger" WHERE ${where} AND "feeGmvMax" <> 0
      GROUP BY "channelId"
    `),
    prisma.$queryRaw<{ key: Date; rev: unknown; cogs: unknown }[]>(Prisma.sql`
      SELECT "createdDate" AS key, COALESCE(sum("platformRevenue"), 0) AS rev, COALESCE(sum("costSnapshot"), 0) AS cogs
      FROM "order_ledger" WHERE ${where}
      ${opts.byDaySince ? Prisma.sql`AND "createdDate" >= ${opts.byDaySince}::date` : Prisma.empty}
      GROUP BY "createdDate"
    `),
  ]);
  const byDay = new Map<string, { platformRevenue: number; costSnapshot: number }>();
  for (const d of days) {
    // Cột DATE về dạng Date lúc 00:00 UTC → lấy đúng chuỗi yyyy-mm-dd, không đổi giờ VN.
    const key = d.key instanceof Date ? d.key.toISOString().slice(0, 10) : String(d.key).slice(0, 10);
    byDay.set(key, { platformRevenue: Number(d.rev), costSnapshot: Number(d.cogs) });
  }
  return {
    cogsByChannelName: new Map(cogs.map((r) => [r.key, Number(r.v)])),
    gmvMaxByChannelId: new Map(gmv.map((r) => [r.key, Number(r.v)])),
    byDay,
  };
}

// ------------------------------------------------------------
// Tổng quan: hai bảng bóc GROUP BY trong database (lib/overview-totals.ts)
// ------------------------------------------------------------

/**
 * Bóc nhóm ĐƠN TÍNH DOANH THU của phạm vi theo GIAN và theo NGÀY PHÁT SINH
 * (giờ VN). `byDaySince` = chỉ lấy chuỗi ngày từ mốc này (trục biểu đồ ≤ 90
 * ngày) để kỳ dài không trả cả năm. Cùng `formulaVersion` với ledgerSummary.
 */
export async function ledgerOverviewBreakdown(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  opts: { byDaySince?: string } = {}
): Promise<LedgerOverviewBreakdown> {
  const where = Prisma.sql`${ledgerScopeSql(scope, range)}
      AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
      AND "countsAsRevenue"`;
  const [channels, days] = await Promise.all([
    prisma.$queryRaw<{ key: string; n: unknown; rev: unknown; gmv: unknown }[]>(Prisma.sql`
      SELECT "channelId" AS key, count(*) AS n,
             COALESCE(sum("revenueGross"), 0) AS rev, COALESCE(sum("feeGmvMax"), 0) AS gmv
      FROM "order_ledger" WHERE ${where}
      GROUP BY "channelId"
    `),
    prisma.$queryRaw<{ key: Date; n: unknown; rev: unknown; cogs: unknown; ded: unknown }[]>(Prisma.sql`
      SELECT "createdDate" AS key, count(*) AS n,
             COALESCE(sum("revenueGross"), 0) AS rev, COALESCE(sum("costSnapshot"), 0) AS cogs,
             COALESCE(sum("platformDeduction"), 0) AS ded
      FROM "order_ledger" WHERE ${where}
      ${opts.byDaySince ? Prisma.sql`AND "createdDate" >= ${opts.byDaySince}::date` : Prisma.empty}
      GROUP BY "createdDate"
    `),
  ]);
  const byDay: LedgerOverviewBreakdown["byDay"] = new Map();
  for (const d of days) {
    // Cột DATE về dạng Date lúc 00:00 UTC → lấy đúng chuỗi yyyy-mm-dd, không đổi giờ VN.
    const key = d.key instanceof Date ? d.key.toISOString().slice(0, 10) : String(d.key).slice(0, 10);
    byDay.set(key, {
      count: Number(d.n),
      revenueGross: Number(d.rev),
      costSnapshot: Number(d.cogs),
      platformDeduction: Number(d.ded),
    });
  }
  return {
    byChannelId: new Map(
      channels.map((r) => [r.key, { count: Number(r.n), revenueGross: Number(r.rev), feeGmvMax: Number(r.gmv) }])
    ),
    byDay,
  };
}

// ------------------------------------------------------------
// Lãi/Lỗ thực hiện: danh sách phân trang + tổng kết theo bộ lọc của bảng
// (lib/realized-pnl-totals.ts, docs/SO-CAI-DON.md mục 9.3)
// ------------------------------------------------------------

/** WHERE của bảng Lãi/Lỗ trên sổ: phạm vi gian + kỳ + bộ lọc; chỉ dòng đã tính bằng công thức hiện tại. */
function ledgerPnlWhere(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  f: LedgerPnlFilter
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    ledgerScopeSql(scope, range),
    Prisma.sql`"formulaVersion" = ${LEDGER_FORMULA_VERSION}::int`,
  ];
  if (f.shippingStatus) parts.push(Prisma.sql`"shippingStatus" = ${f.shippingStatus}::"ShippingStatus"`);
  if (f.returnsOnly) parts.push(Prisma.sql`"returnType" IS NOT NULL`);
  if (f.lossOnly) parts.push(Prisma.sql`"isLoss"`);
  // Chứa chuỗi, không phân biệt hoa thường — chỉ mục GIN trigram
  // "order_ledger_orderCode_trgm_idx" phục vụ mẫu từ 3 ký tự trở lên.
  if (f.search) parts.push(Prisma.sql`"orderCode" ILIKE ${`%${escapeLike(f.search)}%`}`);
  return Prisma.join(parts, " AND ");
}

/**
 * MỘT TRANG mã đơn của bảng Lãi/Lỗ, mới nhất trước (createdAt, orderId giảm
 * dần — cùng thứ tự với đường cũ). `cursor` = đọc tiếp SAU dòng đó (xuất Excel:
 * trang nào cũng rẻ như trang đầu nhờ chỉ mục ownerId + createdAt + orderId);
 * không có cursor thì dùng `offset` (lật trang trên giao diện).
 */
export async function ledgerPnlList(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  filter: LedgerPnlFilter,
  page: { limit: number; offset?: number; cursor?: PnlListCursor | null }
): Promise<{ orderId: string; createdAt: Date }[]> {
  const limit = Math.max(1, Math.floor(page.limit));
  const offset = page.cursor ? 0 : Math.max(0, Math.floor(page.offset ?? 0));
  return prisma.$queryRaw<{ orderId: string; createdAt: Date }[]>(Prisma.sql`
    SELECT "orderId", "createdAt"
    FROM "order_ledger"
    WHERE ${ledgerPnlWhere(scope, range, filter)}
      ${page.cursor
        ? Prisma.sql`AND ("createdAt", "orderId") < (${page.cursor.createdAt.toISOString()}::timestamp, ${page.cursor.orderId})`
        : Prisma.empty}
    ORDER BY "createdAt" DESC, "orderId" DESC
    LIMIT ${limit}::int OFFSET ${offset}::int
  `);
}

/**
 * TỔNG KẾT của toàn bộ đơn khớp lọc — ba câu cộng trong database: tổng, theo
 * sàn, theo ngày phát sinh (từ `byDaySince` — đầu trục biểu đồ). Cùng phép cộng
 * với pnlSummaryTotalsFromLedgerRows (test khóa hai bên bằng nhau).
 */
export async function ledgerPnlSummary(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  filter: LedgerPnlFilter,
  opts: { byDaySince?: string } = {}
): Promise<PnlSummaryTotals> {
  const where = ledgerPnlWhere(scope, range, filter);
  const profit = Prisma.raw(`COALESCE(sum("profitAfterTax") FILTER (WHERE NOT "missingCostPrice"), 0)`);
  const returnCount = Prisma.raw(`count(*) FILTER (WHERE "returnType" IS NOT NULL)`);
  const returnLoss = Prisma.raw(
    `COALESCE(sum("returnLossCost" + "returnLossPlatformKept" + "returnLossRefund") FILTER (WHERE "returnType" IS NOT NULL), 0)`
  );
  const [totals, platforms, days] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT count(*) AS "count",
             count(*) FILTER (WHERE "isSettled") AS "settledCount",
             COALESCE(sum("netRevenue"), 0) AS "netRevenue",
             ${returnCount} AS "returnCount",
             COALESCE(sum("refundedAmount"), 0) AS "refundedAmount",
             COALESCE(sum("revenueGross"), 0) AS "revenueGross",
             COALESCE(sum("platformTax"), 0) AS "platformTax",
             ${profit} AS "profitWithCost",
             count(*) FILTER (WHERE "missingCostPrice") AS "missingCostCount",
             COALESCE(sum("profitAfterTax") FILTER (WHERE "missingCostPrice"), 0) AS "missingCostExcludedProfit",
             COALESCE(sum("returnLossCost") FILTER (WHERE "returnType" IS NOT NULL), 0) AS "rlCost",
             COALESCE(sum("returnLossPlatformKept") FILTER (WHERE "returnType" IS NOT NULL), 0) AS "rlKept",
             COALESCE(sum("returnLossRefund") FILTER (WHERE "returnType" IS NOT NULL), 0) AS "rlRefund"
      FROM "order_ledger" WHERE ${where}
    `),
    prisma.$queryRaw<{ key: string; n: unknown; profit: unknown; rc: unknown; rl: unknown }[]>(Prisma.sql`
      SELECT "channelName"::text AS key, count(*) AS n, ${profit} AS profit, ${returnCount} AS rc, ${returnLoss} AS rl
      FROM "order_ledger" WHERE ${where}
      GROUP BY "channelName"
    `),
    prisma.$queryRaw<{ key: Date; n: unknown; profit: unknown; rc: unknown; rl: unknown }[]>(Prisma.sql`
      SELECT "createdDate" AS key, count(*) AS n, ${profit} AS profit, ${returnCount} AS rc, ${returnLoss} AS rl
      FROM "order_ledger" WHERE ${where}
      ${opts.byDaySince ? Prisma.sql`AND "createdDate" >= ${opts.byDaySince}::date` : Prisma.empty}
      GROUP BY "createdDate"
    `),
  ]);
  const r = totals[0] ?? {};
  const num = (k: string) => Number(r[k] ?? 0);
  const out = emptyPnlSummaryTotals();
  out.count = num("count");
  out.settledCount = num("settledCount");
  out.netRevenue = num("netRevenue");
  out.returnCount = num("returnCount");
  out.refundedAmount = num("refundedAmount");
  out.revenueGross = num("revenueGross");
  out.platformTax = num("platformTax");
  out.profitWithCost = num("profitWithCost");
  out.missingCostCount = num("missingCostCount");
  out.missingCostExcludedProfit = num("missingCostExcludedProfit");
  out.returnLoss = { costLoss: num("rlCost"), platformKept: num("rlKept"), refundLoss: num("rlRefund") };
  for (const p of platforms) {
    out.byPlatform.set(p.key, {
      count: Number(p.n),
      profit: Number(p.profit),
      returnCount: Number(p.rc),
      returnLoss: Number(p.rl),
    });
  }
  for (const d of days) {
    const key = d.key instanceof Date ? d.key.toISOString().slice(0, 10) : String(d.key).slice(0, 10);
    out.byDay.set(key, {
      profit: Number(d.profit),
      returnLoss: Number(d.rl),
      orderCount: Number(d.n),
      returnCount: Number(d.rc),
    });
  }
  return out;
}

// ------------------------------------------------------------
// Thuế: đối soát kỳ + số liệu kê khai theo sàn (lib/tax-totals.ts,
// docs/SO-CAI-DON.md mục 9.4)
// ------------------------------------------------------------

/** Tổng các đơn KHÔNG HỦY của kỳ (theo ngày tạo) cho /api/tax/report — một câu SELECT. */
export async function ledgerTaxReportTotals(
  scope: ChannelScope,
  range: DateRangeFilter | undefined
): Promise<TaxReportTotals> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT count(*) AS "orderCount",
           count(*) FILTER (WHERE "isSettled") AS "settledCount",
           COALESCE(sum("revenueGross"), 0) AS "grossRevenue",
           COALESCE(sum("profitAfterTax") FILTER (WHERE NOT "missingCostPrice"), 0) AS "profitWithCost",
           COALESCE(sum("platformTax") FILTER (WHERE "isSettled"), 0) AS "platformTaxActual",
           COALESCE(sum("platformRevenue") FILTER (WHERE NOT "isSettled"), 0) AS "unsettledPlatformRevenue",
           count(*) FILTER (WHERE "missingCostPrice") AS "missingCostCount",
           COALESCE(sum("profitAfterTax") FILTER (WHERE "missingCostPrice"), 0) AS "missingCostExcludedProfit"
    FROM "order_ledger"
    WHERE ${ledgerScopeSql(scope, range)}
      AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
      AND "shippingStatus" <> 'CANCELLED'
  `);
  const r = rows[0] ?? {};
  const num = (k: string) => Number(r[k] ?? 0);
  return {
    orderCount: num("orderCount"),
    settledCount: num("settledCount"),
    grossRevenue: num("grossRevenue"),
    profitWithCost: num("profitWithCost"),
    platformTaxActual: num("platformTaxActual"),
    unsettledPlatformRevenue: num("unsettledPlatformRevenue"),
    missingCostCount: num("missingCostCount"),
    missingCostExcludedProfit: num("missingCostExcludedProfit"),
  };
}

/**
 * Σ THEO SÀN cho bảng số liệu kê khai của một kỳ.
 *   - basis "delivered" (tờ khai cắt theo ngày SÀN BÁO GIAO, chốt 30/09/2026):
 *     chỉ đơn Đã giao có mốc giao trong kỳ, CỘNG đơn Đã giao chưa có mốc giao
 *     mà ngày tạo trong kỳ (tạm xếp theo ngày tạo, đếm riêng missingDeliveredAt).
 *     Nhánh theo ngày giao đi bằng chỉ mục (ownerId|channelId, deliveredDate).
 *   - basis "created": mọi đơn không hủy có ngày tạo trong kỳ.
 * Doanh thu tính thuế = Σ max(0, tiền hàng − voucher người bán − hoàn) TỪNG ĐƠN.
 */
export async function ledgerDeclarationByChannel(
  scope: ChannelScope,
  range: DateRangeFilter,
  basis: "delivered" | "created"
): Promise<{ rows: DeclarationRawRow[]; missingDeliveredAt: number }> {
  const fv = Prisma.sql`"formulaVersion" = ${LEDGER_FORMULA_VERSION}::int`;
  const cols = Prisma.raw(
    `"channelName", "isSettled", "revenueGross", "sellerVoucher", "refundedAmount", "platformTax"`
  );
  const src =
    basis === "delivered"
      ? Prisma.sql`
          SELECT ${cols}, FALSE AS "missing" FROM "order_ledger"
          WHERE ${ledgerScopeSql(scope, range, { axis: "delivered" })}
            AND ${fv} AND "shippingStatus" = 'DELIVERED'
          UNION ALL
          SELECT ${cols}, TRUE AS "missing" FROM "order_ledger"
          WHERE ${ledgerScopeSql(scope, range)}
            AND ${fv} AND "shippingStatus" = 'DELIVERED' AND "deliveredAt" IS NULL`
      : Prisma.sql`
          SELECT ${cols}, FALSE AS "missing" FROM "order_ledger"
          WHERE ${ledgerScopeSql(scope, range)}
            AND ${fv} AND "shippingStatus" <> 'CANCELLED'`;
  const taxable = Prisma.raw(`GREATEST(0, "revenueGross" - "sellerVoucher" - "refundedAmount")`);
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    WITH src AS (${src})
    SELECT "channelName"::text AS "channelName",
           count(*) AS "orderCount",
           count(*) FILTER (WHERE "isSettled") AS "settledCount",
           count(*) FILTER (WHERE NOT "isSettled") AS "unsettledCount",
           count(*) FILTER (WHERE "missing") AS "missing",
           COALESCE(sum("revenueGross"), 0) AS "grossRevenue",
           COALESCE(sum("sellerVoucher"), 0) AS "sellerVoucher",
           COALESCE(sum("refundedAmount"), 0) AS "refundedAmount",
           COALESCE(sum(${taxable}), 0) AS "taxableRevenue",
           COALESCE(sum(${taxable}) FILTER (WHERE NOT "isSettled"), 0) AS "unsettledTaxableRevenue",
           COALESCE(sum("platformTax") FILTER (WHERE "isSettled"), 0) AS "taxWithheldActual",
           COALESCE(sum("platformTax") FILTER (WHERE NOT "isSettled"), 0) AS "taxWithheldEstimated"
    FROM src
    GROUP BY "channelName"
  `);
  let missingDeliveredAt = 0;
  const out: DeclarationRawRow[] = rows.map((r) => {
    missingDeliveredAt += Number(r.missing ?? 0);
    return {
      channelName: String(r.channelName),
      orderCount: Number(r.orderCount),
      settledCount: Number(r.settledCount),
      unsettledCount: Number(r.unsettledCount),
      grossRevenue: Number(r.grossRevenue),
      sellerVoucher: Number(r.sellerVoucher),
      refundedAmount: Number(r.refundedAmount),
      taxableRevenue: Number(r.taxableRevenue),
      unsettledTaxableRevenue: Number(r.unsettledTaxableRevenue),
      taxWithheldActual: Number(r.taxWithheldActual),
      taxWithheldEstimated: Number(r.taxWithheldEstimated),
    };
  });
  return { rows: out, missingDeliveredAt };
}

// ------------------------------------------------------------
// Đơn lỗ, dòng tiền theo gian, Lãi/Lỗ theo SKU (lib/finance-views.ts,
// docs/SO-CAI-DON.md mục 9.5)
// ------------------------------------------------------------

/**
 * ĐƠN LỖ của kỳ trên các đơn ĐÃ GIAO: số đếm cả kỳ (một câu SELECT) + danh sách
 * lỗ nặng nhất trước, tối đa `limit` dòng (nối bảng đơn lấy tên khách, bảng gian
 * lấy tên gian). `limit = 0` → chỉ lấy số đếm (cảnh báo Trung tâm điều hành).
 */
export async function ledgerLossOrders(
  scope: ChannelScope,
  range: DateRangeFilter | undefined,
  limit: number,
  basis: LossOrderBasis = "delivered"
): Promise<LossOrdersData> {
  const fv = Prisma.sql`"formulaVersion" = ${LEDGER_FORMULA_VERSION}::int`;
  // Tập đơn được soát: Đã giao (trang Đơn lỗ) hoặc đơn tính doanh thu (Trợ lý hỏi đáp).
  const inBasis = Prisma.raw(basis === "active" ? `"countsAsRevenue"` : `"shippingStatus" = 'DELIVERED'`);
  const inBasisL = Prisma.raw(basis === "active" ? `l."countsAsRevenue"` : `l."shippingStatus" = 'DELIVERED'`);
  const [stats, list] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT count(*) AS "analyzed",
             count(*) FILTER (WHERE "isLoss") AS "loss",
             count(*) FILTER (WHERE "missingCostPrice") AS "warning",
             count(*) FILTER (WHERE "isLoss" OR "missingCostPrice") AS "listed",
             COALESCE(sum(-"profitAfterTax") FILTER (WHERE "isLoss"), 0) AS "totalLoss"
      FROM "order_ledger"
      WHERE ${ledgerScopeSql(scope, range)} AND ${fv} AND ${inBasis}
    `),
    limit > 0
      ? prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
          SELECT l."orderId" AS "id", l."orderCode", o."customerName", l."channelName"::text AS "channelName",
                 c."shopName", l."createdAt", l."revenueGross", l."platformDeduction", l."isSettled",
                 l."costSnapshot", l."profitAfterTax", l."missingCostPrice"
          FROM "order_ledger" l
          JOIN "Order" o ON o."id" = l."orderId"
          JOIN "Channel" c ON c."id" = l."channelId"
          WHERE ${ledgerScopeSql(scope, range, { alias: "l" })}
            AND l."formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
            AND ${inBasisL}
            AND (l."isLoss" OR l."missingCostPrice")
          ORDER BY l."profitAfterTax" ASC, l."createdAt" DESC, l."orderId" DESC
          LIMIT ${Math.floor(limit)}::int
        `)
      : Promise.resolve([]),
  ]);
  const s = stats[0] ?? {};
  return {
    analyzedCount: Number(s.analyzed ?? 0),
    lossCount: Number(s.loss ?? 0),
    warningCount: Number(s.warning ?? 0),
    listTotal: Number(s.listed ?? 0),
    totalLoss: Number(s.totalLoss ?? 0),
    items: list.map((r) => ({
      id: String(r.id),
      orderCode: String(r.orderCode),
      customerName: (r.customerName as string | null) ?? null,
      channelName: String(r.channelName),
      shopName: (r.shopName as string | null) ?? null,
      createdAt: r.createdAt as Date,
      revenueGross: Number(r.revenueGross),
      platformDeduction: Number(r.platformDeduction),
      isSettled: Boolean(r.isSettled),
      costSnapshot: Number(r.costSnapshot),
      profitAfterTax: Number(r.profitAfterTax),
      missingCostPrice: Boolean(r.missingCostPrice),
    })),
  };
}

/**
 * Σ "Tổng tiền" sàn báo của MỌI đơn chưa quyết toán đang giao / đã giao, theo
 * gian — không lọc kỳ. Điều kiện viết đúng như chỉ mục cục bộ
 * "order_ledger_open_cash_idx" để chỉ chạm các đơn còn treo.
 */
export async function ledgerOpenCashByChannel(scope: ChannelScope): Promise<OpenCashByChannel> {
  const rows = await prisma.$queryRaw<{ key: string; status: string; v: unknown }[]>(Prisma.sql`
    SELECT "channelId" AS key, "shippingStatus"::text AS status, COALESCE(sum("platformRevenue"), 0) AS v
    FROM "order_ledger"
    WHERE ${ledgerScopeSql(scope, undefined)}
      AND NOT "isSettled" AND "shippingStatus" IN ('SHIPPING', 'DELIVERED')
      AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
    GROUP BY "channelId", "shippingStatus"
  `);
  const out: OpenCashByChannel = { inTransit: new Map(), pendingSettle: new Map() };
  for (const r of rows) {
    (r.status === "SHIPPING" ? out.inTransit : out.pendingSettle).set(r.key, Number(r.v));
  }
  return out;
}

/**
 * Tổng + số đơn chưa quyết toán đang giao / đã giao của ĐƠN TÍNH DOANH THU, cả
 * phạm vi (không lọc kỳ) — câu "tiền đang ở đâu" của Trợ lý hỏi đáp. Cùng điều
 * kiện chỉ mục cục bộ với ledgerOpenCashByChannel.
 */
export async function ledgerOpenCashTotals(scope: ChannelScope): Promise<OpenCashTotals> {
  const rows = await prisma.$queryRaw<{ status: string; n: unknown; v: unknown }[]>(Prisma.sql`
    SELECT "shippingStatus"::text AS status, count(*) AS n, COALESCE(sum("platformRevenue"), 0) AS v
    FROM "order_ledger"
    WHERE ${ledgerScopeSql(scope, undefined)}
      AND NOT "isSettled" AND "shippingStatus" IN ('SHIPPING', 'DELIVERED')
      AND "countsAsRevenue"
      AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
    GROUP BY "shippingStatus"
  `);
  const t: OpenCashTotals = { inTransit: 0, inTransitCount: 0, pendingSettle: 0, pendingCount: 0 };
  for (const r of rows) {
    if (r.status === "SHIPPING") {
      t.inTransit = Number(r.v);
      t.inTransitCount = Number(r.n);
    } else {
      t.pendingSettle = Number(r.v);
      t.pendingCount = Number(r.n);
    }
  }
  return t;
}

/**
 * LÃI/LỖ THEO SKU của đơn ĐÃ GIAO trong kỳ — GROUP BY trên sổ DÒNG HÀNG:
 *   · mã = mã kho (Product.skuCode) nếu dòng đã liên kết sản phẩm, không thì mã sàn;
 *   · doanh thu = Σ giá × SL; giá vốn = Σ giá vốn lúc bán × SL;
 *   · phí phân bổ = Σ phần sàn khấu trừ của đơn chia theo tỷ trọng giá trị dòng
 *     (đơn mà mọi dòng giá 0 thì không phân bổ — đúng luật cũ).
 */
export async function ledgerSkuAgg(
  scope: ChannelScope,
  range: DateRangeFilter | undefined
): Promise<Map<string, SkuAgg>> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT COALESCE(p."skuCode", l."channelSku") AS "sku",
           (array_agg(l."productName" ORDER BY l."createdAt" DESC, l."orderId" DESC, l."orderItemId"))[1] AS "productName",
           max(p."imageUrl") AS "imageUrl",
           COALESCE(sum(l."quantity"), 0) AS "quantitySold",
           COALESCE(sum(l."lineGross"), 0) AS "revenue",
           COALESCE(sum(l."lineCost"), 0) AS "cogs",
           COALESCE(sum(CASE WHEN l."lineGross" > 0 THEN l."platformDeduction" ELSE 0 END), 0) AS "allocatedFee"
    FROM "order_line_ledger" l
    LEFT JOIN "Product" p ON p."id" = l."productId"
    WHERE ${ledgerScopeSql(scope, range, { alias: "l" })}
      AND l."formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
      AND l."shippingStatus" = 'DELIVERED'
    GROUP BY 1
  `);
  const out = new Map<string, SkuAgg>();
  for (const r of rows) {
    const sku = String(r.sku);
    out.set(sku, {
      sku,
      productName: String(r.productName ?? sku),
      imageUrl: (r.imageUrl as string | null) ?? null,
      quantitySold: Number(r.quantitySold),
      revenue: Number(r.revenue),
      cogs: Number(r.cogs),
      allocatedFee: Number(r.allocatedFee),
    });
  }
  return out;
}

// ------------------------------------------------------------
// Quảng cáo (biên lãi Shopee/Lazada, hòa vốn TikTok): dòng GỌN của từng đơn
// trong cửa sổ của MỘT gian, đọc thẳng từ sổ (docs/SO-CAI-DON.md mục 9.7)
// ------------------------------------------------------------

/** Phần của một đơn mà các phép tính quảng cáo cần — số đã tính sẵn trong sổ, kèm dòng hàng. */
export interface LedgerCompactOrder {
  orderId: string;
  createdAt: Date;
  shippingStatus: ShippingStatus;
  isSettled: boolean;
  actualRevenue: number;
  profit: number;
  missingCostPrice: boolean;
  /** Phí GMV Max TikTok sàn trừ trong đơn (số có dấu, âm = bị trừ). */
  feeGmvMax: number;
  /** Bản kê TikTok của đơn (null = chưa có); estimated = mới là số ước tính của sàn. Chỉ nạp khi withTiktokSettlement. */
  tiktok: { estimated: boolean } | null;
  items: { sku: string; price: number; quantity: number; costPriceAtSale: number }[];
}

/**
 * Tối đa `max` đơn MỚI NHẤT của phạm vi (một gian, một cửa sổ ngày) ở dạng gọn,
 * kèm dòng hàng — hai câu SELECT trên sổ, KHÔNG đọc bảng đơn kèm quan hệ, KHÔNG
 * tính lại computePnlRow. `truncated` = cửa sổ có nhiều đơn hơn `max` (phép tính
 * chỉ đại diện các đơn mới nhất — nơi gọi quyết định báo ra).
 */
export async function ledgerCompactOrders(
  scope: ChannelScope,
  range: DateRangeFilter,
  max: number,
  opts: { withTiktokSettlement?: boolean } = {}
): Promise<{ orders: LedgerCompactOrder[]; truncated: boolean }> {
  const limit = Math.max(1, Math.floor(max));
  const heads = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT l."orderId", l."createdAt", l."shippingStatus"::text AS "shippingStatus", l."isSettled",
           l."actualRevenue", l."profit", l."missingCostPrice", l."feeGmvMax"
           ${opts.withTiktokSettlement
             ? Prisma.sql`, (s."orderId" IS NOT NULL) AS "hasTiktok", COALESCE(s."estimated", FALSE) AS "estimated"`
             : Prisma.empty}
    FROM "order_ledger" l
    ${opts.withTiktokSettlement
      ? Prisma.sql`LEFT JOIN "tiktok_order_settlements" s ON s."orderId" = l."orderId"`
      : Prisma.empty}
    WHERE ${ledgerScopeSql(scope, range, { alias: "l" })}
      AND l."formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
    ORDER BY l."createdAt" DESC, l."orderId" DESC
    LIMIT ${limit + 1}::int
  `);
  const truncated = heads.length > limit;
  const kept = truncated ? heads.slice(0, limit) : heads;
  const byId = new Map<string, LedgerCompactOrder>();
  const orders: LedgerCompactOrder[] = kept.map((r) => {
    const o: LedgerCompactOrder = {
      orderId: String(r.orderId),
      createdAt: r.createdAt as Date,
      shippingStatus: r.shippingStatus as ShippingStatus,
      isSettled: Boolean(r.isSettled),
      actualRevenue: Number(r.actualRevenue),
      profit: Number(r.profit),
      missingCostPrice: Boolean(r.missingCostPrice),
      feeGmvMax: Number(r.feeGmvMax),
      tiktok: opts.withTiktokSettlement && r.hasTiktok ? { estimated: Boolean(r.estimated) } : null,
      items: [],
    };
    byId.set(o.orderId, o);
    return o;
  });
  if (orders.length === 0) return { orders, truncated };

  // Dòng hàng của đúng các đơn đã chọn: khi bị cắt thì chỉ đọc từ mốc đơn cũ nhất còn giữ.
  const oldest = orders[orders.length - 1].createdAt;
  const lineRange: DateRangeFilter = truncated ? { gte: oldest, lte: range.lte } : range;
  const lines = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT "orderId", "channelSku", "price", "quantity", "costPriceAtSale"
    FROM "order_line_ledger"
    WHERE ${ledgerScopeSql(scope, lineRange)}
      AND "formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
    ORDER BY "orderItemId"
  `);
  for (const ln of lines) {
    const o = byId.get(String(ln.orderId));
    if (!o) continue;
    o.items.push({
      sku: String(ln.channelSku),
      price: Number(ln.price),
      quantity: Number(ln.quantity),
      costPriceAtSale: Number(ln.costPriceAtSale),
    });
  }
  return { orders, truncated };
}

// ------------------------------------------------------------
// Quảng cáo Shopee/Lazada: GOM biên lãi + nhịp bán theo NHÓM SKU trong database
// (docs/QUANG-CAO-GOM-TRONG-DATABASE.md mục 3) — không kéo đơn lên RAM, không
// phanh số đơn: RAM chỉ nhận một dòng kết quả cho mỗi nhóm.
// ------------------------------------------------------------

/** Khóa của nhóm "mọi dòng hàng của gian" — luôn có trong kết quả, không đi qua bảng ánh xạ. */
export const LEDGER_MARGIN_SHOP_GROUP = "shop";

/** Tổng của MỘT nhóm SKU trong cửa sổ (số thô — nơi gọi tự suy ra biên lãi / độ phủ giá vốn). */
export interface LedgerMarginGroup {
  /** Số đơn CÓ giá vốn có dòng hàng thuộc nhóm (một đơn nhiều dòng cùng nhóm đếm một lần). */
  orders: number;
  /** Doanh thu thực tế / lợi nhuận của các đơn đó, phần phân bổ về dòng thuộc nhóm. */
  revenue: number;
  profit: number;
  /** Đơn thiếu giá vốn (cờ cấp đơn) — đứng ngoài biên lãi, chỉ để tính độ phủ. */
  missingCostOrders: number;
  missingCostRevenue: number;
  /** Số lượng bán của nhóm: cả cửa sổ / từ mốc `recentSince` / các dòng giá vốn dòng = 0. */
  units: number;
  unitsRecent: number;
  unitsNoCost: number;
}

/** Hai mảng song song (nhóm, mã SKU sàn); một SKU được thuộc nhiều nhóm. */
export interface LedgerMarginMapping {
  groups: readonly string[];
  skus: readonly string[];
}

export interface LedgerMarginOptions {
  /** Chỉ đơn đã đối soát (Lazada: đơn chưa có sao kê mang phí = 0). */
  settledOnly: boolean;
  /** Mốc "gần đây" của nhịp bán (unitsRecent). */
  recentSince: Date;
}

/**
 * Gom theo nhóm SKU trên sổ dòng hàng của MỘT gian trong cửa sổ ngày tạo.
 *
 * Nhóm LEDGER_MARGIN_SHOP_GROUP (mọi dòng) tự có, không nằm trong `mapping`.
 * Nhóm không có dòng hàng nào trong cửa sổ thì KHÔNG có trong kết quả.
 *
 * Cùng luật với marginOverRows (integrations/shopee/ads-insights.ts): bỏ đơn
 * hủy; `settledOnly` → chỉ đơn đã đối soát (Lazada); đơn thiếu giá vốn đứng
 * riêng. Hàm thuần tính "số của đơn × giá trị dòng khớp ÷ giá trị cả đơn" và bỏ
 * cặp (nhóm, đơn) có giá trị dòng khớp ≤ 0. Ở đây cộng thẳng phần sổ ĐÃ phân bổ
 * về từng dòng, chỉ lấy dòng có giá trị > 0 ("paid"), không cần gom theo đơn:
 *   · đơn có dòng có giá: sổ phân bổ theo tỷ trọng giá trị dòng, dòng giá 0
 *     nhận đúng 0 và phần dư làm tròn dồn về dòng giá trị lớn nhất → Σ các dòng
 *     có giá của nhóm = phần của nhóm, lệch tối đa phần làm tròn 2 số lẻ;
 *   · đơn mà mọi dòng giá 0 (chỉ có quà tặng): sổ chia đều nên dòng vẫn mang
 *     tiền, nhưng hàm thuần bỏ cả đơn — lọc "paid" bỏ đúng các dòng đó;
 *   · số đơn = số MÃ ĐƠN PHÂN BIỆT có ít nhất một dòng có giá thuộc nhóm (một
 *     đơn nhiều dòng cùng nhóm đếm một lần).
 * Nhịp bán cộng MỌI dòng của nhóm, kể cả dòng giá 0.
 * Chỉ dòng tính bằng phiên bản công thức hiện tại (như mọi báo cáo trên sổ).
 *
 * Đo trên DB dev 30/09/2026, gian 300.000 đơn / 405.000 dòng hàng trong 30 ngày,
 * 2.000 sản phẩm + 100 chiến dịch (12.000 cặp ánh xạ): khoảng 1,6 giây. Phần lớn
 * thời gian là đếm mã đơn phân biệt trên ~1,1 triệu cặp (nhóm, dòng); đếm theo
 * thứ tự byte (COLLATE "C") vì so chuỗi theo bảng chữ của database chậm gấp ba.
 */
export async function ledgerMarginByGroup(
  scope: ChannelScope,
  range: DateRangeFilter,
  mapping: LedgerMarginMapping,
  opts: LedgerMarginOptions
): Promise<Map<string, LedgerMarginGroup>> {
  const { sql, groupNames } = marginByGroupQuery(scope, range, mapping, opts);
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(sql);
  const out = new Map<string, LedgerMarginGroup>();
  for (const r of rows) {
    const index = Number(r.grp);
    out.set(index === 0 ? LEDGER_MARGIN_SHOP_GROUP : groupNames[index - 1], {
      orders: Number(r.orders),
      revenue: Number(r.revenue),
      profit: Number(r.profit),
      missingCostOrders: Number(r.missingCostOrders),
      missingCostRevenue: Number(r.missingCostRevenue),
      units: Number(r.units),
      unitsRecent: Number(r.unitsRecent),
      unitsNoCost: Number(r.unitsNoCost),
    });
  }
  return out;
}

/**
 * Kế hoạch chạy THẬT của câu gom (EXPLAIN ANALYZE) — công cụ đối chiếu dùng để
 * xác nhận câu chỉ chạm mảnh tháng của cửa sổ và xem thời gian từng bước.
 */
export async function explainLedgerMarginByGroup(
  scope: ChannelScope,
  range: DateRangeFilter,
  mapping: LedgerMarginMapping,
  opts: LedgerMarginOptions
): Promise<string[]> {
  const { sql } = marginByGroupQuery(scope, range, mapping, opts);
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  return rows.map((r) => String(r["QUERY PLAN"]));
}

function marginByGroupQuery(
  scope: ChannelScope,
  range: DateRangeFilter,
  mapping: LedgerMarginMapping,
  opts: LedgerMarginOptions
): { sql: Prisma.Sql; groupNames: string[] } {
  if (mapping.groups.length !== mapping.skus.length) {
    throw new Error(`ledgerMarginByGroup: ánh xạ lệch độ dài (${mapping.groups.length} nhóm, ${mapping.skus.length} SKU)`);
  }
  if (mapping.groups.includes(LEDGER_MARGIN_SHOP_GROUP)) {
    throw new Error(`ledgerMarginByGroup: "${LEDGER_MARGIN_SHOP_GROUP}" là khóa dành riêng cho nhóm toàn gian`);
  }
  // Nhóm đi vào câu SQL bằng SỐ THỨ TỰ (0 = toàn gian, i = groupNames[i − 1]):
  // khóa gom 4 byte thay cho chuỗi tên nhóm ở ~3 bản sao của mỗi dòng hàng.
  const groupNames: string[] = [];
  const indexOfName = new Map<string, number>();
  const groupIndexes = mapping.groups.map((name) => {
    let index = indexOfName.get(name);
    if (index === undefined) {
      groupNames.push(name);
      indexOfName.set(name, (index = groupNames.length));
    }
    return index;
  });
  const sql = Prisma.sql`
    WITH "lines" AS (
      SELECT l."orderId", l."channelSku", l."quantity", l."actualRevenue", l."profit",
             l."missingCostPrice" AS "missing",
             (l."lineGross" > 0) AS "paid",
             (l."createdAt" >= ${timestampConst(opts.recentSince)}) AS "recent",
             (l."costPriceAtSale" <= 0) AS "noCost"
      FROM "order_line_ledger" l
      WHERE ${ledgerScopeSql(scope, range, { alias: "l", constParams: true })}
        AND l."formulaVersion" = ${LEDGER_FORMULA_VERSION}::int
        AND l."shippingStatus" <> 'CANCELLED'
        ${opts.settledOnly ? Prisma.sql`AND l."isSettled"` : Prisma.empty}
    ),
    "map" AS (
      SELECT DISTINCT m."grp", m."sku"
      FROM unnest(${groupIndexes}::int[], ${[...mapping.skus]}::text[]) AS m("grp", "sku")
    ),
    "tagged" AS (
      SELECT 0 AS "grp", x."orderId", x."quantity", x."actualRevenue", x."profit", x."missing", x."paid", x."recent", x."noCost"
      FROM "lines" x
      UNION ALL
      SELECT m."grp", x."orderId", x."quantity", x."actualRevenue", x."profit", x."missing", x."paid", x."recent", x."noCost"
      FROM "lines" x
      JOIN "map" m ON m."sku" = x."channelSku"
    )
    SELECT "grp",
           count(DISTINCT "orderId" COLLATE "C") FILTER (WHERE "paid" AND NOT "missing") AS "orders",
           COALESCE(sum("actualRevenue") FILTER (WHERE "paid" AND NOT "missing"), 0) AS "revenue",
           COALESCE(sum("profit") FILTER (WHERE "paid" AND NOT "missing"), 0) AS "profit",
           count(DISTINCT "orderId" COLLATE "C") FILTER (WHERE "paid" AND "missing") AS "missingCostOrders",
           COALESCE(sum("actualRevenue") FILTER (WHERE "paid" AND "missing"), 0) AS "missingCostRevenue",
           COALESCE(sum("quantity"), 0) AS "units",
           COALESCE(sum("quantity") FILTER (WHERE "recent"), 0) AS "unitsRecent",
           COALESCE(sum("quantity") FILTER (WHERE "noCost"), 0) AS "unitsNoCost"
    FROM "tagged"
    GROUP BY "grp"
  `;
  return { sql, groupNames };
}
