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
  return Prisma.sql`translate(lower(normalize(COALESCE(${column}, ''), NFC)), ${VN_ACCENTED}, ${VN_PLAIN})`;
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
  const needle = foldSearchText(f.q);
  if (needle) {
    // strpos thay vì LIKE: từ khóa có "_" hay "%" vẫn là chữ thường, không thành ký tự đại diện.
    const hit = (col: Prisma.Sql) => Prisma.sql`strpos(${foldedColumn(col)}, ${needle}) > 0`;
    conds.push(
      Prisma.sql`(${Prisma.join(
        [
          hit(Prisma.sql`cp."channelSku"`),
          hit(Prisma.sql`cp."productName"`),
          hit(Prisma.sql`cp."variantName"`),
          hit(Prisma.sql`cp."itemSku"`),
          hit(Prisma.sql`cp."externalId"`),
          hit(Prisma.sql`p."productName"`),
        ],
        " OR "
      )})`
    );
  }
  return Prisma.join(conds, " AND ");
}

export async function loadSkuCatalogPage(f: SkuCatalogFilters): Promise<SkuCatalogPage> {
  const offset = (f.page - 1) * f.pageSize;
  // Một câu duy nhất: lọc MỘT lần (MATERIALIZED) rồi đếm + chia trang trên kết quả. Bản đầu chạy 3 câu
  // riêng nên phép gập dấu lặp 3 lần trên cả danh mục (tìm 60.000 dòng mất 1,4–2,9 giây, đo 03/11/2026).
  const [row] = await prisma.$queryRaw<{ rows: number; groups: number; ids: string[] }[]>(Prisma.sql`
    WITH f AS MATERIALIZED (
      SELECT cp.id, cp."createdAt", cp."channelId" || ':' || ${GROUP_ITEM} AS key
      FROM "ChannelProduct" cp
      JOIN "Channel" c ON c.id = cp."channelId"
      LEFT JOIN "Product" p ON p.id = cp."productId"
      WHERE ${buildWhere(f)}
    ),
    g AS (
      SELECT key, max("createdAt") AS last FROM f GROUP BY key
    ),
    pg AS (
      SELECT key, row_number() OVER (ORDER BY last DESC, key) AS rn
      FROM g
      ORDER BY last DESC, key
      LIMIT ${f.pageSize}::int OFFSET ${offset}::int
    )
    SELECT (SELECT count(*) FROM f)::int AS rows,
           (SELECT count(*) FROM g)::int AS groups,
           COALESCE(
             (SELECT json_agg(x.id ORDER BY x.rn, x."createdAt" DESC, x.id)
              FROM (SELECT f.id, f."createdAt", pg.rn FROM pg JOIN f ON f.key = pg.key) x),
             '[]'::json
           ) AS ids`);
  return { ids: row?.ids ?? [], filteredRows: row?.rows ?? 0, totalGroups: row?.groups ?? 0 };
}
