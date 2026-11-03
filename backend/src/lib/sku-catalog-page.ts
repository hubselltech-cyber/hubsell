import { ChannelName, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * TRANG GIÁ VỐN THEO TRANG Ở DB CHO GIAN LỚN (lát 3.8 giai đoạn 3, docs/DONG-BO-GIAI-DOAN-3.md mục 6).
 *
 * Gốc sự cố 03/11/2026: GET /sku-products tải nguyên danh mục (57.877 dòng) vào RAM web 512 MB. Gian
 * vượt catalogRowLimit() nay lọc, tìm, đếm và chia trang ngay trong SQL; web chỉ giữ một trang. Gian
 * nhỏ vẫn đi đường cũ (tải hết, lọc trên trình duyệt) để không đổi gì với khách đang dùng tốt.
 *
 * Một trang = N MẪU sản phẩm (gian + mã sản phẩm sàn), giống phân trang trên trình duyệt: mỗi mẫu
 * mang đủ các phân loại khớp bộ lọc. Dòng không có mã sàn đứng một mình (đường cũ đoán theo tên
 * được vì có đủ dữ liệu trong RAM, SQL thì không). Thứ tự ổn định theo mẫu mới nhất: lưu giá xong
 * dòng không nhảy đi chỗ khác.
 */

export interface SkuCatalogFilters {
  ownerId: string;
  /** SHOPEE/TIKTOK/LAZADA; null = mọi sàn online. */
  channelName: ChannelName | null;
  /** Một gian; null = mọi gian. */
  channelId: string | null;
  q: string;
  status: "all" | "missing" | "filled";
  listing: "active" | "delisted" | "all";
  page: number;
  pageSize: number;
}

export interface SkuCatalogPage {
  /** Id ChannelProduct của trang, đúng thứ tự hiển thị. */
  ids: string[];
  filteredRows: number;
  totalGroups: number;
}

/** Bỏ dấu + chữ thường, cùng luật với normalizeText của giao diện (gõ "ao thun" ra "Áo thun"). */
export function foldSearchText(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

const VN_ACCENTED =
  "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ";
const VN_PLAIN =
  "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd";

/** Biểu thức SQL gập dấu một cột text — cùng kết quả với foldSearchText. */
export function foldedColumn(column: Prisma.Sql): Prisma.Sql {
  // Giá trị toàn chữ không dấu (số byte = số ký tự) chỉ cần lower: translate dò từng ký tự qua cả bảng dấu nên rất
  // đắt. Mã SKU gần như luôn không dấu; đo prod 03/11 trên 52.830 dòng còn dưới 1 giây khi chỉ dò các cột mã.
  const v = Prisma.sql`COALESCE(${column}, '')`;
  return Prisma.sql`CASE WHEN octet_length(${v}) = char_length(${v}) THEN lower(${v})
    ELSE translate(lower(normalize(${v}, NFC)), ${VN_ACCENTED}, ${VN_PLAIN}) END`;
}

const GROUP_ITEM = Prisma.sql`COALESCE(NULLIF(split_part(cp."externalId", '-', 1), ''), 'cp:' || cp.id)`;
const EFFECTIVE_COST = Prisma.sql`CASE WHEN COALESCE(cp."costPrice", 0) > 0 THEN cp."costPrice" ELSE COALESCE(p."costPrice", 0) END`;

function buildWhere(f: SkuCatalogFilters): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    Prisma.sql`c."userId" = ${f.ownerId}`,
    Prisma.sql`c."channelName"::text <> 'OFFLINE'`,
  ];
  if (f.channelName) conds.push(Prisma.sql`c."channelName"::text = ${f.channelName}`);
  if (f.channelId) conds.push(Prisma.sql`cp."channelId" = ${f.channelId}`);
  if (f.listing === "active") conds.push(Prisma.sql`cp.status::text = 'ACTIVE'`);
  if (f.listing === "delisted") conds.push(Prisma.sql`cp.status::text <> 'ACTIVE'`);
  if (f.status === "missing") conds.push(Prisma.sql`${EFFECTIVE_COST} <= 0`);
  if (f.status === "filled") conds.push(Prisma.sql`${EFFECTIVE_COST} > 0`);
  return Prisma.join(conds, " AND ");
}

/**
 * Độ khớp của một dòng với từ khóa (03/11/2026, khách gõ `tldc` ra 40 trang xếp theo hàng mới về):
 * 0 trùng đúng mã, 1 bắt đầu bằng từ khóa, 2 mã có chứa từ khóa, 3 tên hoặc phân loại có chứa, NULL không khớp.
 * Mã gồm mã SKU sàn, mã kho, mã mẫu và mã sàn. Tên chỉ gập dấu khi các mã không khớp, vì gập tên là bước đắt nhất.
 * Dùng strpos, starts_with thay LIKE: từ khóa có "_" hay "%" vẫn là chữ thường.
 * includeNames = false: chỉ dò các cột mã.
 */
