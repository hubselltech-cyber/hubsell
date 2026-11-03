import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * NHẬP GIÁ VỐN TỪ EXCEL: CHỈ ĐỌC CÁC MÃ CÓ TRONG FILE (03/11/2026).
 *
 * Trước đây route tải cả danh mục của chủ shop rồi so khớp trong RAM. Lớp chắn chiều 03/11 lại từ chối
 * hẳn gian trên 5.000 mã, khiến khách 57.877 mã nhập file 1.229 dòng bị báo lỗi. Nay DB chỉ trả các dòng
 * trùng mã trong file, số dòng theo cỡ file chứ không theo cỡ gian, nên không cần trần.
 *
 * So khớp giống `norm` của lib/cost-import.ts (NFC, bỏ khoảng trắng hai đầu, không phân biệt hoa thường).
 * Dùng `=` với lower() ở CẢ HAI vế trong SQL, không dùng LIKE: "_" và "%" trong mã vẫn là chữ thường.
 */

export interface CostImportProduct {
  id: string;
  skuCode: string;
  costPrice: number;
}

export interface CostImportChannelProduct {
  id: string;
  channelId: string;
  channelSku: string;
  productId: string | null;
  /** Giá riêng của gian; null = chưa có. */
  costPrice: number | null;
  /** Giá mặc định của sản phẩm kho đã nối. */
  product: { costPrice: number } | null;
}

export async function loadCostImportData(
  ownerId: string,
  skus: string[]
): Promise<{ products: CostImportProduct[]; channelProducts: CostImportChannelProduct[] }> {
  const wanted = [...new Set(skus.map((s) => s.normalize("NFC").trim()).filter(Boolean))];
  if (wanted.length === 0) return { products: [], channelProducts: [] };

  const codes = Prisma.sql`(
    SELECT DISTINCT lower(btrim(normalize(code, NFC))) AS code FROM unnest(${wanted}::text[]) AS t(code)
  ) w`;

  const [products, channelProducts] = await Promise.all([
    prisma.$queryRaw<CostImportProduct[]>(Prisma.sql`
      SELECT p.id, p."skuCode", p."costPrice"::float8 AS "costPrice"
      FROM "Product" p
      JOIN ${codes} ON lower(btrim(normalize(p."skuCode", NFC))) = w.code
      WHERE p."userId" = ${ownerId}`),
    prisma.$queryRaw<
      (Omit<CostImportChannelProduct, "product"> & { stockCost: number | null })[]
    >(Prisma.sql`
      SELECT cp.id, cp."channelId", cp."channelSku", cp."productId",
             cp."costPrice"::float8 AS "costPrice", p."costPrice"::float8 AS "stockCost"
      FROM "ChannelProduct" cp
      JOIN "Channel" c ON c.id = cp."channelId"
      LEFT JOIN "Product" p ON p.id = cp."productId"
      JOIN ${codes} ON lower(btrim(normalize(cp."channelSku", NFC))) = w.code
      WHERE c."userId" = ${ownerId}`),
  ]);

  return {
    products,
    channelProducts: channelProducts.map(({ stockCost, ...cp }) => ({
      ...cp,
      product: stockCost === null ? null : { costPrice: stockCost },
    })),
  };
}
