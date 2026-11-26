// ============================================================
// VIDEO ĐÓNG HÀNG — khớp mã trên tem ra ĐƠN (chỉ ĐỌC bảng Order)
//
// Luật (rào D5 của bản thiết kế): chỉ khớp ĐÚNG TUYỆT ĐỐI mã, trong phạm vi chủ shop.
// Ra HƠN MỘT đơn → coi như không khớp (video nằm ở chip "Chưa khớp đơn"), không đoán.
// Không khớp gần đúng, không hỏi sàn, không ghi gì vào Order.
//
// Video KHUI hàng hoàn: kho thường quét mã chiều đi in trên tem cũ (Order.trackingCode); không ra
// thì thử mã vận đơn chiều hoàn (Order.returnTrackingCode).
//
// Chỉ mục: "Order_trackingCode_idx" + "Order_returnTrackingCode_idx" (một phần, migration
// 20261125230000_order_tracking_code_idx) — trước đó câu dưới đi qua mọi đơn của các gian rồi mới lọc theo mã.
// ============================================================

import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { PackVideoKind } from "../../lib/pack-video-rules";

export interface OrderMatch {
  orderId: string;
  orderCode: string;
  channelId: string;
}

const MATCH_SELECT = { id: true, orderCode: true, channelId: true } satisfies Prisma.OrderSelect;

/**
 * LUẬT KHỚP — một chỗ cho mọi người gọi: đọc tối đa 2 dòng theo mã chiều đi; ra đúng MỘT thì lấy, ra hơn một thì coi
 * như không khớp; không ra dòng nào và đang quay KHUI thì thử mã chiều hoàn theo cùng luật. `find` quyết định đọc
 * những cột nào (bước tải lên chỉ cần 3 cột, màn quay cần thêm gian + tình trạng hoàn + món hàng).
 */
async function exactOne<T>(
  find: (where: Prisma.OrderWhereInput) => Promise<T[]>,
  ownerId: string,
  trackingCode: string,
  kind: PackVideoKind
): Promise<T | null> {
  const outbound = await find({ channel: { userId: ownerId }, trackingCode });
  if (outbound.length > 1) return null;
  if (outbound.length === 1 || kind !== "UNBOX") return outbound[0] ?? null;
  const inbound = await find({ channel: { userId: ownerId }, returnTrackingCode: trackingCode });
  return inbound.length === 1 ? inbound[0] : null;
}

export async function matchOrderByTrackingCode(
  ownerId: string,
  trackingCode: string,
  kind: PackVideoKind
): Promise<OrderMatch | null> {
  const row = await exactOne(
    (where) => prisma.order.findMany({ where, select: MATCH_SELECT, take: 2 }),
    ownerId,
    trackingCode,
    kind
  );
  return row ? { orderId: row.id, orderCode: row.orderCode, channelId: row.channelId } : null;
}

/** Cột của món hàng mà màn quay / hồ sơ đơn cần để vẽ dòng "tên · phân loại · số lượng · ảnh". */
export const TEM_ITEM_SELECT = {
  productName: true,
  quantity: true,
  imageUrl: true,
  channelSku: true,
  externalId: true,
  variantName: true,
  product: { select: { imageUrl: true, variantName: true } },
} satisfies Prisma.OrderItemSelect;

const TEM_SELECT = {
  id: true,
  orderCode: true,
  channelId: true,
  returnStatus: true,
  channel: { select: { channelName: true, shopName: true } },
  items: { select: TEM_ITEM_SELECT },
} satisfies Prisma.OrderSelect;

export type TemOrderRow = Prisma.OrderGetPayload<{ select: typeof TEM_SELECT }>;

/**
 * Bản cho MÀN QUAY (M2.5, 26/11/2026): cùng luật khớp, nhưng MỘT câu mang về luôn gian, tình trạng hoàn và món hàng —
 * trước đó là 4 câu nối nhau (khớp → gian → tình trạng hoàn → món hàng).
 */
export function matchOrderForTem(ownerId: string, trackingCode: string, kind: PackVideoKind): Promise<TemOrderRow | null> {
  return exactOne((where) => prisma.order.findMany({ where, select: TEM_SELECT, take: 2 }), ownerId, trackingCode, kind);
}
