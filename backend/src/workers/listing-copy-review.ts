// ============================================================
// SAO CHÉP SẢN PHẨM — vòng quét "Chờ sàn duyệt" (docs/SAO-CHEP-SAN-PHAM.md mục 17)
//
// Mỗi LISTING_COPY_REVIEW_CHECK_SECONDS (mặc định 600; "0" = tắt) hỏi lại sàn các
// target PENDING_REVIEW (TikTok) → LISTED / FAILED. Câu đọc đi theo trạng thái,
// bình thường vài dòng; mỗi target hỏi thưa nhất 2 phút (MIN_RECHECK_MS).
// ============================================================

import { runReviewCheckOnce } from "../services/listing-copy/review-check";

const DEFAULT_INTERVAL_SECONDS = 600;

export function startListingCopyReviewWorker(): void {
  const seconds = Number(process.env.LISTING_COPY_REVIEW_CHECK_SECONDS ?? DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.log("[listing-copy] Vòng quét duyệt TẮT (LISTING_COPY_REVIEW_CHECK_SECONDS=0)");
    return;
  }
  setInterval(() => {
    runReviewCheckOnce().catch((err) => console.error("[listing-copy] quét duyệt lỗi:", (err as Error).message));
  }, seconds * 1000).unref();
  console.log(`[listing-copy] Vòng quét bài chờ sàn duyệt chạy nhịp ${seconds} giây`);
}
