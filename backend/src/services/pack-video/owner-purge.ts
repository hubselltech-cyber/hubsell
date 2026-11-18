// ============================================================
// VIDEO ĐÓNG HÀNG — DỌN VIDEO KHI CHỦ SHOP XÓA TÀI KHOẢN (18/11/2026, rủi ro S6 / điều kiện 1 mục 8)
//
// Video có tên + địa chỉ người mua trong khung hình. Chủ shop xóa tài khoản (services/account-deletion.ts)
// thì phải dọn cả video của họ trên R2, không đợi luật giữ theo trạng thái đơn.
//
// SAU CỜ: env PACK_VIDEO_ACCOUNT_PURGE=1 mới xóa thật. Mặc định chỉ ĐẾM và ghi nhật ký "sẽ xóa N video"
// (bản thí điểm có một tài khoản; bật khi mở cho khách thứ hai). Đọc sổ theo lô theo khóa của chủ shop đó,
// xóa tệp NGOÀI giao dịch database, rồi đánh dấu DELETED (giờ đã quay vẫn giữ nguyên trong sổ giờ).
// Lượt tải theo mảnh còn dở thì hủy lượt trước. Lỗi một tệp không chặn các tệp còn lại; chạy lại an toàn.
// ============================================================

import type { Prisma } from "@prisma/client";
import { PACK_VIDEO_JANITOR_BATCH, packVideoAccountPurgeEnabled } from "../../config/pack-video";
import { getR2Storage, type R2Storage } from "../../integrations/r2/client";
import { keyBelongsToOwner } from "../../lib/pack-video-key";
import { prisma } from "../../lib/prisma";

export interface OwnerPurgeDeps {
  enabled?: boolean;
  storage?: () => R2Storage;
  now?: () => Date;
  batchSize?: number;
}

export interface OwnerPurgeReport {
  ownerId: string;
  /** false = chạy bóng: chỉ đếm. */
  enabled: boolean;
  found: number;
  deleted: number;
  errors: number;
}

interface PurgeRow {
  recordedDate: Date;
  id: string;
  objectKey: string;
  uploadId: string | null;
  status: string;
}

export async function purgeOwnerPackVideos(ownerId: string, deps: OwnerPurgeDeps = {}): Promise<OwnerPurgeReport> {
  const enabled = deps.enabled ?? packVideoAccountPurgeEnabled();
  const size = deps.batchSize ?? PACK_VIDEO_JANITOR_BATCH;
  const now = (deps.now ?? (() => new Date()))();
  const report: OwnerPurgeReport = { ownerId, enabled, found: 0, deleted: 0, errors: 0 };
  let storage: R2Storage | null = null;
  type Cursor = { rd: Date; id: string };
  let after: Cursor | null = null;

  for (;;) {
    const where: Prisma.PackVideoWhereInput = {
      ownerId,
      status: { in: ["STORED", "PENDING"] },
      ...(after ? { OR: [{ recordedDate: { gt: after.rd } }, { recordedDate: after.rd, id: { gt: after.id } }] } : {}),
    };
    const rows: PurgeRow[] = await prisma.packVideo.findMany({
      where,
      orderBy: [{ recordedDate: "asc" }, { id: "asc" }],
      take: size,
      select: { recordedDate: true, id: true, objectKey: true, uploadId: true, status: true },
    });
    if (rows.length === 0) break;
    report.found += rows.length;

    if (enabled) {
      storage ??= (deps.storage ?? getR2Storage)();
      for (const row of rows) {
        if (!keyBelongsToOwner(row.objectKey, ownerId)) {
          report.errors += 1;
          continue;
        }
        try {
          if (row.status === "PENDING" && row.uploadId) {
            await storage.abortMultipart(row.objectKey, row.uploadId).catch(() => {});
          }
          await storage.remove(row.objectKey);
          await prisma.packVideo.updateMany({
            where: { recordedDate: row.recordedDate, id: row.id, ownerId },
            data: { status: "DELETED", deletedAt: now, deleteRule: "ACCOUNT" },
          });
          report.deleted += 1;
        } catch (err) {
          report.errors += 1;
          console.error(`[pack-video-purge] Xóa tệp lỗi ${row.id}:`, (err as Error).message);
        }
      }
    }
    const last: PurgeRow = rows[rows.length - 1];
    after = { rd: last.recordedDate, id: last.id };
    if (rows.length < size) break;
  }

  console.log(
    enabled
      ? `[pack-video-purge] Chủ shop ${ownerId} xóa tài khoản: đã xóa ${report.deleted}/${report.found} video (lỗi ${report.errors})`
      : `[pack-video-purge] CHẠY BÓNG — chủ shop ${ownerId} xóa tài khoản: SẼ xóa ${report.found} video (bật PACK_VIDEO_ACCOUNT_PURGE=1 để xóa thật)`
  );
  return report;
}
