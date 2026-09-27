// ============================================================
// GHI GIÁ VỐN — hai đường ghi duy nhất của hệ thống (tách khỏi routes/finance.ts
// 17/09/2026 để tab "Mapping giá vốn" và hook tự điền khi đồng bộ dùng chung).
//
//   - SKU ĐÃ nối kho  → Product.costPrice        (applyCostPrice)
//   - SKU CHƯA nối kho → ChannelProduct.costPrice (applyChannelCostPrice)
//
// Cả hai đều VÁ LẠI các dòng hàng đã bán mà lúc bán chưa biết giá vốn.
//
// ★ 28/09/2026 — VÁ THEO CẢ (GIAN, MÃ SKU SÀN), không chỉ theo productId.
//   Khách phản ánh: nhập giá vốn xong mà báo cáo dòng tiền 30 ngày và ROAS hòa
//   vốn của Trợ lý quảng cáo vẫn "chưa có giá vốn". Nguyên nhân: đơn đồng bộ về
//   TRƯỚC khi SKU sàn được nối kho thì OrderItem.productId = NULL (liên kết sau
//   không sửa lại đơn cũ — cố ý, vì đặt productId hồi tố sẽ làm luồng hoàn hàng
//   cộng kho ảo). Vá chỉ theo productId nên các dòng đó mãi mãi = 0. Nay mọi
//   đường vá đều khớp thêm theo (channelId, channelSku) của SKU sàn thuộc sản
//   phẩm — đúng khoá mà đồng bộ đơn dùng để tra giá vốn lúc tạo dòng.
//   Kèm backfillOwnerCostPrices: tính lại MỘT LẦN cho cả shop (nút "Áp giá vốn
//   cho đơn cũ" trên trang Cấu hình Giá vốn) cho các giá vốn đã nhập trước đó.
//
// ★ 28/09 (đợt 2, anh Trung: BLT001 nhập giá mà đơn cũ không đổi):
//   - KHỚP MÃ CÓ DỰ PHÒNG (SKU_MATCH): ngoài mã SKU hiện tại, khớp cả khoá mà
//     đồng bộ đơn dùng KHI SELLER CHƯA ĐẶT MÃ — TikTok/Lazada dùng sku_id
//     (= phần sau dấu "-" của externalId), Shopee dùng "SPE-item-model"
//     (= "SPE-" + externalId). Seller đặt mã SKU sau khi đã có đơn thì đơn cũ
//     mang khoá cũ, không có dự phòng là không bao giờ vá được.
//   - KHÔNG GIỚI HẠN NGÀY: mọi đơn từ trước tới nay.
//   - XÓA BỘ ĐỆM Trợ lý quảng cáo sau khi vá (invalidateOwnerCostCaches) — bộ
//     đệm biên lãi 30 phút làm số đứng im dù đã vá xong.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { invalidateCostCaches } from "./cost-cache-invalidation";

type Db = Prisma.TransactionClient;

/**
 * Điều kiện khớp dòng đơn `oi` với SKU sàn `cp` (cùng gian, kiểm ở ngoài):
 *   1. mã SKU hiện tại của SKU sàn;
 *   2. TikTok/Lazada: sku_id — khoá đồng bộ đơn dùng khi seller_sku trống;
 *   3. Shopee: "SPE-" + externalId — khoá khi model_sku/item_sku trống.
 * Cần index OrderItem(channelSku) (migration 28/09) để ba nhánh đều đi index.
 */
const SKU_MATCH = Prisma.sql`(
  oi."channelSku" = cp."channelSku"
  OR (cp."externalId" IS NOT NULL AND oi."channelSku" = split_part(cp."externalId", '-', 2))
  OR (cp."externalId" IS NOT NULL AND oi."channelSku" = 'SPE-' || cp."externalId")
)`;

/**
 * Vá giá vốn cho dòng hàng đã bán của các SẢN PHẨM GỐC cho trước: dòng đang
 * mang productId của sản phẩm, HOẶC dòng khớp (gian, mã SKU sàn) với một SKU
 * sàn đã nối về sản phẩm đó (đơn về trước khi nối kho). Giá lấy từ DB tại thời
 * điểm gọi → gọi SAU khi đã ghi Product.costPrice trong cùng transaction.
 *
 * OrderItem.costPriceAtSale là ảnh chụp giá vốn tại thời điểm bán — cố ý đóng
 * băng để giá nhập đổi về sau không làm sai lệch báo cáo cũ. Nhưng giá trị 0
 * KHÔNG phải một ảnh chụp hợp lệ, nó nghĩa là "lúc đó chưa ai nhập giá vốn".
 * Nên chỉ vá đúng những dòng đang là 0. Dòng đã có số thật thì tuyệt đối không
 * đụng vào — đó mới là lịch sử cần giữ.
 *
 * KHÔNG đặt lại OrderItem.productId: dòng không mang productId nghĩa là lúc bán
 * chưa trừ kho; gắn hồi tố sẽ làm "Nhập kho hàng hoàn" cộng tồn cho hàng chưa
 * từng trừ.
 */
