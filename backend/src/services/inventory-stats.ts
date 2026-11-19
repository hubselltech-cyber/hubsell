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
  /** Cách tính của shop: LEGACY = theo sổ tồn bán; ON_HAND = theo hàng trong kho (kho chuẩn quốc tế). */
  stockModel: "LEGACY" | "ON_HAND";
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

/**
 * `onHand` (shop ON_HAND, kho chuẩn quốc tế lát 3): số lượng và giá trị tính trên HÀNG TRONG KHO =
 * sổ + đang giữ cho đơn đã chốt (hàng đã có đơn chưa giao vẫn là tiền nằm trong kho); "hết hàng"
 * theo khả dụng (sổ − giữ tạm ≤ 0) như chip trên bảng — mã hết hàng vẫn có thể còn hàng trong kho
 * vì đang giữ cho đơn, nên nhóm "hết hàng" có số lượng và giá trị riêng. Hàng ở ô không bán CHƯA
 * cộng vào thống kê (chưa shop nào dùng ô không bán — số đo 12/11/2026).
 */
export async function loadInventoryStats(
  ownerId: string,
  opts: { seesCost: boolean; onHand?: boolean }
): Promise<InventoryStats> {
  const raw = opts.onHand
    ? Prisma.sql`(p."quantityInStock" + p."committedQuantity")`
    : Prisma.sql`p."quantityInStock"`;
  const qty = Prisma.sql`GREATEST(${raw}, 0)`;
  const out = opts.onHand
    ? Prisma.sql`p."quantityInStock" <= p."holdQuantity"`
    : Prisma.sql`p."quantityInStock" <= 0`;
  const [r] = await prisma.$queryRaw<(StatsRow & { qtyActiveOut: number; valueActiveOut: number })[]>`
    SELECT
      (COUNT(DISTINCT COALESCE(p."groupKey", p."id")) FILTER (WHERE p."isActive"))::int AS "products",
      (COUNT(*) FILTER (WHERE p."isActive" AND NOT (${out})))::int AS "activeIn",
      (COUNT(*) FILTER (WHERE p."isActive" AND ${out}))::int AS "activeOut",
      (COUNT(*) FILTER (WHERE NOT p."isActive"))::int AS "inactive",
      COALESCE(SUM(${qty}) FILTER (WHERE p."isActive" AND NOT (${out})), 0)::float8 AS "qtyActive",
      COALESCE(SUM(${qty}) FILTER (WHERE p."isActive" AND ${out}), 0)::float8 AS "qtyActiveOut",
      COALESCE(SUM(${qty}) FILTER (WHERE NOT p."isActive"), 0)::float8 AS "qtyInactive",
      COALESCE(SUM(${qty} * p."costPrice") FILTER (WHERE p."isActive" AND NOT (${out})), 0)::float8 AS "valueActive",
      COALESCE(SUM(${qty} * p."costPrice") FILTER (WHERE p."isActive" AND ${out}), 0)::float8 AS "valueActiveOut",
      COALESCE(SUM(${qty} * p."costPrice") FILTER (WHERE NOT p."isActive"), 0)::float8 AS "valueInactive",
      (COUNT(*) FILTER (WHERE ${raw} < 0))::int AS "negativeSkus",
      (COUNT(*) FILTER (WHERE ${raw} > 0 AND p."costPrice" <= 0))::int AS "noCostSkus",
      COALESCE(SUM(${raw}) FILTER (WHERE ${raw} > 0 AND p."costPrice" <= 0), 0)::float8 AS "noCostQuantity"
    FROM "Product" p
    WHERE p."userId" = ${ownerId}`;

  const bucket = (skus: number, quantity: number, value: number): InventoryStatsBucket =>
    opts.seesCost ? { skus, quantity, value } : { skus, quantity };
  return {
    products: r.products,
    inStock: bucket(r.activeIn, r.qtyActive, r.valueActive),
    outOfStock: bucket(r.activeOut, r.qtyActiveOut, r.valueActiveOut),
    inactive: bucket(r.inactive, r.qtyInactive, r.valueInactive),
    total: bucket(
      r.activeIn + r.activeOut + r.inactive,
      r.qtyActive + r.qtyActiveOut + r.qtyInactive,
      r.valueActive + r.valueActiveOut + r.valueInactive
    ),
    negativeSkus: r.negativeSkus,
    ...(opts.seesCost ? { noCostSkus: r.noCostSkus, noCostQuantity: r.noCostQuantity } : {}),
    costPriceHidden: !opts.seesCost,
    stockModel: opts.onHand ? "ON_HAND" : "LEGACY",
  };
}
