// ============================================================
// "LẤY GIÁ VỐN TỪ TỔNG KHO" ở trang Cấu hình Giá vốn (lát B, 27/11/2026 — docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 15.7).
//
// Anh Trung: "Trong phần cập nhật giá vốn này có đường nào để lấy giá vốn từ Sản phẩm Tổng kho thì sẽ tốt."
// SKU sàn ĐÃ NỐI kho mà gian đang đặt giá vốn riêng thì giá kho không tới được (giá gian thắng giá kho —
// lib/cost-price effectiveSkuCost). Nút này cho khách kéo giá kho sang: BỎ giá riêng của gian
// (ChannelProduct.costPrice → NULL) để SKU đó theo giá kho từ nay — không chép số (chép là thành hai bản).
//
// Hai nhóm, đo prod 27/11 (mục 15.2):
//   · giá riêng = giá kho (30.132 SKU): bỏ giá riêng không đổi số nào → luôn làm, không cần khách chọn;
//   · giá riêng ≠ giá kho (690 SKU / 17 chủ shop): hộp bày từng dòng số cũ → số mới, khách TÍCH dòng muốn đổi.
//     Dòng lệch từ BIG_GAP_RATIO lần không tích sẵn: ở nhóm lệch từ 20 lần trên prod, 28 / 29 lá có giá KHO dưới
//     5 % giá bán — tức giá kho mới là số đáng ngờ, kéo mù sang sẽ làm giá vốn tụt.
//
// Chỉ đụng SKU sàn đã nối có giá kho > 0. Đơn cũ đã có giá vốn không đổi (ảnh chụp); đơn mới chụp giá kho.
// ============================================================