export async function backfillOrderLinesByProducts(
  db: Db,
  productIds: string[],
  ownerId: string
): Promise<number> {
  if (productIds.length === 0) return 0;
  return db.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = p."costPrice"
    FROM "Product" AS p, "Order" AS o
    WHERE oi."orderId" = o."id"
      AND p."id" = ANY(${productIds}::text[])
      AND p."userId" = ${ownerId}
      AND p."costPrice" > 0
      AND oi."costPriceAtSale" = 0
      AND (
        oi."productId" = p."id"
        OR EXISTS (
          SELECT 1 FROM "ChannelProduct" AS cp
          WHERE cp."productId" = p."id"
            AND cp."channelId" = o."channelId"
            AND ${SKU_MATCH}
        )
      )`;
}

/**
 * Vá giá vốn cho dòng hàng đã bán của các SKU SÀN CHƯA NỐI KHO cho trước, theo
 * đúng (gian, mã SKU sàn). Giá lấy từ ChannelProduct.costPrice trong DB.
 * SKU đã nối kho thì bỏ qua — giá vốn của nó theo sản phẩm gốc (hàm trên).
 */
export async function backfillOrderLinesByChannelProducts(
  db: Db,
  channelProductIds: string[]
): Promise<number> {
  if (channelProductIds.length === 0) return 0;
  return db.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = cp."costPrice"
    FROM "ChannelProduct" AS cp, "Order" AS o
    WHERE oi."orderId" = o."id"
      AND cp."id" = ANY(${channelProductIds}::text[])
      AND cp."productId" IS NULL
      AND cp."costPrice" > 0
      AND o."channelId" = cp."channelId"
      AND ${SKU_MATCH}
      AND oi."costPriceAtSale" = 0`;
}

/**
 * Xóa bộ đệm Trợ lý quảng cáo (biên lãi 30', hòa vốn TikTok 45") của mọi gian
 * thuộc chủ shop — gọi SAU khi ghi giá vốn / vá đơn cũ xong, ngoài transaction.
 */
export async function invalidateOwnerCostCaches(ownerId: string): Promise<void> {
  try {
    const channels = await prisma.channel.findMany({
      where: { userId: ownerId },
      select: { id: true },
    });
    invalidateCostCaches(channels.map((c) => c.id));
  } catch {
    // chỉ là bộ đệm — không để lỗi ở đây làm hỏng lượt ghi giá vốn
  }
}

/** Lõi của applyCostPrice — chạy trong transaction do bên gọi mở. */
export async function applyCostPriceIn(
  db: Db,
  productIds: string[],
  cost: number,
  ownerId: string
): Promise<{ products: number; backfilledOrderLines: number }> {
  const updated = await db.product.updateMany({
    where: { id: { in: productIds }, userId: ownerId },
    data: { costPrice: cost },
  });
  const backfilled = cost > 0 ? await backfillOrderLinesByProducts(db, productIds, ownerId) : 0;
  return { products: updated.count, backfilledOrderLines: backfilled };
}

/**
 * Đặt giá vốn cho các sản phẩm gốc, ĐỒNG THỜI vá lại các dòng hàng đã bán mà
 * lúc bán chưa biết giá vốn (xem backfillOrderLinesByProducts).
 */
export async function applyCostPrice(
  productIds: string[],
  cost: number,
  ownerId: string
): Promise<{ products: number; backfilledOrderLines: number }> {
  const r = await prisma.$transaction((tx) => applyCostPriceIn(tx, productIds, cost, ownerId));
  await invalidateOwnerCostCaches(ownerId);
  return r;
}

/** Lõi của applyChannelCostPrice — chạy trong transaction do bên gọi mở. */
export async function applyChannelCostPriceIn(
  db: Db,
  channelProductIds: string[],
  cost: number,
  ownerId: string
): Promise<{
  updated: number;
  backfilledOrderLines: number;
  sample: { productName: string } | null;
}> {
  const cps = await db.channelProduct.findMany({
    where: {
      id: { in: channelProductIds },
      productId: null,
      channel: { userId: ownerId },
    },
    select: { id: true, productName: true },
  });
  if (cps.length === 0) return { updated: 0, backfilledOrderLines: 0, sample: null };

  const ids = cps.map((c) => c.id);
  await db.channelProduct.updateMany({
    where: { id: { in: ids } },
    data: { costPrice: cost },
  });
  const backfilled = cost > 0 ? await backfillOrderLinesByChannelProducts(db, ids) : 0;
  return {
    updated: cps.length,
    backfilledOrderLines: backfilled,
    sample: { productName: cps[0].productName },
  };
}

