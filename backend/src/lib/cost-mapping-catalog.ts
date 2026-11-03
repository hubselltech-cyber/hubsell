import { ChannelName, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { foldedColumn, foldSearchText } from "./sku-catalog-page";

/**
 * TAB MAPPING GIÁ VỐN TÍNH TRONG DB (03/11/2026). Gộp theo mã, đếm trạng thái, lọc, tìm và chọn trang đều
 * trong MỘT câu SQL; web chỉ đọc tiếp các dòng của trang đó. Thay chỗ chặn 5.000 mã đã làm khách 57.877 dòng
 * không mở được tab. Luật trạng thái phải khớp groupSkusByCode (lib/cost-mapping.ts); test đối chiếu hai bên.
 */

export type SkuGroupStatusFilter = "all" | "suggest" | "conflict" | "missing" | "complete";

export interface SkuGroupPageQuery {
  ownerId: string;
  channelIds?: string[];
  q: string;
  status: SkuGroupStatusFilter;
  limit: number;
}

export interface SkuGroupPage {
  totals: {
    codes: number;
    suggest: number;
    conflict: number;
    missing: number;
    complete: number;
    suggestEmptySlots: number;
  };
  matchedCodes: number;
  /** Mã của trang, đúng thứ tự hiển thị: tên sản phẩm rồi mã, nên các phân loại một mẫu đứng cạnh nhau. */
  codes: string[];
  /** Id ChannelProduct của mọi gian mang các mã đó. */
  ids: string[];
  shops: { channelId: string; channelName: ChannelName; shopName: string }[];
}

/** Khớp normalizeSkuCode: NFC, bỏ khoảng trắng hai đầu, chữ hoa. Dùng chr() để không mất gạch chéo qua Prisma. */
const CODE = Prisma.sql`upper(btrim(normalize(cp."channelSku", NFC), ' ' || chr(9) || chr(10) || chr(13) || chr(160)))`;
const EFFECTIVE_COST = Prisma.sql`CASE WHEN COALESCE(cp."costPrice", 0) > 0 THEN cp."costPrice" ELSE COALESCE(p."costPrice", 0) END`;

function targetsCte(ownerId: string, channelIds: string[] | undefined, hit: Prisma.Sql): Prisma.Sql {
  const scope = channelIds ? Prisma.sql`AND c."id" = ANY(${channelIds}::text[])` : Prisma.empty;
  return Prisma.sql`
    t AS MATERIALIZED (
      SELECT cp."id", cp."channelId", cp."productName", ${CODE} AS code, ${EFFECTIVE_COST} AS cost, ${hit} AS hit
      FROM "ChannelProduct" AS cp
      JOIN "Channel" AS c ON c."id" = cp."channelId"
      LEFT JOIN "Product" AS p ON p."id" = cp."productId"
      WHERE c."userId" = ${ownerId} AND c."channelName"::text <> 'OFFLINE' ${scope}
    )`;
}

function statusCte(ownerId: string): Prisma.Sql {
  return Prisma.sql`
    g AS MATERIALIZED (
      SELECT code,
             count(DISTINCT cost) FILTER (WHERE cost > 0)::int AS costs,
             count(*) FILTER (WHERE cost <= 0)::int AS empties,
             min(cost) FILTER (WHERE cost > 0) AS suggested,
             min(lower("productName") COLLATE "C") AS name,
             bool_or(hit) AS hit
      FROM t WHERE code <> '' GROUP BY code
    ),
    s AS MATERIALIZED (
      SELECT g.*,
             CASE
               WHEN g.costs = 0 THEN 'missing'
               WHEN g.costs > 1 AND d."code" IS NOT NULL THEN (CASE WHEN g.empties > 0 THEN 'missing' ELSE 'complete' END)
               WHEN g.costs > 1 THEN 'conflict'
               WHEN g.empties > 0 THEN 'suggest'
               ELSE 'complete'
             END AS status
      FROM g
      LEFT JOIN "cost_conflict_dismissals" AS d ON d."userId" = ${ownerId} AND d."code" = g.code
    )`;
}

export async function loadSkuGroupPage(query: SkuGroupPageQuery): Promise<SkuGroupPage> {
  const needle = foldSearchText(query.q);
  const raw = query.q.trim();
  const hit = needle
    ? Prisma.sql`(
        strpos(${foldedColumn(Prisma.sql`cp."channelSku"`)}, ${needle}) > 0
        OR strpos(${foldedColumn(Prisma.sql`cp."productName"`)}, ${needle}) > 0
        OR strpos(${foldedColumn(Prisma.sql`cp."variantName"`)}, ${needle}) > 0
        OR strpos(COALESCE(cp."externalId", ''), ${raw}) > 0
      )`
    : Prisma.sql`TRUE`;
  const statusCond =
    query.status === "all" ? Prisma.sql`TRUE` : Prisma.sql`s.status = ${query.status}`;

  const [row] = await prisma.$queryRaw<
    {
      totals: SkuGroupPage["totals"];
      matched: number;
      codes: string[];
      ids: string[];
      shops: SkuGroupPage["shops"];
    }[]
  >(Prisma.sql`
    WITH ${targetsCte(query.ownerId, query.channelIds, hit)},
    ${statusCte(query.ownerId)},
    chosen AS (
      SELECT s.code, row_number() OVER (ORDER BY s.name, s.code) AS rn
      FROM s
      WHERE s.hit AND ${statusCond}
      ORDER BY s.name, s.code
      LIMIT ${query.limit}::int
    )
    SELECT
      (SELECT json_build_object(
         'codes', count(*)::int,
         'suggest', (count(*) FILTER (WHERE status = 'suggest'))::int,
         'conflict', (count(*) FILTER (WHERE status = 'conflict'))::int,
         'missing', (count(*) FILTER (WHERE status = 'missing'))::int,
         'complete', (count(*) FILTER (WHERE status = 'complete'))::int,
         'suggestEmptySlots', (COALESCE(sum(empties) FILTER (WHERE status = 'suggest'), 0))::int
       ) FROM s) AS totals,
      (SELECT count(*)::int FROM s WHERE s.hit AND ${statusCond}) AS matched,
      COALESCE((SELECT json_agg(code ORDER BY rn) FROM chosen), '[]'::json) AS codes,
      COALESCE((SELECT json_agg(t."id") FROM t JOIN chosen ON chosen.code = t.code), '[]'::json) AS ids,
      COALESCE((
        SELECT json_agg(json_build_object('channelId', c."id", 'channelName', c."channelName", 'shopName', c."shopName"))
        FROM "Channel" AS c WHERE c."id" IN (SELECT DISTINCT "channelId" FROM t)
      ), '[]'::json) AS shops`);

  return {
    totals: row.totals,
    matchedCodes: row.matched,
    codes: row.codes,
    ids: row.ids,
    shops: row.shops,
  };
}

/** Nút "Điền tất cả": ô trống của mọi mã mà các gian đã có giá đều thống nhất một giá. */
export async function loadSuggestedFill(
  ownerId: string,
  channelIds?: string[]
): Promise<{ codes: number; rows: { skuId: string; newCost: number }[] }> {
  const rows = await prisma.$queryRaw<{ id: string; code: string; cost: unknown }[]>(Prisma.sql`
    WITH ${targetsCte(ownerId, channelIds, Prisma.sql`TRUE`)},
    ${statusCte(ownerId)}
    SELECT t."id", s.code, s.suggested AS cost
    FROM t JOIN s ON s.code = t.code
    WHERE s.status = 'suggest' AND t.cost <= 0`);
  return {
    codes: new Set(rows.map((r) => r.code)).size,
    rows: rows.map((r) => ({ skuId: r.id, newCost: Number(r.cost) })),
  };
}
