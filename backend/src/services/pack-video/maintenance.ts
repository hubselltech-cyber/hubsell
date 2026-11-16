// ============================================================
// VIDEO ĐÓNG HÀNG — bảo trì sổ
// Tạo sẵn mảnh tháng của `pack_videos` (hàm SQL trong migration 20261116090000_pack_videos).
// Worker sổ cái gọi lúc khởi động + mỗi đêm, cạnh việc tạo mảnh của sổ cái — không thêm tiến
// trình mới cho một câu lệnh. Việc dọn / xóa video theo luật là lát sau (chạy bóng trước).
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/** Tạo sẵn mảnh tới `monthsAhead` tháng sau (gọi lại nhiều lần không sao). Trả số mảnh mới. */
export async function ensurePackVideoPartitions(monthsAhead = 3): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT "pack_videos_ensure_partitions"(${monthsAhead}::int) AS n
  `);
  return Number(rows[0]?.n ?? 0);
}