/**
 * Đặt giá vốn cho các SKU SÀN CHƯA LIÊN KẾT KHO, đồng thời vá lại dòng hàng đã
 * bán của đúng (gian, mã SKU) đó mà lúc bán chưa có giá vốn (snapshot = 0).
 *
 * Song song với applyCostPrice của sản phẩm gốc: cùng nguyên tắc "0 không phải
 * ảnh chụp hợp lệ" — chỉ vá dòng đang 0, dòng có số thật là lịch sử, không đụng.
 */
export async function applyChannelCostPrice(
  channelProductIds: string[],
  cost: number,
  ownerId: string
): Promise<{
  updated: number;
  backfilledOrderLines: number;
  sample: { productName: string } | null;
}> {
  const r = await prisma.$transaction((tx) =>
    applyChannelCostPriceIn(tx, channelProductIds, cost, ownerId)
  );
  await invalidateOwnerCostCaches(ownerId);
  return r;
}

export interface OwnerCostBackfillResult {
  /** Số dòng hàng đã bán vừa nhận giá vốn. */
  backfilledOrderLines: number;
  /** Số dòng vẫn = 0 sau lượt này (mọi đơn, không giới hạn ngày). */
  remainingZeroLines: number;
  /**
   * Trong số còn lại: dòng KHÔNG khớp SKU sàn nào của gian (mã trên đơn khác
   * mọi mã đang có — SKU đã đổi mã / bị xóa hẳn khỏi sàn trước khi đồng bộ
   * danh mục). Phần còn lại = SKU khớp nhưng chưa nhập giá vốn.
   */
  unmatchedZeroLines: number;
}

/**
 * TÍNH LẠI MỘT LẦN CHO CẢ SHOP: mọi dòng hàng đã bán còn giá vốn = 0 mà sản
 * phẩm gốc / SKU sàn tương ứng NAY đã có giá vốn → nhận giá vốn hiện tại.
 * Dành cho giá vốn đã nhập TRƯỚC khi có vá theo mã SKU sàn (28/09/2026), hoặc
 * khách nhập giá vốn ở nơi khác rồi muốn báo cáo cũ tính lại. Hai câu lệnh,
 * không lặp theo SKU — shop vài nghìn mã vẫn một lượt. KHÔNG giới hạn ngày.
 * Trả kèm chẩn đoán để giao diện nói rõ vì sao còn dòng chưa có giá vốn.
 */
export async function backfillOwnerCostPrices(ownerId: string): Promise<OwnerCostBackfillResult> {
  // 1) Dòng đã mang productId → giá vốn sản phẩm gốc.
  const byProduct = await prisma.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = p."costPrice"
    FROM "Product" AS p
    WHERE oi."productId" = p."id"
      AND p."userId" = ${ownerId}
      AND p."costPrice" > 0
      AND oi."costPriceAtSale" = 0`;

  // 2) Dòng khớp (gian, mã SKU sàn — có dự phòng sku_id / SPE-): SKU đã nối kho
  //    lấy giá sản phẩm gốc, chưa nối lấy giá trên chính SKU sàn.
  const bySku = await prisma.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = COALESCE(NULLIF(p."costPrice", 0), cp."costPrice")
    FROM "Order" AS o
      JOIN "Channel" AS c ON c."id" = o."channelId"
      JOIN "ChannelProduct" AS cp ON cp."channelId" = o."channelId"
      LEFT JOIN "Product" AS p ON p."id" = cp."productId"
    WHERE oi."orderId" = o."id"
      AND c."userId" = ${ownerId}
      AND ${SKU_MATCH}
      AND oi."costPriceAtSale" = 0
      AND COALESCE(NULLIF(p."costPrice", 0), cp."costPrice", 0) > 0`;

  await invalidateOwnerCostCaches(ownerId);

  // 3) Chẩn đoán phần còn lại.
  const [diag] = await prisma.$queryRaw<{ remaining: bigint; unmatched: bigint }[]>`
    SELECT
      COUNT(*)::bigint AS remaining,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM "ChannelProduct" AS cp
          WHERE cp."channelId" = o."channelId" AND ${SKU_MATCH}
        )
      )::bigint AS unmatched
    FROM "OrderItem" AS oi
    JOIN "Order" AS o ON o."id" = oi."orderId"
    JOIN "Channel" AS c ON c."id" = o."channelId"
    WHERE c."userId" = ${ownerId}
      AND oi."costPriceAtSale" = 0`;

  return {
    backfilledOrderLines: byProduct + bySku,
    remainingZeroLines: Number(diag?.remaining ?? 0),
    unmatchedZeroLines: Number(diag?.unmatched ?? 0),
  };
}
