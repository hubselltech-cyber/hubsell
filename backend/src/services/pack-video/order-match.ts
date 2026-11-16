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
// ⚠️ Order chưa có chỉ mục riêng cho trackingCode (schema + migration tới 16/11/2026). Câu dưới đi
// qua các gian của chủ shop rồi lọc — cùng hạng với đường Quét đóng gói (routes/packing.ts). Phải
// EXPLAIN trên shop lớn trước khi mở cho khách; KHÔNG tự thêm chỉ mục vào Order khi chưa có số đo.
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

/** null = không đơn nào; "AMBIGUOUS" = hơn một đơn cùng mã. */
async function findExact(
  ownerId: string,
  where: Prisma.OrderWhereInput
): Promise<OrderMatch | "AMBIGUOUS" | null> {
  const rows = await prisma.order.findMany({
    where: { channel: { userId: ownerId }, ...where },
    select: MATCH_SELECT,
    take: 2,
  });
  if (rows.length === 0) return null;
  if (rows.length > 1) return "AMBIGUOUS";
  return { orderId: rows[0].id, orderCode: rows[0].orderCode, channelId: rows[0].channelId };
}

export async function matchOrderByTrackingCode(
  ownerId: string,
  trackingCode: string,
  kind: PackVideoKind
): Promise<OrderMatch | null> {
  const outbound = await findExact(ownerId, { trackingCode });
  if (outbound === "AMBIGUOUS") return null;
  if (outbound || kind !== "UNBOX") return outbound;
  const inbound = await findExact(ownerId, { returnTrackingCode: trackingCode });
  return inbound === "AMBIGUOUS" ? null : inbound;
}