function searchRank(
  q: string,
  includeNames: boolean
): { lateral: Prisma.Sql; rank: Prisma.Sql; code: Prisma.Sql } {
  const needle = foldSearchText(q);
  if (!needle) return { lateral: Prisma.empty, rank: Prisma.sql`0`, code: Prisma.sql`NULL::text` };
  const raw = q.trim();
  const hit = (col: Prisma.Sql) => Prisma.sql`strpos(${foldedColumn(col)}, ${needle}) > 0`;
  return {
    // OFFSET 0 để Postgres không lặp lại phép gập ở mỗi nhánh CASE.
    lateral: Prisma.sql`CROSS JOIN LATERAL (
      SELECT ${foldedColumn(Prisma.sql`cp."channelSku"`)} AS sku,
             ${foldedColumn(Prisma.sql`p."skuCode"`)} AS kho,
             ${foldedColumn(Prisma.sql`cp."itemSku"`)} AS mau,
             lower(COALESCE(cp."externalId", '')) AS ext
      OFFSET 0
    ) AS x`,
    rank: Prisma.sql`CASE
      WHEN x.sku = ${needle} OR x.kho = ${needle} OR x.mau = ${needle} OR x.ext = ${needle}
        OR split_part(x.ext, '-', 1) = ${raw} OR split_part(x.ext, '-', 2) = ${raw} THEN 0
      WHEN starts_with(x.sku, ${needle}) OR starts_with(x.kho, ${needle}) OR starts_with(x.mau, ${needle}) THEN 1
      WHEN strpos(x.sku, ${needle}) > 0 OR strpos(x.kho, ${needle}) > 0 OR strpos(x.mau, ${needle}) > 0
        OR strpos(x.ext, ${needle}) > 0 THEN 2
      ${
        includeNames
          ? Prisma.sql`WHEN ${hit(Prisma.sql`cp."productName"`)} OR ${hit(Prisma.sql`cp."variantName"`)} OR ${hit(Prisma.sql`p."productName"`)} THEN 3`
          : Prisma.empty
      }
    END`,
    code: Prisma.sql`x.sku`,
  };
}

/**
 * Từ khóa trông như mã: có số, gạch nối hoặc gạch dưới, không có khoảng trắng. Loại này dò các cột mã trước, thấy là
 * trả ngay, không gập tên của cả danh mục (đo prod 03/11, 52.830 dòng: 0,9 giây thay vì 8 giây). Không thấy mã nào
 * mới dò tiếp đến tên. Chữ thường như "vay dam" hay "tldc" vẫn dò cả tên, vì mã trùng chữ không được che tên sản phẩm.
 */
export function looksLikeSkuCode(q: string): boolean {
  const s = q.trim();
  return /[0-9_-]/.test(s) && !/\s/.test(s);
}

export async function loadSkuCatalogPage(f: SkuCatalogFilters): Promise<SkuCatalogPage> {
  if (looksLikeSkuCode(f.q)) {
    const byCode = await queryPage(f, false);
    if (byCode.filteredRows > 0) return byCode;
  }
  return queryPage(f, true);
}

async function queryPage(f: SkuCatalogFilters, includeNames: boolean): Promise<SkuCatalogPage> {
  const offset = (f.page - 1) * f.pageSize;
  // Một câu duy nhất: lọc MỘT lần (MATERIALIZED) rồi đếm + chia trang trên kết quả. Bản đầu chạy 3 câu
  // riêng nên phép gập dấu lặp 3 lần trên cả danh mục (tìm 60.000 dòng mất 1,4–2,9 giây, đo 03/11/2026).
  const { lateral, rank, code } = searchRank(f.q, includeNames);
  const [row] = await prisma.$queryRaw<{ rows: number; groups: number; ids: string[] }[]>(Prisma.sql`
    WITH f AS MATERIALIZED (
      SELECT y.id, y."createdAt", y.key, y.rnk, y.code FROM (
        SELECT cp.id, cp."createdAt", cp."channelId" || ':' || ${GROUP_ITEM} AS key, ${rank} AS rnk, ${code} AS code
        FROM "ChannelProduct" cp
        JOIN "Channel" c ON c.id = cp."channelId"
        LEFT JOIN "Product" p ON p.id = cp."productId"
        ${lateral}
        WHERE ${buildWhere(f)}
      ) y
      WHERE y.rnk IS NOT NULL
    ),
    g AS (
      SELECT key, max("createdAt") AS last, min(rnk) AS rnk, min(code COLLATE "C") AS code FROM f GROUP BY key
    ),
    pg AS (
      SELECT key, row_number() OVER (ORDER BY rnk, code, last DESC, key) AS rn
      FROM g
      ORDER BY rnk, code, last DESC, key
      LIMIT ${f.pageSize}::int OFFSET ${offset}::int
    )
    SELECT (SELECT count(*) FROM f)::int AS rows,
           (SELECT count(*) FROM g)::int AS groups,
           COALESCE(
             (SELECT json_agg(x.id ORDER BY x.rn, x.rnk, x.code COLLATE "C", x."createdAt" DESC, x.id)
              FROM (SELECT f.id, f."createdAt", f.rnk, f.code, pg.rn FROM pg JOIN f ON f.key = pg.key) x),
             '[]'::json
           ) AS ids`);
  return { ids: row?.ids ?? [], filteredRows: row?.rows ?? 0, totalGroups: row?.groups ?? 0 };
}

/** Số dòng khớp từ khóa trong toàn bộ gian, bỏ qua mọi bộ lọc: để báo "có N mã đang bị bộ lọc che". */
export async function countSkuSearchEverywhere(ownerId: string, q: string): Promise<number> {
  const r = await loadSkuCatalogPage({
    ownerId,
    channelName: null,
    channelId: null,
    q,
    status: "all",
    listing: "all",
    page: 1,
    pageSize: 1,
  });
  return r.filteredRows;
}
