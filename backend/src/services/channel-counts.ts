// ============================================================
// Số đơn / số sản phẩm sàn theo gian — đếm THEO DANH SÁCH GIAN, đi chỉ mục.
//
// 28/10/2026 (sự cố Supabase cạn Disk IO): `include: { _count }` của Prisma trên
// danh sách gian sinh `LEFT JOIN (SELECT channelId, COUNT(*) FROM "Order" WHERE 1=1
// GROUP BY channelId)` — gom CẢ bảng Order (~580k) + ChannelProduct (~145k) rồi
// mới lọc theo chủ shop, 3–10 s/lượt, 10–17 nghìn khối đọc/lượt, trong khi banner
// mất ủy quyền gọi /api/channels ở MỌI trang mỗi 5 phút. Ở đây đếm bằng groupBy
// `WHERE channelId IN (...)` → Index Only Scan (gian 11k SKU / 2,5k đơn: 472 khối,
// 8 ms). Chỉ trang Kênh bán cần số này (`?withCounts=1`); các nơi khác không đếm.
// ============================================================

import { prisma } from "../lib/prisma";

export interface ChannelCounts {
  /** Tổng đơn đã đồng bộ về (mọi trạng thái). */
  orders: number;
  /** Tổng sản phẩm sàn (gồm cả chưa liên kết về kho gốc). */
  channelProducts: number;
  /** Sản phẩm sàn ĐÃ KHỚP mã SKU về kho gốc (productId != null). */
  matchedProducts: number;
}

const ZERO: ChannelCounts = { orders: 0, channelProducts: 0, matchedProducts: 0 };

/** Đếm cho đúng các gian được đưa vào; gian không có dòng nào → 0. */
export async function countByChannel(channelIds: string[]): Promise<Map<string, ChannelCounts>> {
  const out = new Map<string, ChannelCounts>(channelIds.map((id) => [id, { ...ZERO }]));
  if (channelIds.length === 0) return out;
  const where = { channelId: { in: channelIds } };
  const [orders, products, matched] = await Promise.all([
    prisma.order.groupBy({ by: ["channelId"], where, _count: { _all: true } }),
    prisma.channelProduct.groupBy({ by: ["channelId"], where, _count: { _all: true } }),
    prisma.channelProduct.groupBy({
      by: ["channelId"],
      where: { ...where, productId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  for (const r of orders) out.get(r.channelId)!.orders = r._count._all;
  for (const r of products) out.get(r.channelId)!.channelProducts = r._count._all;
  for (const r of matched) out.get(r.channelId)!.matchedProducts = r._count._all;
  return out;
}
