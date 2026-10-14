-- ============================================================
-- LƯỢT CHUẨN BỊ HÀNG CHẠY NỀN (14/10/2026). Trước đây POST /bulk/confirm là MỘT
-- request đồng bộ gọi sàn từng đơn (mẻ 58 đơn kéo 1,5–3 phút, bị cắt giữa
-- chừng, giao diện lệch DB — sự cố 09/09). Nay request tạo một dòng ở đây,
-- trả batchId ngay; việc gọi sàn (API mẻ Shopee mass_ship_order / TikTok Batch
-- Ship) chạy tiếp trong tiến trình web và ghi tiến độ `done`/`total`; giao
-- diện hỏi theo batchId. Bảng mới, không khóa ngoại → không lấy khóa trên
-- bảng đang ghi. Bật RLS như mọi bảng khác. IF NOT EXISTS để chạy lại êm.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "FulfillmentBatchStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "fulfillment_batches" (
  "id"           TEXT NOT NULL,
  "ownerId"      TEXT NOT NULL,
  "status"       "FulfillmentBatchStatus" NOT NULL DEFAULT 'RUNNING',
  "total"        INTEGER NOT NULL,
  "done"         INTEGER NOT NULL DEFAULT 0,
  "confirmedIds" JSONB NOT NULL DEFAULT '[]',
  "skipped"      JSONB NOT NULL DEFAULT '[]',
  "failed"       JSONB NOT NULL DEFAULT '[]',
  "notes"        JSONB NOT NULL DEFAULT '[]',
  "error"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "finishedAt"   TIMESTAMP(3),

  CONSTRAINT "fulfillment_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fulfillment_batches_ownerId_createdAt_idx" ON "fulfillment_batches" ("ownerId", "createdAt");

ALTER TABLE "fulfillment_batches" ENABLE ROW LEVEL SECURITY;
