// ============================================================
// ĐỒNG BỘ LÔ: CHỈ GHI KHI KHÁC (12/10/2026 — docs/BANG-THONG-WORKER-CO-VIEC-THI-GOI.md)
//
// Đo pg_stat_statements prod 30/09→12/10: tầng nhanh của order-auto-sync
// (10 phút/gian) xử lý lại mọi đơn trong cửa sổ 2 ngày, mỗi đơn 5 lượt đi-về
// database (BEGIN, SELECT, UPDATE, COUNT ảnh, COMMIT) dù đơn không đổi gì —
// ~2,9 triệu câu/ngày, và `updated` đếm mọi đơn đọc lại nên gian không bao giờ
// giãn nhịp lên 60'. Ba service đồng bộ đơn dùng chung các hàm nhỏ ở đây:
//   · đọc đơn đã có theo LÔ (một findMany cho ≤50 mã đơn) thay vì findUnique
//     từng đơn;
//   · lập "bản ghi dự kiến" chỉ gồm cột KHÁC giá trị đang có; rỗng = không mở
//     giao dịch, không UPDATE, không đếm `updated`;
//   · điền bù ảnh dòng hàng chỉ cho đơn tạo trước ngày bắt đầu lưu ảnh lúc tạo.
// Đường lui: SYNC_WRITE_ALWAYS=1 → ghi lại mọi đơn như trước (dùng khi nghi so
// thiếu cột), không cần deploy mã.
// ============================================================

import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Từ 08/09/2026 ảnh dòng hàng được lưu ngay lúc tạo đơn (order-item-images.ts);
 * đơn tạo sau mốc này không cần COUNT "còn dòng thiếu ảnh" ở mỗi lượt quét.
 * Đơn cũ hơn vẫn được điền bù khi lọt cửa sổ quét (sàn bổ sung ảnh muộn).
 */
export const ORDER_ITEM_IMAGE_SINCE = new Date("2026-09-08T00:00:00+07:00");

export function needsItemImageBackfill(createdAt: Date): boolean {
  return createdAt.getTime() < ORDER_ITEM_IMAGE_SINCE.getTime();
}

/** Đường lui: ghi lại mọi đơn như trước 12/10/2026. */
export function syncWriteAlways(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SYNC_WRITE_ALWAYS === "1";
}

/** Decimal/number/null của Prisma so với số từ sàn — khác là cần ghi. */
export function decimalDiffers(stored: Prisma.Decimal | number | string | null | undefined, incoming: number): boolean {
  if (stored === null || stored === undefined) return true;
  return Number(stored) !== incoming;
}

/** Bản ghi dự kiến có cột nào không (rỗng = đơn không đổi). */
export function hasPlannedChanges(data: Record<string, unknown>): boolean {
  return Object.keys(data).length > 0;
}

/**
 * Đọc các đơn đã có của một lô mã đơn trong MỘT câu, trả map theo orderCode.
 * `select` do từng sàn khai (đúng các cột mà bản ghi dự kiến cần so, kèm orderCode).
 */
export async function fetchExistingOrdersByCode<S extends Prisma.OrderSelect & { orderCode: true }>(
  db: Prisma.TransactionClient | PrismaClient,
  channelId: string,
  orderCodes: string[],
  select: S
): Promise<Map<string, Prisma.OrderGetPayload<{ select: S }>>> {
  const map = new Map<string, Prisma.OrderGetPayload<{ select: S }>>();
  if (orderCodes.length === 0) return map;
  const rows = await db.order.findMany({ where: { channelId, orderCode: { in: orderCodes } }, select });
  for (const row of rows) {
    map.set((row as { orderCode: string }).orderCode, row);
  }
  return map;
}

/** Kết quả một đơn qua upsert — `changed` = có ghi cột nào của Order (để đếm `updated`). */
export interface OrderUpsertOutcome {
  created: boolean;
  /** true khi có UPDATE Order (đơn đã có mà khác) hoặc tạo mới. */
  changed: boolean;
  itemsCreated: number;
}