import { ChannelName, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { invalidateOwnerCostCaches } from "./cost-price";

/** Số dòng lệch giá tối đa bày trong một lần mở hộp (và tối đa nhận trong một lần áp). Còn nữa thì khách bấm lại. */
export const FROM_WAREHOUSE_ROW_LIMIT = 500;
/**
 * Giá riêng và giá kho lệch nhau từ mức này (lần) thì dòng không tích sẵn. Mốc do em tự chọn, căn cứ số đo prod
 * 27/11: 52 / 690 SKU lệch từ 2 lần, và phần tiền dịch chuyển nằm gần hết ở nhóm này (mục 15.2).
 */
export const BIG_GAP_RATIO = 2;

export interface WarehouseCostScope {
  ownerId: string;
  /** null = mọi sàn. */
  channelName: ChannelName | null;
  /** null = mọi gian (của sàn đang chọn). */
  channelId: string | null;
}

export interface FromWarehouseRow {
  id: string;
  shopName: string;
  channelName: ChannelName;
  productName: string;
  variantName: string | null;
  channelSku: string;
  /** Mã SKU của sản phẩm kho đã nối. */
  stockSku: string;
  ownCost: number;
  warehouseCost: number;
  /** Lệch từ BIG_GAP_RATIO lần — hộp không tích sẵn. */
  bigGap: boolean;
}

export interface FromWarehousePreview {
  /** SKU sàn có giá riêng đúng bằng giá kho — bỏ giá riêng không đổi số nào. */
  same: number;
  /** SKU sàn có giá riêng khác giá kho (cả những dòng chưa bày vì vượt rowLimit). */
  differ: number;
  rows: FromWarehouseRow[];
  rowLimit: number;
  /**
   * SKU sàn ĐANG BÁN chưa có giá vốn mà nút này KHÔNG giúp được — hộp phải nói rõ, kẻo khách có cả nghìn SKU
   * chưa có giá bấm "Lấy giá vốn từ Tổng kho" rồi tưởng đã xong (anh Trung 27/11: "ví dụ Sản phẩm sàn có khoảng
   * 1000 sản phẩm chưa nhập giá vốn thì thanh popup hiển thị ra sao"):
   *   · chưa nối kho → không có sản phẩm kho nào để lấy giá, phải nối ở trang Sản phẩm trên sàn;
   *   · đã nối nhưng sản phẩm kho cũng chưa có giá → phải nhập giá vốn ở Tổng kho.
   */
  unlinkedNoCost: number;
  linkedNoWarehouseCost: number;
}

/** Phạm vi gian đang lọc (bí danh c): của chủ shop, đúng sàn / gian nếu có chọn. */
function channelScopeSql(scope: WarehouseCostScope): Prisma.Sql {
  return Prisma.sql`
    c."userId" = ${scope.ownerId}
    ${scope.channelName ? Prisma.sql`AND c."channelName" = ${scope.channelName}::"ChannelName"` : Prisma.empty}
    ${scope.channelId ? Prisma.sql`AND c."id" = ${scope.channelId}` : Prisma.empty}`;
}

/** Điều kiện chung: SKU sàn của chủ shop, đã nối kho, gian có giá riêng, kho có giá (bí danh cp, c, p). */
function scopeSql(scope: WarehouseCostScope): Prisma.Sql {
  return Prisma.sql`
    c."id" = cp."channelId"
    AND p."id" = cp."productId"
    AND ${channelScopeSql(scope)}
    AND p."userId" = ${scope.ownerId}
    AND cp."costPrice" > 0
    AND p."costPrice" > 0`;
}

export async function previewCostFromWarehouse(scope: WarehouseCostScope): Promise<FromWarehousePreview> {
  const where = scopeSql(scope);
  const [counts] = await prisma.$queryRaw<{ same: bigint; differ: bigint }[]>`
    SELECT
      count(*) FILTER (WHERE cp."costPrice" = p."costPrice") AS same,
      count(*) FILTER (WHERE cp."costPrice" <> p."costPrice") AS differ
    FROM "ChannelProduct" AS cp, "Channel" AS c, "Product" AS p
    WHERE ${where}`;
  const differ = Number(counts?.differ ?? 0);
  // SKU sàn đang bán còn thiếu giá vốn mà nút không giúp được (xem FromWarehousePreview). Một lượt đếm theo gian.
  const [stuck] = await prisma.$queryRaw<{ unlinked: bigint; nokho: bigint }[]>`
    SELECT
      count(*) FILTER (WHERE cp."productId" IS NULL) AS unlinked,
      count(*) FILTER (WHERE cp."productId" IS NOT NULL AND p."costPrice" = 0) AS nokho
    FROM "ChannelProduct" AS cp
    JOIN "Channel" AS c ON c."id" = cp."channelId"
    LEFT JOIN "Product" AS p ON p."id" = cp."productId"
    WHERE ${channelScopeSql(scope)}
      AND c."channelName" <> 'OFFLINE'
      AND cp."status" = 'ACTIVE'
      AND COALESCE(cp."costPrice", 0) = 0`;
  const rows =
    differ === 0
      ? []
      : await prisma.$queryRaw<
          {
            id: string;
            shopName: string;
            channelName: ChannelName;
            productName: string;
            variantName: string | null;
            channelSku: string;
            stockSku: string;
            ownCost: Prisma.Decimal;
            warehouseCost: Prisma.Decimal;
          }[]
        >`
          SELECT cp."id", c."shopName", c."channelName", cp."productName", cp."variantName", cp."channelSku",
                 p."skuCode" AS "stockSku", cp."costPrice" AS "ownCost", p."costPrice" AS "warehouseCost"
          FROM "ChannelProduct" AS cp, "Channel" AS c, "Product" AS p
          WHERE ${where} AND cp."costPrice" <> p."costPrice"
          -- Lệch nhiều lên đầu: đó là những dòng khách cần nhìn kỹ nhất.
          ORDER BY GREATEST(cp."costPrice" / p."costPrice", p."costPrice" / cp."costPrice") DESC, cp."id"
          LIMIT ${FROM_WAREHOUSE_ROW_LIMIT}`;
  return {
    same: Number(counts?.same ?? 0),
    differ,
    rowLimit: FROM_WAREHOUSE_ROW_LIMIT,
    unlinkedNoCost: Number(stuck?.unlinked ?? 0),
    linkedNoWarehouseCost: Number(stuck?.nokho ?? 0),
    rows: rows.map((r) => {
      const ownCost = Number(r.ownCost);
      const warehouseCost = Number(r.warehouseCost);
      return {
        id: r.id,
        shopName: r.shopName,
        channelName: r.channelName,
        productName: r.productName,
        variantName: r.variantName,
        channelSku: r.channelSku,
        stockSku: r.stockSku,
        ownCost,
        warehouseCost,
        bigGap: ownCost >= BIG_GAP_RATIO * warehouseCost || warehouseCost >= BIG_GAP_RATIO * ownCost,
      };
    }),
  };
}

/**
 * Bỏ giá riêng của gian cho: (1) mọi SKU sàn trong phạm vi đang có giá riêng BẰNG giá kho, (2) các SKU sàn lệch giá
 * mà khách đã tích (`applyIds`). Một câu UPDATE. Máy chủ tự kiểm lại phạm vi + điều kiện, không tin danh sách gửi lên.
 */
export async function applyCostFromWarehouse(
  scope: WarehouseCostScope,
  applyIds: string[]
): Promise<{ followedSame: number; followedDiffer: number }> {
  const picked = [...new Set(applyIds)].slice(0, FROM_WAREHOUSE_ROW_LIMIT);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "ChannelProduct" AS cp
    SET "costPrice" = NULL, "costPriceInheritedAt" = NULL
    FROM "Channel" AS c, "Product" AS p
    WHERE ${scopeSql(scope)}
      AND (cp."costPrice" = p."costPrice" OR cp."id" = ANY(${picked}::text[]))
    RETURNING cp."id"`;
  if (rows.length > 0) await invalidateOwnerCostCaches(scope.ownerId);
  const pickedSet = new Set(picked);
  const followedDiffer = rows.filter((r) => pickedSet.has(r.id)).length;
  console.log(
    `[cost-from-warehouse] chủ shop ${scope.ownerId} (${scope.channelName ?? "mọi sàn"}, gian ${scope.channelId ?? "tất cả"}): ` +
      `${rows.length - followedDiffer} SKU sàn bằng giá kho + ${followedDiffer} SKU sàn lệch giá → theo giá Tổng kho`
  );
  return { followedSame: rows.length - followedDiffer, followedDiffer };
}
