// ============================================================
// HÀNG "CHỜ GIAO" — đã trừ khỏi sổ kho cho đơn đã chốt, nhưng CHƯA giao cho đơn vị vận chuyển.
//
// Đơn sàn bị trừ thẳng Product.quantityInStock ngay khi sang Chờ lấy hàng (integrations/
// order-stock.ts → deductStockTx), nên hàng đã gói chờ ship vẫn nằm trong kho mà không còn trong
// "Tồn kho". Số này cho chủ shop thấy phần đó. CHỈ ĐỌC: không đổi Tồn kho, không đổi số đẩy sàn.
// Thiết kế + lý do không dùng bộ đếm: docs/TONG-KHO-DANG-GIU-CHO-DON.md.
//
// Tính từ ĐƠN chứ không giữ bộ đếm trên Product: trạng thái giao hàng đổi ở hơn chục chỗ (webhook
// 3 sàn, quét bù, hủy tay, mẻ chuẩn bị hàng…), sót một chỗ cộng / trừ là lệch vĩnh viễn.
// Số lượng lấy từ dòng TRỪ trong nhật ký kho của đơn (số đã trừ thật, có sẵn vị trí) — dòng đơn
// chưa nối SKU không có nhật ký nên tự không tính.
// ============================================================
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Đơn đã trừ kho, chưa giao ship, chưa hoàn kho. PHẢI khớp từng chữ với vị từ của chỉ mục một phần
 * "Order_stock_awaiting_ship_idx" (migration 20261111230000) — lệch là Postgres quét cả đơn của gian.
 * Sàn chuyển SHIPPING khi shipper quét lấy kiện = hàng rời kho.
 */
const AWAITING_ORDER = Prisma.sql`o."shippingStatus" IN ('PENDING','PROCESSED') AND o."stockRestoredAt" IS NULL AND o."stockDeductedAt" IS NOT NULL`;

/**
 * Chỉ gian đang nối và không ngủ đông: gian mất kết nối / ngủ đông không còn nhận cập nhật đơn
 * (webhook bị bỏ qua), đơn đứng im ở "chờ" dù hàng có thể đã đi → tính vào là số phình mãi.
 */
const LIVE_CHANNEL = Prisma.sql`c."status" = 'ACTIVE' AND c."hibernatedAt" IS NULL`;

export interface AwaitingShip {
  /** Số lượng đã trừ sổ, còn chờ giao. */
  quantity: number;
  /** Số đơn chứa mã này. */
  orders: number;
}

/**
 * Hàng chờ giao của một nhóm mã (một trang bảng Tổng kho). Mã không có đơn chờ giao thì không có
 * trong Map. Đi TỪ tập đơn chờ giao (nhỏ, có chỉ mục) sang nhật ký theo orderId — CTE MATERIALIZED
 * ép hướng này: đi ngược từ nhật ký của mã bán chạy là hàng chục nghìn dòng mỗi mã.
 */
export async function awaitingShipByProduct(
  db: Db,
  ownerId: string,
  productIds: string[]
): Promise<Map<string, AwaitingShip>> {
  const out = new Map<string, AwaitingShip>();
  if (productIds.length === 0) return out;
  const rows = await db.$queryRaw<{ productId: string; quantity: number; orders: number }[]>`
    WITH aw AS MATERIALIZED (
      SELECT o."id" FROM "Order" o
      JOIN "Channel" c ON c."id" = o."channelId" AND c."userId" = ${ownerId} AND ${LIVE_CHANNEL}
      WHERE ${AWAITING_ORDER}
    )
    SELECT il."productId", SUM(-il."changeQuantity")::int AS "quantity", COUNT(DISTINCT aw."id")::int AS "orders"
    FROM aw
    JOIN "InventoryLog" il ON il."orderId" = aw."id" AND il."changeQuantity" < 0
    WHERE il."productId" IN (${Prisma.join(productIds)})
    GROUP BY il."productId"`;
  for (const r of rows) out.set(r.productId, { quantity: r.quantity, orders: r.orders });
  return out;
}
