// ============================================================
// GHI HIỆU SUẤT ADS THEO LÔ — AdsCampaignDailyPerf (checklist M2, 21/10/2026)
//
// Trước: mỗi (chiến dịch, ngày) là MỘT prisma.upsert — gian 200 chiến dịch × 30
// ngày = 6.000 lượt đi-về Supabase (~10 ms/lượt qua pooler Singapore) ≈ 1 phút
// chiếm một luồng worker chỉ để ghi; 3 sàn (Shopee/TikTok/Lazada) đều vậy.
//
// Nay: gom dòng rồi ghi MỘT câu INSERT … SELECT FROM unnest(mảng) … ON CONFLICT
// DO UPDATE cho mỗi lô ≤ CHUNK dòng. Số tham số cố định theo số cột (mỗi cột
// một mảng) nên câu lệnh không phình theo số dòng; planner dùng kế hoạch chung.
//
// Giữ đúng nghĩa của upsert từng dòng cũ:
//   · chỉ cột trong `columns` được ghi/đè — cột sàn không trả (TikTok không có
//     impression/clicks, Lazada không có *OrderAmount) giữ nguyên giá trị cũ /
//     mặc định 0 lúc tạo, y như `update: data` chỉ chứa các khóa ấy;
//   · cùng khóa (chiến dịch, ngày) xuất hiện nhiều lần trong một lô → dòng SAU
//     thắng (upsert tuần tự cũng vậy); đồng thời tránh lỗi Postgres "ON CONFLICT
//     DO UPDATE command cannot affect row a second time";
//   · updatedAt = now() như @updatedAt của Prisma client.
// ============================================================
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const ADS_PERF_METRICS = [
  "impression",
  "clicks",
  "expense",
  "broadOrder",
  "broadGmv",
  "directOrder",
  "directGmv",
  "broadOrderAmount",
  "directOrderAmount",
] as const;
export type AdsPerfMetric = (typeof ADS_PERF_METRICS)[number];

/** Cột số nguyên (INTEGER) — còn lại là Decimal(14,2). */
const INT_METRICS: ReadonlySet<AdsPerfMetric> = new Set<AdsPerfMetric>([
  "impression",
  "clicks",
  "broadOrder",
  "directOrder",
  "broadOrderAmount",
  "directOrderAmount",
]);

export interface AdsPerfRow extends Partial<Record<AdsPerfMetric, number>> {
  adsCampaignId: string;
  /** Ngày sàn ở dạng Date nửa đêm UTC (dateKeyToDbDate / fromShopeeDate) — cột @db.Date. */
  date: Date;
}

/** Số dòng tối đa một câu lệnh (mảng unnest). */
export const ADS_PERF_CHUNK = 1000;

const dateKeyOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Gộp dòng trùng khóa (chiến dịch, ngày): dòng SAU thắng, giữ thứ tự lần đầu xuất
 * hiện. Thuần — có test.
 */
export function dedupeAdsPerfRows(rows: readonly AdsPerfRow[]): AdsPerfRow[] {
  const byKey = new Map<string, AdsPerfRow>();
  for (const r of rows) byKey.set(`${r.adsCampaignId}|${dateKeyOf(r.date)}`, r);
  return [...byKey.values()];
}

/**
 * Upsert một lô dòng hiệu suất. `columns` = cột sàn này có số (ghi + đè đúng các
 * cột ấy). Trả về số dòng đã ghi (sau khi gộp trùng). Mảng rỗng → không chạm DB.
 */
export async function upsertAdsPerfBatch(
  rows: readonly AdsPerfRow[],
  columns: readonly AdsPerfMetric[],
  db: Pick<typeof prisma, "$executeRaw"> = prisma
): Promise<number> {
  if (!rows.length || !columns.length) return 0;
  const deduped = dedupeAdsPerfRows(rows);
  for (let i = 0; i < deduped.length; i += ADS_PERF_CHUNK) {
    await executeChunk(deduped.slice(i, i + ADS_PERF_CHUNK), columns, db);
  }
  return deduped.length;
}

async function executeChunk(
  chunk: readonly AdsPerfRow[],
  columns: readonly AdsPerfMetric[],
  db: Pick<typeof prisma, "$executeRaw">
): Promise<void> {
  const quoted = columns.map((c) => Prisma.raw(`"${c}"`));
  // unnest(text[], date[], <mỗi cột một mảng>) AS r("adsCampaignId", "date", <cột…>)
  const arrays: Prisma.Sql[] = [
    Prisma.sql`${chunk.map((r) => r.adsCampaignId)}::text[]`,
    Prisma.sql`${chunk.map((r) => dateKeyOf(r.date))}::date[]`,
    ...columns.map((c) =>
      INT_METRICS.has(c)
        ? Prisma.sql`${chunk.map((r) => Math.trunc(Number(r[c] ?? 0)) || 0)}::int[]`
        : Prisma.sql`${chunk.map((r) => Number(r[c] ?? 0) || 0)}::numeric[]`
    ),
  ];
  const colList = Prisma.join([Prisma.raw(`"adsCampaignId"`), Prisma.raw(`"date"`), ...quoted], ", ");
  const setList = Prisma.join(
    columns.map((c) => Prisma.raw(`"${c}" = EXCLUDED."${c}"`)),
    ", "
  );
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "AdsCampaignDailyPerf" ("id", ${colList}, "updatedAt")
    SELECT gen_random_uuid()::text, ${colList}, now()
    FROM unnest(${Prisma.join(arrays, ", ")}) AS r(${colList})
    ON CONFLICT ("adsCampaignId", "date") DO UPDATE SET ${setList}, "updatedAt" = now()
  `);
}
