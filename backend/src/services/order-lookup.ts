// ============================================================
// TRA ĐƠN THEO MÃ QUÉT — phần đọc database của GET /api/orders/lookup (26/11/2026)
//
// Vì sao có tệp này (docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 20 lỗ 4 + mục 21.1):
//   Câu cũ gộp ba mã (vận đơn chiều đi, vận đơn chiều hoàn, mã đơn) vào một `OR` và lọc gian qua
//   quan hệ `channel: { userId }` → Postgres đọc MỌI đơn của gian rồi mới so mã (shop 136.724 đơn
//   = đọc cả 136.724 đơn mỗi lần quét trượt); khớp lỏng `contains` không có chỉ mục nào.
//
// Cách mới:
//   · khớp chính xác = BA câu riêng, mỗi câu đi đúng một chỉ mục, lọc gian bằng danh sách mã gian
//     (route gọi lần lượt, câu nào trúng thì dừng);
//   · khớp lỏng chỉ đọc đơn GẦN ĐÂY của từng gian qua chỉ mục (channelId, createdAt) — LATERAL để
//     kế hoạch chạy không phụ thuộc thống kê, cùng khuôn services/order-list.ts. Chi phí có trần:
//     đo prod 26/11 khoảng 0,93 trang đệm mỗi đơn đọc.
// ============================================================
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Khớp lỏng chỉ tìm trong đơn tạo trong chừng này ngày. 60 là số TỰ CHỌN: kiện hoàn về kho trong
 * khoảng hạn trả hàng của sàn + hai chiều vận chuyển, ước dưới 45 ngày, lấy dư.
 */
export const LOOKUP_LOOSE_DAYS = 60;
/** Trần số đơn mới nhất của MỖI gian mà khớp lỏng được đọc — trần chi phí, số tự chọn. */
export const LOOKUP_LOOSE_ROWS = 20_000;

/** Gian trong phạm vi tra của người gọi (cả gian đã ngắt: đơn cũ vẫn tra được). */
export async function lookupChannelIds(ownerId: string, allowed: string[] | null): Promise<string[]> {
  const rows = await prisma.channel.findMany({
    where: { userId: ownerId, ...(allowed ? { id: { in: allowed } } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Ba điều kiện khớp CHÍNH XÁC theo thứ tự thử: mã vận đơn chiều đi → mã đơn → mã vận đơn chiều
 * hoàn. Mỗi điều kiện ghép với `channelId IN (…)` đi đúng một chỉ mục ("Order_trackingCode_idx",
 * khóa duy nhất (channelId, orderCode), "Order_returnTrackingCode_idx").
 */
export function exactLookupWheres(code: string): Prisma.OrderWhereInput[] {
  return [{ trackingCode: code }, { orderCode: code }, { returnTrackingCode: code }];
}

/**
 * Tối đa 5 đơn có mã vận đơn (hai chiều) hoặc mã đơn CHỨA chuỗi quét được, không phân biệt hoa
 * thường. Ký tự % _ \ trong mã quét được thoát (Prisma `contains` không thoát).
 */
export async function looseLookupIds(
  channelIds: string[],
  code: string,
  opts: { days?: number; rows?: number } = {}
): Promise<string[]> {
  if (channelIds.length === 0) return [];
  const since = new Date(Date.now() - (opts.days ?? LOOKUP_LOOSE_DAYS) * 86_400_000);
  const like = `%${code.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT s."id"
    FROM unnest(${channelIds}::text[]) AS ch(id)
    CROSS JOIN LATERAL (
      SELECT o."id", o."trackingCode", o."returnTrackingCode", o."orderCode"
      FROM "Order" o
      WHERE o."channelId" = ch.id AND o."createdAt" >= ${since}
      ORDER BY o."createdAt" DESC
      LIMIT ${opts.rows ?? LOOKUP_LOOSE_ROWS}::int
    ) s
    WHERE s."trackingCode" ILIKE ${like} OR s."returnTrackingCode" ILIKE ${like} OR s."orderCode" ILIKE ${like}
    LIMIT 5`;
  return rows.map((r) => r.id);
}
