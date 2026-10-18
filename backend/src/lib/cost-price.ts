// ============================================================
// GHI GIÁ VỐN — hai đường ghi duy nhất của hệ thống (tách khỏi routes/finance.ts
// 17/09/2026 để tab "Mapping giá vốn" và hook tự điền khi đồng bộ dùng chung).
//
//   - Giá vốn RIÊNG CỦA GIAN → ChannelProduct.costPrice (applyChannelCostPrice)
//   - Giá vốn MẶC ĐỊNH ở kho  → Product.costPrice        (applyCostPrice)
//
// Cả hai đều VÁ LẠI các dòng hàng đã bán mà lúc bán chưa biết giá vốn.
//
// ★ 11/10/2026 — GIÁ VỐN THEO GIAN (anh Trung chốt, khách cần cùng mã SKU mỗi
//   gian một giá vốn: gian Mall có hóa đơn, mỗi gian một pháp nhân/kho...).
//   Kho chỉ quản SỐ LƯỢNG; giá vốn hiệu lực của một SKU sàn:
//     ChannelProduct.costPrice > 0  → giá riêng của gian
//     không thì Product.costPrice    → giá mặc định ở kho (SKU đã nối kho)
//   Trước đây SKU đã nối kho luôn lấy giá kho, ô của gian bị bỏ qua. Migration
//   20261011120000 xóa giá sót trên dòng gian đã nối (vốn không được dùng) nên
//   giá vốn hiệu lực của mọi khách KHÔNG đổi lúc chuyển. Một nguồn quy tắc:
//   effectiveSkuCost (JS) và OWN_COST_EXISTS / cột COALESCE trong SQL vá đơn.
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
//   - ★ 18/10/2026 (Lát 1c): dòng đơn có id lá (OrderItem.externalId) khớp CHỈ
//     bằng id; ba nhánh mã trên chỉ còn cho dòng chưa có id.
//   - XÓA BỘ ĐỆM Trợ lý quảng cáo sau khi vá (invalidateOwnerCostCaches) — bộ
//     đệm biên lãi 30 phút làm số đứng im dù đã vá xong.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { invalidateCostCaches } from "./cost-cache-invalidation";

type Db = Prisma.TransactionClient;

/**
 * Điều kiện khớp dòng đơn `oi` với SKU sàn `cp` (cùng gian, kiểm ở ngoài) — ID TRƯỚC, MÃ SAU
 * (Lát 1c, 18/10/2026, docs/MO-HINH-CAY-SAN-PHAM-SAN.md B3):
 *   · dòng CÓ id lá (OrderItem.externalId, ghi từ Lát 1a) khớp CHỈ bằng id — mã trùng của lá khác / sản phẩm khác không vá
 *     oan, mã đã đổi đuôi vẫn vá đúng;
 *   · dòng CHƯA có id (đơn trước 18/10, Lazada) khớp theo mã như trước, có dự phòng:
 *       1. mã SKU hiện tại của SKU sàn;
 *       2. TikTok/Lazada: sku_id — khoá đồng bộ đơn dùng khi seller_sku trống;
 *       3. Shopee: "SPE-" + externalId — khoá khi model_sku/item_sku trống.
 * Index: OrderItem(externalId) (migration 18/10) cho nhánh id; OrderItem(channelSku) (28/09) cho ba nhánh mã.
 */
const SKU_MATCH = Prisma.sql`(
  (oi."externalId" IS NOT NULL AND oi."externalId" = cp."externalId")
  OR (
    oi."externalId" IS NULL
    AND (
      oi."channelSku" = cp."channelSku"
      OR (cp."externalId" IS NOT NULL AND oi."channelSku" = split_part(cp."externalId", '-', 2))
      OR (cp."externalId" IS NOT NULL AND oi."channelSku" = 'SPE-' || cp."externalId")
    )
  )
)`;

/**
 * GIÁ VỐN HIỆU LỰC của một SKU sàn (xem đầu tệp): giá riêng của gian nếu > 0,
 * không thì giá mặc định của sản phẩm kho đã nối, không có thì 0. Đồng bộ đơn
 * 3 sàn chụp con số này vào OrderItem.costPriceAtSale.
 */
export function effectiveSkuCost(
  cp:
    | {
        costPrice: Prisma.Decimal | number | string | null;
        product?: { costPrice: Prisma.Decimal | number | string } | null;
      }
    | null
    | undefined
): number {
  if (!cp) return 0;
  const own = Number(cp.costPrice ?? 0);
  if (own > 0) return own;
  return Number(cp.product?.costPrice ?? 0);
}

/**
 * Dòng đơn `oi` của đơn `o` khớp một SKU sàn CÓ GIÁ RIÊNG của gian → giá mặc
 * định ở kho không được đè lên dòng đó (giá gian thắng).
 */
const OWN_COST_EXISTS = Prisma.sql`EXISTS (
  SELECT 1 FROM "ChannelProduct" AS cp
  WHERE cp."channelId" = o."channelId"
    AND cp."costPrice" > 0
    AND ${SKU_MATCH}
)`;

