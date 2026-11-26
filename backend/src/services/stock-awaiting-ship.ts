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
//
// Tệp này còn giữ con số "ĐÃ CỘNG SỔ MÀ KHO CHƯA NHẬN KIỆN" (restockedNotBackYet) của shop cách mới
// còn để "cộng tồn khi sàn báo hủy" — cùng là số đọc từ đơn + nhật ký để giải thích cột Tồn kho.
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
 * Cửa sổ của dòng "chưa về kho": chỉ tính đơn được cộng lại sổ trong N ngày gần nhất. 30 là số TỰ
 * CHỌN (26/11/2026, chưa có căn cứ đo): kiện hoàn quá một tháng chưa về thì gần như không về nữa,
 * và con số cộng dồn vô hạn không giúp chủ shop quyết định gì. Đổi số này thì câu chữ trên màn
 * (frontend on-hand-notice.tsx đọc `days` từ API) tự đổi theo.
 */
export const NOT_BACK_WINDOW_DAYS = 30;

/**
 * Dòng nhật ký CỘNG LẠI của đơn hủy sau khi rời kho. PHẢI khớp từng chữ với vị từ của chỉ mục một
 * phần "InventoryLog_owner_restore_idx" (migration 20261126120000). `kind IS NULL` = dòng ghi trước
 * 20/11/2026 (chưa có cột kind) — sau 20/12/2026 không còn dòng nào như vậy trong cửa sổ 30 ngày.
 */
const RESTORE_LOG = Prisma.sql`il."orderId" IS NOT NULL AND il."changeQuantity" > 0 AND (il."kind" IS NULL OR il."kind" = 'RETURN')`;

/**
 * HÀNG ĐÃ CỘNG SỔ MÀ KHO CHƯA NHẬN KIỆN (kho chuẩn quốc tế lát 2, mục 5.2.1): đơn hủy / giao thất
 * bại sau khi rời kho của shop ở chế độ "cộng khi sàn báo hủy" — đã cộng lại sổ (stockRestoredAt)
 * nhưng còn "Chờ hàng về". Màn Tổng kho của shop ON_HAND dùng số này để nói rõ "Tồn kho đang tính
 * cả N sản phẩm chưa về kho".
 *
 * QUY MÔ (viết lại 26/11/2026, docs mục 20 lỗ 2): bản trước đi từ MỌI đơn "Chờ hàng về" của shop —
 * tập đó không bao giờ nhỏ lại ở shop không quét nhận hoàn (prod 26/11: 19.772 đơn, +400 / ngày;
 * shop 3.206 đơn tốn 2.518 khối để ra kết quả 0). Bản này đi từ các dòng CỘNG LẠI của chính shop
 * trong `days` ngày qua chỉ mục một phần theo chủ shop, rồi mới tra đơn theo khóa chính. Chi phí
 * theo số lần cộng lại của shop trong cửa sổ, không theo tuổi dữ liệu và không theo shop khác.
 */
export async function restockedNotBackYet(
  db: Pick<typeof prisma, "$queryRaw">,
  ownerId: string,
  days: number = NOT_BACK_WINDOW_DAYS
): Promise<{ units: number; orders: number; days: number }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.$queryRaw<{ units: number; orders: number }[]>`
    WITH r AS MATERIALIZED (
      SELECT il."orderId" AS oid, SUM(il."changeQuantity")::int AS qty
      FROM "InventoryLog" il
      WHERE il."ownerId" = ${ownerId} AND il."createdAt" >= ${since} AND ${RESTORE_LOG}
      GROUP BY 1
    )
    SELECT COALESCE(SUM(r.qty), 0)::int AS units, COUNT(*)::int AS orders
    FROM r JOIN "Order" o ON o."id" = r.oid
    WHERE o."returnStatus" = 'AWAITING' AND o."stockRestoredAt" IS NOT NULL`;
  return { units: rows[0]?.units ?? 0, orders: rows[0]?.orders ?? 0, days };
}

/**
 * Hàng chờ giao của một nhóm mã (một trang bảng Tổng kho của shop còn ở cách cũ). Mã không có đơn
 * chờ giao thì không có trong Map. Đi TỪ tập đơn chờ giao (nhỏ, có chỉ mục) sang nhật ký theo
 * orderId — CTE MATERIALIZED ép hướng này: đi ngược từ nhật ký của mã bán chạy là hàng chục nghìn
 * dòng mỗi mã. Shop cách mới (ON_HAND) KHÔNG gọi hàm này: "Đang giữ" đọc từ bộ đếm trên sản phẩm.
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
