// ============================================================
// SAO CHÉP SẢN PHẨM — nhận việc listing.copy (docs/SAO-CHEP-SAN-PHAM.md mục 4)
//
// Hàng đợi policy standard: mỗi gian đích một việc {targetId}, việc ngắn (tải
// ảnh + tạo sản phẩm, vài giây) nên chạy thẳng trong handler — khác đẩy tồn
// (stately + bộ chạy riêng). Trạng thái thật nằm ở listing_copy_targets.
// ============================================================

import { QUEUES, registerWorker } from "../lib/queue";
import { processTarget, type ListingCopyJobData } from "../services/listing-copy/service";

export async function registerListingCopyQueueWorkers(): Promise<void> {
  await registerWorker<ListingCopyJobData>(QUEUES.listingCopy, { concurrency: 3, pollSeconds: 2 }, async (job) => {
    await processTarget(job.data.targetId);
  });
}
