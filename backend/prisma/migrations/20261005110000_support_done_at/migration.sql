-- Yêu cầu hỗ trợ: mốc chuyển Đã xong, để cron xóa ảnh đếm 7 ngày từ đây (05/10/2026).
-- Trước đó cron đếm theo updatedAt, mà updatedAt bị bơm lại mỗi lần khách mở hộp
-- hỗ trợ (đóng dấu customerSeenAt) nên ảnh không bao giờ đủ 7 ngày.
ALTER TABLE "support_requests" ADD COLUMN IF NOT EXISTS "doneAt" TIMESTAMP(3);
-- Dòng DONE có sẵn: không còn biết giờ chuyển thật, lấy updatedAt (muộn hơn hoặc
-- bằng giờ thật) — thà giữ ảnh lâu hơn vài ngày chứ không xóa sớm.
UPDATE "support_requests" SET "doneAt" = "updatedAt" WHERE "status" = 'DONE' AND "doneAt" IS NULL;
CREATE INDEX IF NOT EXISTS "support_requests_status_doneAt_idx" ON "support_requests"("status", "doneAt");
