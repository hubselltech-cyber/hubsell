// ============================================================
// SAO CHÉP SẢN PHẨM — HỎI LẠI SÀN BÀI ĐANG "CHỜ SÀN DUYỆT" (docs/SAO-CHEP-SAN-PHAM.md mục 17)
//
// TikTok tạo sản phẩm xong để PENDING, duyệt sau vài phút tới vài giờ; trước đây
// Hubsell ghi PENDING_REVIEW một lần rồi thôi (anh 29/10: "TikTok duyệt rồi mà
// Hubsell vẫn Chờ sàn duyệt"). Nay:
//   · worker quét mỗi LISTING_COPY_REVIEW_CHECK_SECONDS (mặc định 600) các target
//     PENDING_REVIEW trong 14 ngày, hỏi adapter.checkReviewStatus → LISTED / FAILED;
//   · khi khách mở đợt (getBatch) mà có target chờ duyệt đã quá MIN_RECHECK_MS kể
//     từ lần hỏi trước → hỏi ngay (tối đa vài target) để màn hình không cũ.
// Lần hỏi trước = updatedAt (mỗi lần hỏi đều "chạm" dòng). Lỗi gọi sàn → giữ nguyên.
// ============================================================

import { prisma } from "../../lib/prisma";
import { getListingAdapter } from "../../marketplace/listing/registry";
import { rollupJob } from "./job-worker";

/** Hỏi lại thưa nhất mỗi 2 phút cho một target (mặc định tự chọn). */
const MIN_RECHECK_MS = 2 * 60_000;
/** Bài chờ duyệt quá 14 ngày coi như sàn không duyệt nữa — ngừng hỏi (mặc định tự chọn). */
const MAX_AGE_MS = 14 * 24 * 60 * 60_000;

interface ReviewCheckStats {
  checked: number;
  listed: number;
  failed: number;
  kept: number;
}

/** Hỏi lại MỘT target; trả trạng thái mới (hoặc "PENDING_REVIEW" nếu giữ). */
async function recheckTarget(targetId: string): Promise<"LISTED" | "PENDING_REVIEW" | "FAILED"> {
  const t = await prisma.listingCopyTarget.findUnique({ where: { id: targetId } });
  if (!t || t.status !== "PENDING_REVIEW" || !t.remoteItemId) return "PENDING_REVIEW";
  const channel = await prisma.channel.findUnique({ where: { id: t.channelId } });
  if (!channel) return "PENDING_REVIEW";
  const adapter = getListingAdapter(channel);
  if (!adapter.checkReviewStatus) return "PENDING_REVIEW";
  let result: Awaited<ReturnType<NonNullable<typeof adapter.checkReviewStatus>>>;
  try {
    result = await adapter.checkReviewStatus(channel, t.remoteItemId);
  } catch (err) {
    console.warn(`[listing-copy] hỏi lại duyệt ${channel.shopName} #${t.remoteItemId} lỗi: ${(err as Error).message}`);
    // Chạm dòng để không hỏi dồn khi sàn đang lỗi.
    await prisma.listingCopyTarget.update({ where: { id: t.id }, data: { status: "PENDING_REVIEW" } });
    return "PENDING_REVIEW";
  }
  if (!result || result.status === "PENDING_REVIEW") {
    await prisma.listingCopyTarget.update({ where: { id: t.id }, data: { status: "PENDING_REVIEW" } });
    return "PENDING_REVIEW";
  }
  await prisma.listingCopyTarget.update({
    where: { id: t.id },
    data:
      result.status === "LISTED"
        ? { status: "LISTED", error: null, listedAt: new Date(), ...(result.remoteUrl !== undefined ? { remoteUrl: result.remoteUrl } : {}) }
        : { status: "FAILED", error: result.reason ?? "Sàn không duyệt bài đăng." },
  });
  console.log(`[listing-copy] ${channel.shopName} (${channel.channelName}) #${t.remoteItemId} duyệt → ${result.status}`);
  await rollupJob(t.jobId);
  return result.status;
}

/** Các target chờ duyệt của một đợt đã đến hạn hỏi lại — gọi khi khách mở đợt. */
export async function recheckBatchDue(ownerId: string, batchId: string, limit = 5): Promise<number> {
  const due = await prisma.listingCopyTarget.findMany({
    where: {
      status: "PENDING_REVIEW",
      remoteItemId: { not: null },
      updatedAt: { lt: new Date(Date.now() - MIN_RECHECK_MS), gt: new Date(Date.now() - MAX_AGE_MS) },
      job: { userId: ownerId, batchId },
    },
    select: { id: true },
    take: limit,
  });
  let changed = 0;
  for (const t of due) {
    if ((await recheckTarget(t.id)) !== "PENDING_REVIEW") changed += 1;
  }
  return changed;
}

/** Chống chạy chồng TRONG MỘT tiến trình — không phải khóa phân tán: 2 worker song song chỉ trùng vài call, idempotent theo updatedAt. */
let running = false;

/** Một lượt quét toàn hệ thống (worker). */
export async function runReviewCheckOnce(limit = 100): Promise<ReviewCheckStats> {
  const stats: ReviewCheckStats = { checked: 0, listed: 0, failed: 0, kept: 0 };
  if (running) return stats;
  running = true;
  try {
    const due = await prisma.listingCopyTarget.findMany({
      where: {
        status: "PENDING_REVIEW",
        remoteItemId: { not: null },
        updatedAt: { lt: new Date(Date.now() - MIN_RECHECK_MS), gt: new Date(Date.now() - MAX_AGE_MS) },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    for (const t of due) {
      const r = await recheckTarget(t.id);
      stats.checked += 1;
      if (r === "LISTED") stats.listed += 1;
      else if (r === "FAILED") stats.failed += 1;
      else stats.kept += 1;
    }
    if (stats.checked > 0) console.log(`[listing-copy] quét duyệt: hỏi ${stats.checked}, lên ${stats.listed}, từ chối ${stats.failed}, còn chờ ${stats.kept}`);
  } finally {
    running = false;
  }
  return stats;
}
