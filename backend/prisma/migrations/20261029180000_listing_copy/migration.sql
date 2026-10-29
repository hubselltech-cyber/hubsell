-- ============================================================
-- 29/10/2026 — SAO CHÉP SẢN PHẨM lát 1 (docs/SAO-CHEP-SAN-PHAM.md mục 3–4):
--   listing_copy_jobs / listing_copy_targets + hàng đợi pg-boss listing.copy
--   (policy standard: mỗi gian đích một việc, việc ngắn chạy trong handler).
-- ============================================================
CREATE TYPE "ListingCopySourceType" AS ENUM ('CHANNEL', 'PRODUCT');
CREATE TYPE "ListingCopyJobStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'DONE', 'PARTIAL', 'FAILED');
CREATE TYPE "ListingCopyTargetStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'LISTED', 'PENDING_REVIEW', 'FAILED');

CREATE TABLE "listing_copy_jobs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "sourceType" "ListingCopySourceType" NOT NULL,
  "sourceChannelId" TEXT,
  "sourceItemId" TEXT,
  "sourceGroupKey" TEXT,
  "sourceTitle" TEXT NOT NULL,
  "sourceImageUrl" TEXT,
  "source" JSONB NOT NULL,
  "status" "ListingCopyJobStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "listing_copy_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "listing_copy_jobs_userId_createdAt_idx" ON "listing_copy_jobs" ("userId", "createdAt");

CREATE TABLE "listing_copy_targets" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "categoryId" TEXT,
  "categoryName" TEXT,
  "categoryConfidence" DOUBLE PRECISION,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "brandId" TEXT,
  "brandName" TEXT,
  "logisticIds" JSONB NOT NULL DEFAULT '[]',
  "weightGrams" INTEGER,
  "dimensionsCm" JSONB,
  "priceAdjustPercent" INTEGER NOT NULL DEFAULT 0,
  "stock" INTEGER,
  "missing" JSONB NOT NULL DEFAULT '[]',
  "status" "ListingCopyTargetStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "remoteItemId" TEXT,
  "remoteUrl" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "listedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "listing_copy_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listing_copy_targets_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "listing_copy_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "listing_copy_targets_jobId_idx" ON "listing_copy_targets" ("jobId");
CREATE INDEX "listing_copy_targets_channelId_status_idx" ON "listing_copy_targets" ("channelId", "status");

ALTER TABLE "listing_copy_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "listing_copy_targets" ENABLE ROW LEVEL SECURITY;

SELECT pgboss.create_queue('listing.copy', '{"policy":"standard","retryLimit":2,"retryDelay":30,"retryBackoff":true,"expireInSeconds":600}'::jsonb);