/**
 * Vá giá vốn cho dòng hàng đã bán của các SẢN PHẨM GỐC cho trước: dòng đang
 * mang productId của sản phẩm, HOẶC dòng khớp (gian, mã SKU sàn) với một SKU
 * sàn đã nối về sản phẩm đó (đơn về trước khi nối kho). Giá lấy từ DB tại thời
 * điểm gọi → gọi SAU khi đã ghi Product.costPrice trong cùng transaction.
 * Bỏ qua dòng của gian đang có giá RIÊNG cho SKU đó (giá gian thắng giá kho).
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
  // Khoanh đơn theo GIAN của chủ shop trước (Order(channelId) có index): không có
  // dòng này planner quét toàn bộ OrderItem×Order của MỌI khách rồi mới thử
  // EXISTS — prod 28/09 15:00 mất ~8s → transaction 5s hết hạn (P2028), khách
  // nhập giá vốn nhận "Lỗi máy chủ nội bộ" 13 lần.
  return db.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = p."costPrice"
    FROM "Product" AS p, "Order" AS o
    WHERE oi."orderId" = o."id"
      AND o."channelId" IN (SELECT ch."id" FROM "Channel" AS ch WHERE ch."userId" = ${ownerId})
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
      )
      AND NOT ${OWN_COST_EXISTS}`;
}

/**
 * Vá giá vốn cho dòng hàng đã bán của các SKU SÀN cho trước (đã nối kho hay
 * chưa), theo đúng (gian, mã SKU sàn). Giá lấy từ ChannelProduct.costPrice —
 * giá riêng của gian — trong DB.
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
      AND cp."costPrice" > 0
      AND o."channelId" = cp."channelId"
      AND ${SKU_MATCH}
      AND oi."costPriceAtSale" = 0`;
}

/**
 * SẮP THÁO SKU sàn khỏi sản phẩm kho (gỡ liên kết / xóa sản phẩm kho): gian nào
 * đang dùng giá MẶC ĐỊNH của kho thì chép giá đó xuống thành giá riêng của
 * gian, để giá vốn hiệu lực không tụt về 0 sau khi tháo. Gọi TRƯỚC khi đặt
 * productId = NULL. Gian đã có giá riêng thì giữ nguyên.
 */
export async function keepCostOnDetach(
  db: Db | typeof prisma,
  target: { channelProductIds: string[] } | { productIds: string[] },
  ownerId: string
): Promise<number> {
  const scope =
    "channelProductIds" in target
      ? Prisma.sql`cp."id" = ANY(${target.channelProductIds}::text[])`
      : Prisma.sql`p."id" = ANY(${target.productIds}::text[])`;
  return db.$executeRaw`
    UPDATE "ChannelProduct" AS cp
    SET "costPrice" = p."costPrice"
    FROM "Product" AS p
    WHERE cp."productId" = p."id"
      AND p."userId" = ${ownerId}
      AND p."costPrice" > 0
      AND COALESCE(cp."costPrice", 0) <= 0
      AND ${scope}`;
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
 * Đặt giá vốn MẶC ĐỊNH ở kho cho các sản phẩm gốc (gian nào chưa có giá riêng
 * thì theo giá này), ĐỒNG THỜI vá lại các dòng hàng đã bán mà
 * lúc bán chưa biết giá vốn (xem backfillOrderLinesByProducts).
 */
export async function applyCostPrice(
  productIds: string[],
  cost: number,
  ownerId: string
): Promise<{ products: number; backfilledOrderLines: number }> {
  const r = await prisma.$transaction(
    (tx) => applyCostPriceIn(tx, productIds, cost, ownerId),
    COST_TX_OPTIONS
  );
  await invalidateOwnerCostCaches(ownerId);
  return r;
}

/**
 * Transaction ghi giá vốn kèm vá đơn cũ: mặc định Prisma 5s là quá ngắn cho
 * shop nhiều đơn (prod 28/09: 8s → P2028). Vá đơn cũ là UPDATE một câu, không
 * lặp, nên 60s là trần rộng chứ không phải kỳ vọng.
 */
const COST_TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

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
 * Đặt giá vốn RIÊNG CỦA GIAN cho các SKU sàn (đã nối kho hay chưa — từ 11/10
 * giá gian thắng giá kho), đồng thời vá lại dòng hàng đã
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
  const r = await prisma.$transaction(
    (tx) => applyChannelCostPriceIn(tx, channelProductIds, cost, ownerId),
    COST_TX_OPTIONS
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
  // 1) Dòng đã mang productId → giá mặc định ở kho, TRỪ dòng của gian đang có
  //    giá riêng cho SKU đó (bước 2 lo, giá gian thắng).
  const byProduct = await prisma.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = p."costPrice"
    FROM "Product" AS p, "Order" AS o
    WHERE oi."productId" = p."id"
      AND oi."orderId" = o."id"
      AND p."userId" = ${ownerId}
      AND p."costPrice" > 0
      AND oi."costPriceAtSale" = 0
      AND NOT ${OWN_COST_EXISTS}`;

  // 2) Dòng khớp (gian, mã SKU sàn — có dự phòng sku_id / SPE-): giá riêng của
  //    gian nếu có, không thì giá mặc định của sản phẩm kho đã nối.
  const bySku = await prisma.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = COALESCE(NULLIF(cp."costPrice", 0), p."costPrice")
    FROM "Order" AS o
      JOIN "Channel" AS c ON c."id" = o."channelId"
      JOIN "ChannelProduct" AS cp ON cp."channelId" = o."channelId"
      LEFT JOIN "Product" AS p ON p."id" = cp."productId"
    WHERE oi."orderId" = o."id"
      AND c."userId" = ${ownerId}
      AND ${SKU_MATCH}
      AND oi."costPriceAtSale" = 0
      AND COALESCE(NULLIF(cp."costPrice", 0), p."costPrice", 0) > 0`;

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
