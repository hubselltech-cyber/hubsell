import { ChannelName, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { saveCostPlan } from "./cost-import-apply";
import {
  EFFECTIVE_COST,
  catalogFilterConds,
  catalogScopeConds,
  foldSearchText,
  searchRank,
  type SkuCatalogFilters,
} from "./sku-catalog-page";

/**
 * ÁP MỘT GIÁ VỐN CHO TẤT CẢ MÃ VỪA TÌM (03/11/2026, khách tìm một họ mã rồi muốn áp một giá; `tldc` 19.553 dòng có
 * giá đều đúng một mức, 4.992 dòng còn trống).
 *
 * Máy chủ tự tính danh sách theo từ khóa và bộ lọc, không tin danh sách trình duyệt gửi lên.
 * Chỉ tính dòng khớp theo MÃ (SKU sàn, mã kho, mã mẫu, mã sàn), không tính dòng chỉ khớp tên: khớp tên sai là lãi lỗ
 * sai âm thầm (nguyên tắc ở lib/cost-mapping.ts). Mặc định chỉ điền ô trống; ghi đè phải được yêu cầu rõ.
 * Ghi giá riêng của gian, đơn cũ chỉ vá dòng đang 0, cùng đường với Nhập Excel (saveCostPlan).
 */

export type SearchApplyFilters = Pick<
  SkuCatalogFilters,
  "ownerId" | "channelName" | "channelId" | "q" | "status" | "listing"
>;

export class SearchApplyInputError extends Error {}
/** Danh sách đã đổi so với lúc khách xác nhận (ví dụ danh mục vừa kéo về): không ghi, để khách xem lại. */
export class SearchApplyChangedError extends Error {}

function targetsCte(f: SearchApplyFilters): Prisma.Sql {
  // Thiếu từ khóa thì searchRank coi mọi dòng là khớp: tuyệt đối không được chạm cả gian.
  if (!foldSearchText(f.q)) throw new SearchApplyInputError("Thiếu từ khóa tìm kiếm");
  const { lateral, rank, code } = searchRank(f.q, false);
  const filters = catalogFilterConds(f);
  const inFilter = filters.length > 0 ? Prisma.join(filters, " AND ") : Prisma.sql`TRUE`;
  return Prisma.sql`t AS MATERIALIZED (
    SELECT y.* FROM (
      SELECT cp.id, cp."channelSku" AS sku, ${EFFECTIVE_COST} AS cost, ${rank} AS rnk, ${code} AS code,
             (${inFilter}) AS in_filter
      FROM "ChannelProduct" cp
      JOIN "Channel" c ON c.id = cp."channelId"
      LEFT JOIN "Product" p ON p.id = cp."productId"
      ${lateral}
      WHERE ${Prisma.join(catalogScopeConds(f.ownerId), " AND ")}
    ) y
    WHERE y.rnk IS NOT NULL
  )`;
}

export interface SearchApplySummary {
  /** Dòng khớp mã trong bộ lọc đang chọn. */
  matched: number;
  missing: number;
  filled: number;
  /** Dòng khớp mã trong toàn bộ gian, bỏ qua bộ lọc: lớn hơn matched nghĩa là bộ lọc đang che. */
  everywhere: number;
}

/** Số hiện trên dải áp giá. */
export async function summarizeSearchApply(f: SearchApplyFilters): Promise<SearchApplySummary> {
  const [row] = await prisma.$queryRaw<SearchApplySummary[]>(Prisma.sql`
    WITH ${targetsCte(f)}
    SELECT (count(*) FILTER (WHERE in_filter))::int AS matched,
           (count(*) FILTER (WHERE in_filter AND cost <= 0))::int AS missing,
           (count(*) FILTER (WHERE in_filter AND cost > 0))::int AS filled,
           count(*)::int AS everywhere
    FROM t`);
  return row;
}

const targetsWhere = (cost: number, overwrite: boolean) => Prisma.sql`in_filter AND (
  cost <= 0 OR (${overwrite}::boolean AND cost <> ${cost}::numeric)
)`;

export interface SearchApplyPreview {
  /** Tổng dòng sẽ ghi. */
  rows: number;
  fill: number;
  overwrite: number;
  /** Giá đang có của các dòng sắp bị đổi, nhiều dòng nhất trước. */
  levels: { cost: number; rows: number }[];
  levelCount: number;
  samples: string[];
  /** Dòng chỉ chứa từ khóa ở giữa mã, dễ khớp ngoài ý muốn. */
  middleRows: number;
  middleSamples: string[];
}

/** Hộp xác nhận: đúng những gì sẽ ghi với giá này. */
export async function previewSearchApply(
  f: SearchApplyFilters,
  cost: number,
  overwrite: boolean
): Promise<SearchApplyPreview> {
  const [row] = await prisma.$queryRaw<SearchApplyPreview[]>(Prisma.sql`
    WITH ${targetsCte(f)},
    a AS MATERIALIZED (SELECT * FROM t WHERE ${targetsWhere(cost, overwrite)}),
    l AS (SELECT a.cost, count(*)::int AS rows FROM a WHERE a.cost > 0 GROUP BY a.cost)
    SELECT (SELECT count(*) FROM a)::int AS rows,
           (SELECT count(*) FROM a WHERE a.cost <= 0)::int AS fill,
           (SELECT count(*) FROM a WHERE a.cost > 0)::int AS overwrite,
           COALESCE((SELECT json_agg(json_build_object('cost', z.cost::float8, 'rows', z.rows) ORDER BY z.rows DESC, z.cost)
                     FROM (SELECT * FROM l ORDER BY rows DESC, cost LIMIT 5) z), '[]'::json) AS levels,
           (SELECT count(*) FROM l)::int AS "levelCount",
           COALESCE((SELECT json_agg(z.sku) FROM (SELECT a.sku FROM a ORDER BY a.rnk, a.code COLLATE "C" LIMIT 5) z), '[]'::json) AS samples,
           (SELECT count(*) FROM a WHERE a.rnk = 2)::int AS "middleRows",
           COALESCE((SELECT json_agg(z.sku) FROM (SELECT a.sku FROM a WHERE a.rnk = 2 ORDER BY a.code COLLATE "C" LIMIT 3) z), '[]'::json) AS "middleSamples"`);
  return row;
}

/** Ghi giá. `expectedRows` là số khách đã thấy trong hộp xác nhận: lệch thì không ghi gì. */
export async function applySearchCost(
  f: SearchApplyFilters,
  cost: number,
  overwrite: boolean,
  expectedRows: number
): Promise<{ updated: number; backfilled: number }> {
  if (!(cost > 0)) throw new SearchApplyInputError("Giá vốn phải là số lớn hơn 0");
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH ${targetsCte(f)}
    SELECT id FROM t WHERE ${targetsWhere(cost, overwrite)}`);
  if (rows.length !== expectedRows) {
    throw new SearchApplyChangedError(
      `Danh sách vừa thay đổi: nay có ${rows.length.toLocaleString("vi-VN")} mã thay vì ${expectedRows.toLocaleString("vi-VN")} mã. Chưa ghi gì, vui lòng xem lại.`
    );
  }
  if (rows.length === 0) return { updated: 0, backfilled: 0 };
  return saveCostPlan(
    { productCost: new Map(), shopCost: new Map(rows.map((r) => [r.id, cost])) },
    f.ownerId
  );
}

const CHANNEL_KEYS: Record<string, ChannelName> = {
  shopee: ChannelName.SHOPEE,
  tiktok: ChannelName.TIKTOK,
  lazada: ChannelName.LAZADA,
};

/** Đọc bộ lọc từ query hoặc body, cùng nghĩa với GET /sku-products. */
export function readSearchApplyFilters(ownerId: string, src: Record<string, unknown>): SearchApplyFilters {
  const str = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : "");
  const shop = str("shop");
  const status = str("status");
  const listing = str("listing");
  return {
    ownerId,
    q: str("q").trim().slice(0, 100),
    channelName: CHANNEL_KEYS[str("channel").toLowerCase()] ?? null,
    channelId: shop && shop !== "all" ? shop : null,
    status: status === "missing" || status === "filled" ? status : "all",
    listing: listing === "delisted" || listing === "all" ? listing : "active",
  };
}
