-- Yêu cầu hỗ trợ: ảnh đính kèm (đường dẫn Supabase Storage) + mốc đã dọn ảnh sau 7 ngày (27/09/2026).
ALTER TABLE "support_requests" ADD COLUMN IF NOT EXISTS "attachments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "support_requests" ADD COLUMN IF NOT EXISTS "attachmentsPurgedAt" TIMESTAMP(3);
