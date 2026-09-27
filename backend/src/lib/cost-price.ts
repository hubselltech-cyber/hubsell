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
// ============================================================

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type Db = Prisma.TransactionClient;

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
            AND cp."channelSku" = oi."channelSku"
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
      AND oi."channelSku" = cp."channelSku"
      AND oi."costPriceAtSale" = 0`;
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
  return prisma.$transaction((tx) => applyCostPriceIn(tx, productIds, cost, ownerId));
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
  return prisma.$transaction((tx) =>
    applyChannelCostPriceIn(tx, channelProductIds, cost, ownerId)
  );
}

/**
 * TÍNH LẠI MỘT LẦN CHO CẢ SHOP: mọi dòng hàng đã bán còn giá vốn = 0 mà sản
 * phẩm gốc / SKU sàn tương ứng NAY đã có giá vốn → nhận giá vốn hiện tại.
 * Dành cho giá vốn đã nhập TRƯỚC khi có vá theo mã SKU sàn (28/09/2026), hoặc
 * khách nhập giá vốn ở nơi khác rồi muốn báo cáo cũ tính lại. Hai câu lệnh,
 * không lặp theo SKU — shop vài nghìn mã vẫn một lượt.
 */
export async function backfillOwnerCostPrices(ownerId: string): Promise<number> {
  // 1) Dòng đã mang productId → giá vốn sản phẩm gốc.
  const byProduct = await prisma.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = p."costPrice"
    FROM "Product" AS p
    WHERE oi."productId" = p."id"
      AND p."userId" = ${ownerId}
      AND p."costPrice" > 0
      AND oi."costPriceAtSale" = 0`;

  // 2) Dòng khớp (gian, mã SKU sàn): SKU đã nối kho lấy giá sản phẩm gốc, chưa
  //    nối lấy giá trên chính SKU sàn.
  const bySku = await prisma.$executeRaw`
    UPDATE "OrderItem" AS oi
    SET "costPriceAtSale" = COALESCE(NULLIF(p."costPrice", 0), cp."costPrice")
    FROM "Order" AS o
      JOIN "Channel" AS c ON c."id" = o."channelId"
      JOIN "ChannelProduct" AS cp ON cp."channelId" = o."channelId"
      LEFT JOIN "Product" AS p ON p."id" = cp."productId"
    WHERE oi."orderId" = o."id"
      AND c."userId" = ${ownerId}
      AND cp."channelSku" = oi."channelSku"
      AND oi."costPriceAtSale" = 0
      AND COALESCE(NULLIF(p."costPrice", 0), cp."costPrice", 0) > 0`;

  return byProduct + bySku;
}
