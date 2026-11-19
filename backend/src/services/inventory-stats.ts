// ============================================================
// THỐNG KÊ TỔNG KHO (19/11/2026 — docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 14)
//
// Anh Trung: thay nút "Đồng bộ tồn kho" ở Tổng kho bằng "Thống kê" — hộp cho biết cả kho có bao nhiêu
// sản phẩm, SKU, tồn, và tổng tồn / tổng giá trị. Một câu gom trên Product của chủ shop, chỉ chạy khi
// khách mở hộp.
//
// Cùng định nghĩa với bảng Tổng kho, để số ở hộp cộng ra đúng số trên bảng:
//   · Sản phẩm = mẫu hàng (các phân loại chung groupKey là MỘT sản phẩm) — như nhãn "N sản phẩm · M SKU";
//   · Hết hàng = tồn ≤ 0 — như chip "Hết hàng N";
//   · Giá trị tồn = tồn × giá vốn mặc định ở kho, tồn âm tính 0, SKU chưa nhập giá vốn chưa được cộng —
//     như cột "Giá trị tồn" (frontend stock-value.tsx).
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** Một nhóm SKU trong báo cáo: số SKU, tổng tồn (tồn âm tính 0), giá trị tồn theo giá vốn. */
export interface InventoryStatsBucket {
  skus: number;
  quantity: number;
  /** Vắng mặt với người không được biết giá vốn. */
  value?: number;
}

export interface InventoryStats {
  /** Số mẫu hàng đang bán. */
  products: number;
  /** Đang bán, tồn > 0. */
  inStock: InventoryStatsBucket;
  /** Đang bán, tồn ≤ 0. */
  outOfStock: InventoryStatsBucket;
  /** Đã ngừng kinh doanh (hàng còn trong kho vẫn là tiền nằm trong kho). */
  inactive: InventoryStatsBucket;
  total: InventoryStatsBucket;
  /** SKU đang âm tồn (bán vượt) — tính 0 trong tổng tồn và giá trị. */
  negativeSkus: number;
  /** SKU CÒN HÀNG nhưng chưa nhập giá vốn, và số lượng của chúng — phần chưa nằm trong giá trị tồn. */
  noCostSkus?: number;
  noCostQuantity?: number;
  costPriceHidden: boolean;
}

interface StatsRow {
  products: number;
  activeIn: number;
  activeOut: number;
  inactive: number;
  qtyActive: number;
  qtyInactive: number;
  valueActive: number;
  valueInactive: number;
  negativeSkus: number;
  noCostSkus: number;
  noCostQuantity: number;
}

export async function loadInventoryStats(ownerId: string, opts: { seesCost: boolean }): Promise<InventoryStats> {
  const qty = Prisma.sql`GREATEST(p."quantityInStock", 0)`;
  const [r] = await prisma.$queryRaw<StatsRow[]>`
    SELECT
      (COUNT(DISTINCT COALESCE(p."groupKey", p."id")) FILTER (WHERE p."isActive"))::int AS "products",
      (COUNT(*) FILTER (WHERE p."isActive" AND p."quantityInStock" > 0))::int AS "activeIn",
      (COUNT(*) FILTER (WHERE p."isActive" AND p."quantityInStock" <= 0))::int AS "activeOut",
      (COUNT(*) FILTER (WHERE NOT p."isActive"))::int AS "inactive",
      COALESCE(SUM(${qty}) FILTER (WHERE p."isActive"), 0)::float8 AS "qtyActive",
      COALESCE(SUM(${qty}) FILTER (WHERE NOT p."isActive"), 0)::float8 AS "qtyInactive",
      COALESCE(SUM(${qty} * p."costPrice") FILTER (WHERE p."isActive"), 0)::float8 AS "valueActive",
      COALESCE(SUM(${qty} * p."costPrice") FILTER (WHERE NOT p."isActive"), 0)::float8 AS "valueInactive",
      (COUNT(*) FILTER (WHERE p."quantityInStock" < 0))::int AS "negativeSkus",
      (COUNT(*) FILTER (WHERE p."quantityInStock" > 0 AND p."costPrice" <= 0))::int AS "noCostSkus",
      COALESCE(SUM(p."quantityInStock") FILTER (WHERE p."quantityInStock" > 0 AND p."costPrice" <= 0), 0)::float8 AS "noCostQuantity"
    FROM "Product" p
    WHERE p."userId" = ${ownerId}`;

  const bucket = (skus: number, quantity: number, value: number): InventoryStatsBucket =>
    opts.seesCost ? { skus, quantity, value } : { skus, quantity };
  return {
    products: r.products,
    inStock: bucket(r.activeIn, r.qtyActive, r.valueActive),
    outOfStock: bucket(r.activeOut, 0, 0),
    inactive: bucket(r.inactive, r.qtyInactive, r.valueInactive),
    total: bucket(r.activeIn + r.activeOut + r.inactive, r.qtyActive + r.qtyInactive, r.valueActive + r.valueInactive),
    negativeSkus: r.negativeSkus,
    ...(opts.seesCost ? { noCostSkus: r.noCostSkus, noCostQuantity: r.noCostQuantity } : {}),
    costPriceHidden: !opts.seesCost,
  };
}
