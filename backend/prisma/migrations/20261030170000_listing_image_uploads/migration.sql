-- 30/10/2026 — Sao chép sản phẩm nguồn "Tạo mới" lát C (docs/SAO-CHEP-SAN-PHAM.md mục 24.6):
-- ghi nhận ảnh khách tải lên để trần theo gói + cron dọn ảnh mồ côi/nháp + HQ dung lượng.
CREATE TABLE "listing_image_uploads" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storage" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "jobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listing_image_uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listing_image_uploads_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "listing_copy_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "listing_image_uploads_url_key" ON "listing_image_uploads" ("url");
CREATE INDEX "listing_image_uploads_userId_createdAt_idx" ON "listing_image_uploads" ("userId", "createdAt");
CREATE INDEX "listing_image_uploads_jobId_idx" ON "listing_image_uploads" ("jobId");

ALTER TABLE "listing_image_uploads" ENABLE ROW LEVEL SECURITY;
