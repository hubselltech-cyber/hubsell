// ============================================================
// ĐƠN CHỜ ĐỌC YÊU CẦU HOÀN (dùng chung TikTok / Shopee) — 02/10/2026
//
// Lượt quét yêu cầu hoàn theo thời gian chỉ nhìn 2 / 7 ngày gần nhất, trong
// khi bản kê / sao kê kéo cả lịch sử lúc nối gian. Đơn có tiền hoàn trên sao kê
// mà yêu cầu hoàn đã xong TRƯỚC ngày nối gian vì thế không có giải pháp hoàn,
// và Lãi/Lỗ (lib/pnl-formula.ts) xếp là khách giữ hàng, trừ nguyên giá vốn.
//
// Cách chữa: mỗi sàn có một lượt QUÉT BÙ hỏi sàn THEO MÃ ĐƠN cho đúng các đơn
// đó (tiktok/returns-sync.ts, shopee/returns-sync.ts), chạy trong tầng giờ của
// workers/order-auto-sync.ts ngay sau đối soát. File này giữ phần hai sàn dùng
// chung: tìm đơn chờ hỏi và đóng mốc đã hỏi.
//
// Mốc Order.returnLookupAt: null = Hubsell chưa từng đọc yêu cầu hoàn của sàn
// cho đơn này. Mỗi đơn chỉ hỏi MỘT lần — đóng mốc cả khi sàn không có yêu cầu
// nào (đơn đó giữ cách tính cũ). Lượt quét theo thời gian cũng đóng mốc cho đơn
// nó đọc được.
// ============================================================

import { prisma } from "../lib/prisma";

export interface PendingReturnLookup {
  id: string;
  orderCode: string;
}

/**
 * Đơn của một gian CHỜ hỏi sàn về yêu cầu hoàn, mới nhất trước: chưa đóng mốc,
 * không hủy (đơn hủy nằm trên trục riêng, Lãi/Lỗ không coi là hoàn), có tiền
 * hoàn trên sao kê và chưa có giải pháp hoàn.
 *
 * Câu đi theo chỉ mục một phần "Order_return_lookup_pending_idx" (migration
 * 20261002200100). Điều kiện viết THẲNG trong câu, không qua tham số: qua tham
 * số thì Postgres không chứng minh được câu nằm trong chỉ mục và dò cả đơn của
 * gian. Chỉ mục rộng hơn câu này một chút (gồm cả đơn đã ghi mốc kiện hoàn về
 * mà chưa đóng mốc) — không ảnh hưởng kết quả.
 */
export async function findOrdersPendingReturnLookup(
  channelId: string,
  limit: number
): Promise<PendingReturnLookup[]> {
  return prisma.$queryRaw<PendingReturnLookup[]>`
    SELECT "id", "orderCode"
    FROM "Order"
    WHERE "channelId" = ${channelId}
      AND "returnLookupAt" IS NULL
      AND "shippingStatus" <> 'CANCELLED'
      AND "refundedAmount" > 0
      AND "returnSolution" IS NULL
    ORDER BY "createdAt" DESC
    LIMIT ${limit}`;
}

/** Đóng mốc "đã hỏi sàn" cho các đơn — đơn đã có mốc thì giữ nguyên. */
export async function markReturnLookupDone(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await prisma.order.updateMany({
    where: { id: { in: orderIds }, returnLookupAt: null },
    data: { returnLookupAt: new Date() },
  });
}
