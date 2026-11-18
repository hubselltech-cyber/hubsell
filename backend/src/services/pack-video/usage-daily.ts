// ============================================================
// VIDEO ĐÓNG HÀNG — GIỜ ĐÃ QUAY GỘP THEO NGÀY (`pack_usage_daily`, 18/11/2026, thiết kế mục 19.6)
//
// "Giờ đã quay" là số TÍNH TIỀN (giờ còn lại = đã mua − đã quay). Nó đang cộng từ `pack_videos`, mà
// bảng đó sẽ bị BỎ NGUYÊN MẢNH THÁNG khi hết hạn giữ (thiết kế mục 2). Bỏ mảnh mà không có số gộp thì
// "đã quay" tụt → khách tự nhiên được thêm giờ. Bảng này giữ số của từng (chủ shop, ngày quay) mãi mãi.
//
//   đã quay = Σ pack_usage_daily (ngày ≤ MỐC)  +  Σ pack_videos STORED + DELETED (ngày > MỐC)
//
// MỐC = ngày cuối đã gộp, lưu ở maintenance_jobs (key USAGE_JOB_KEY, cột cursor "YYYY-MM-DD").
//  · Chỉ gộp ngày đã cũ hơn FREEZE_LAG_DAYS — video quay hôm nay có thể còn đang chờ tải lên.
//  · Mỗi lượt GỘP LẠI cả REROLL_DAYS ngày trước mốc (ghi đè, chạy lại bao nhiêu lần cũng ra một số) để
//    video tải lên muộn vẫn được tính. Ngày đã bỏ mảnh không còn dòng nào trong pack_videos → câu gộp
//    không chạm tới → số cũ giữ nguyên (không bao giờ bị ghi thành 0).
//  · Gộp + dời mốc trong MỘT giao dịch: người đọc không bao giờ thấy nửa này nửa kia.
// Việc bỏ mảnh tháng (chưa làm) PHẢI kiểm: mốc ≥ ngày cuối của mảnh định bỏ.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { addDays, vnDateKey } from "../../lib/pack-video-retention";

export const USAGE_JOB_KEY = "pack-usage-daily";

/** Chỉ gộp ngày cũ hơn 7 ngày. SỐ TỰ CHỌN: video chờ tải lên khi mất mạng hiếm khi quá vài giờ. */
export const FREEZE_LAG_DAYS = 7;

/** Gộp lại 35 ngày trước mốc mỗi lượt. SỐ TỰ CHỌN: phủ video tải lên muộn cả tháng mà vẫn rẻ. */
export const REROLL_DAYS = 35;

/** Trạng thái tính là "đã dùng giờ" — PHẢI giống services/pack-video/hours.ts. */
const COUNTED = Prisma.sql`('STORED', 'DELETED')`;

type Db = Prisma.TransactionClient | typeof prisma;

/** Mốc đã gộp ("YYYY-MM-DD") hoặc null khi chưa gộp lần nào. */
export async function usageWatermark(db: Db = prisma): Promise<string | null> {
  const job = await db.maintenanceJob.findUnique({ where: { key: USAGE_JOB_KEY }, select: { cursor: true } });
  return job?.cursor && /^\d{4}-\d{2}-\d{2}$/.test(job.cursor) ? job.cursor : null;
}

/** Giây đã quay của MỘT chủ shop — đọc mốc + hai câu cộng, cùng một giao dịch đọc. */
export async function usedSecondsOf(ownerId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const mark = await usageWatermark(tx);
    const live = await tx.$queryRaw<{ s: bigint | null }[]>(Prisma.sql`
      SELECT sum(v."durationSec")::bigint AS s
      FROM "pack_videos" v
      WHERE v."ownerId" = ${ownerId} AND v."status" IN ${COUNTED}
        ${mark ? Prisma.sql`AND v."recordedDate" > ${mark}::date` : Prisma.empty}`);
    let total = Number(live[0]?.s ?? 0);
    if (mark) {
      const rolled = await tx.$queryRaw<{ s: bigint | null }[]>(Prisma.sql`
        SELECT sum(d."seconds")::bigint AS s
        FROM "pack_usage_daily" d
        WHERE d."ownerId" = ${ownerId} AND d."usageDate" <= ${mark}::date`);
      total += Number(rolled[0]?.s ?? 0);
    }
    return total;
  });
}

/**
 * Một lượt gộp: ghi đè các ngày (mốc cũ − REROLL_DAYS, mốc mới] rồi dời mốc. Trả mốc mới + số dòng ghi.
 * Lượt đầu (chưa có mốc) gộp từ ngày quay sớm nhất.
 */
export async function rollUpUsageDaily(now: Date = new Date()): Promise<{ watermark: string; rows: number }> {
  const target = addDays(vnDateKey(now), -FREEZE_LAG_DAYS - 1);
  return prisma.$transaction(async (tx) => {
    const prev = await usageWatermark(tx);
    const from = prev ? addDays(prev, -REROLL_DAYS) : "1970-01-01";
    const rows = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "pack_usage_daily" ("ownerId", "usageDate", "videoCount", "seconds", "sizeBytes", "updatedAt")
      SELECT v."ownerId", v."recordedDate", count(*)::int, sum(v."durationSec")::bigint, sum(v."sizeBytes")::bigint, now()
      FROM "pack_videos" v
      WHERE v."status" IN ${COUNTED}
        AND v."recordedDate" > ${from}::date AND v."recordedDate" <= ${target}::date
      GROUP BY v."ownerId", v."recordedDate"
      ON CONFLICT ("ownerId", "usageDate") DO UPDATE
        SET "videoCount" = EXCLUDED."videoCount", "seconds" = EXCLUDED."seconds",
            "sizeBytes" = EXCLUDED."sizeBytes", "updatedAt" = now()`);
    // Không bao giờ lùi mốc (đồng hồ máy chủ lệch / gọi tay với ngày cũ).
    const watermark = prev && prev > target ? prev : target;
    await tx.maintenanceJob.upsert({
      where: { key: USAGE_JOB_KEY },
      create: { key: USAGE_JOB_KEY, cursor: watermark, processed: rows },
      update: { cursor: watermark, processed: { increment: rows }, updatedAt: new Date() },
    });
    return { watermark, rows };
  });
}
