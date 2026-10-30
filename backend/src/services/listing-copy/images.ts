// ============================================================
// ẢNH SẢN PHẨM "TẠO MỚI" — lát C (30/10/2026, docs/SAO-CHEP-SAN-PHAM.md mục 24.6):
//   1. Ghi nhận mỗi ảnh tải lên (bảng listing_image_uploads) → biết ảnh của ai / job nào.
//   2. Trần ảnh theo gói (mặc định tự chọn, chưa có căn cứ khách — đổi số ở PRODUCT_IMAGE_QUOTA).
//   3. Gắn ảnh vào job khi tạo đợt; cron dọn ảnh MỒ CÔI (không gắn job sau 2 ngày) và job
//      NHÁP bỏ dở quá 30 ngày (xóa ảnh + job). Ảnh của job đã đăng GIỮ VĨNH VIỄN.
//   4. Số liệu cho HQ (số ảnh, MB, số chủ shop).
// ============================================================

import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../lib/prisma";
import { productImages } from "../../lib/supabase-storage";
import { getOwnerPlanState } from "../plan-enforcement";

/**
 * Trần SỐ ẢNH đang lưu theo bậc gói (ServicePlan.tier 1..6). Mặc định tự chọn 30/10/2026:
 * 400 KB/ảnh → bậc 1 ≈ 80 MB, bậc 5 ≈ 12 GB; gói Pro Supabase 100 GB. Chưa có thuê bao
 * (khách cũ chưa gán) = không giới hạn, cùng luật plan-enforcement.
 */
export const PRODUCT_IMAGE_QUOTA: Record<number, number | null> = {
  1: 200,
  2: 1_000,
  3: 3_000,
  4: 10_000,
  5: 30_000,
  6: null,
};

/** Ảnh tải lên mà không gắn vào job nào sau ngần này ngày → xóa. */
export const ORPHAN_IMAGE_DAYS = 2;
/** Job "Tạo mới" còn DRAFT (chưa bấm Đăng) quá ngần này ngày → xóa ảnh + job. */
export const DRAFT_JOB_DAYS = 30;

export function imageQuotaForTier(tier: number | null | undefined): number | null {
  if (tier == null) return null;
  if (tier in PRODUCT_IMAGE_QUOTA) return PRODUCT_IMAGE_QUOTA[tier];
  return tier > 6 ? null : PRODUCT_IMAGE_QUOTA[1];
}

export interface ImageQuota {
  used: number;
  max: number | null;
}

/** Số ảnh đang lưu của chủ shop + trần theo gói. */
export async function imageQuotaOf(ownerId: string): Promise<ImageQuota> {
  const [used, state] = await Promise.all([
    prisma.listingImageUpload.count({ where: { userId: ownerId } }),
    getOwnerPlanState(ownerId),
  ]);
  return { used, max: state.hasSubscription ? imageQuotaForTier(state.plan?.tier) : null };
}

export function quotaExceeded(q: ImageQuota): boolean {
  return q.max != null && q.used >= q.max;
}

export async function recordUpload(input: { ownerId: string; storage: "supabase" | "local"; path: string; url: string; bytes: number }): Promise<void> {
  await prisma.listingImageUpload.create({
    data: { userId: input.ownerId, storage: input.storage, path: input.path, url: input.url, bytes: input.bytes },
  });
}

/** Gắn ảnh (theo URL trong listing) vào job vừa tạo — chỉ ảnh của chính chủ shop, chưa gắn job khác. */
export async function attachUploadsToJob(ownerId: string, jobId: string, urls: string[]): Promise<number> {
  const list = [...new Set(urls.filter(Boolean))];
  if (list.length === 0) return 0;
  const r = await prisma.listingImageUpload.updateMany({
    where: { userId: ownerId, url: { in: list }, jobId: null },
    data: { jobId },
  });
  return r.count;
}

/** Xóa tệp thật (Supabase hoặc đĩa local) của các dòng — lỗi từng tệp chỉ ghi log. */
async function deleteFiles(rows: { storage: string; path: string }[], localDir: string | null): Promise<number> {
  const supa = rows.filter((r) => r.storage === "supabase").map((r) => r.path);
  let ok = 0;
  if (supa.length > 0) {
    try {
      await productImages.delete(supa);
      ok += supa.length;
    } catch (err) {
      console.error(`[listing-copy] Xóa ${supa.length} ảnh Supabase lỗi: ${(err as Error).message}`);
    }
  }
  for (const r of rows.filter((x) => x.storage === "local")) {
    if (!localDir) continue;
    try {
      await fs.unlink(path.join(localDir, r.path));
      ok += 1;
    } catch {
      // tệp đã mất — coi như xong
      ok += 1;
    }
  }
  return ok;
}

export interface ImageCleanupResult {
  orphanImages: number;
  draftJobs: number;
  draftImages: number;
}

/**
 * Một lượt dọn (gọi từ cron log-cleanup mỗi 24 giờ): ảnh mồ côi > ORPHAN_IMAGE_DAYS; job
 * MANUAL còn DRAFT > DRAFT_JOB_DAYS → xóa ảnh rồi xóa job (targets cascade). Mỗi lượt tối đa
 * 200 ảnh mồ côi + 50 job nháp — còn thì lượt sau.
 */
export async function cleanupListingImages(localDir: string | null): Promise<ImageCleanupResult> {
  const out: ImageCleanupResult = { orphanImages: 0, draftJobs: 0, draftImages: 0 };
  const dayMs = 24 * 60 * 60 * 1000;

  const orphans = await prisma.listingImageUpload.findMany({
    where: { jobId: null, createdAt: { lt: new Date(Date.now() - ORPHAN_IMAGE_DAYS * dayMs) } },
    select: { id: true, storage: true, path: true },
    take: 200,
  });
  if (orphans.length > 0) {
    await deleteFiles(orphans, localDir);
    const r = await prisma.listingImageUpload.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
    out.orphanImages = r.count;
  }

  const drafts = await prisma.listingCopyJob.findMany({
    where: { sourceType: "MANUAL", status: "DRAFT", createdAt: { lt: new Date(Date.now() - DRAFT_JOB_DAYS * dayMs) } },
    select: { id: true, images: { select: { id: true, storage: true, path: true } } },
    take: 50,
  });
  for (const job of drafts) {
    if (job.images.length > 0) {
      await deleteFiles(job.images, localDir);
      const r = await prisma.listingImageUpload.deleteMany({ where: { id: { in: job.images.map((i) => i.id) } } });
      out.draftImages += r.count;
    }
    await prisma.listingCopyJob.delete({ where: { id: job.id } });
    out.draftJobs += 1;
  }
  return out;
}

export interface ImageStoreStats {
  count: number;
  mb: number;
  owners: number;
  orphans: number;
}

/** Số liệu kho ảnh cho HQ Sức khỏe. */
export async function imageStoreStats(): Promise<ImageStoreStats> {
  const [agg, owners, orphans] = await Promise.all([
    prisma.listingImageUpload.aggregate({ _count: { _all: true }, _sum: { bytes: true } }),
    prisma.listingImageUpload.groupBy({ by: ["userId"], _count: { _all: true } }),
    prisma.listingImageUpload.count({ where: { jobId: null } }),
  ]);
  return {
    count: agg._count._all,
    mb: Math.round(((agg._sum.bytes ?? 0) / 1048576) * 10) / 10,
    owners: owners.length,
    orphans,
  };
}
