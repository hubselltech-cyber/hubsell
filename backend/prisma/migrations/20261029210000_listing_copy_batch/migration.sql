-- 29/10/2026 — Sao chép sản phẩm lát 2: đợt nhiều sản phẩm (docs/SAO-CHEP-SAN-PHAM.md mục 9).
ALTER TABLE "listing_copy_jobs" ADD COLUMN "batchId" TEXT;
UPDATE "listing_copy_jobs" SET "batchId" = "id" WHERE "batchId" IS NULL;
CREATE INDEX "listing_copy_jobs_userId_batchId_idx" ON "listing_copy_jobs" ("userId", "batchId");
