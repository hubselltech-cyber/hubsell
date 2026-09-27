-- Yêu cầu hỗ trợ: mốc khách đã xem lần cuối (27/09/2026) — tính "trả lời mới" cho chấm đỏ trên avatar.
ALTER TABLE "support_requests" ADD COLUMN IF NOT EXISTS "customerSeenAt" TIMESTAMP(3);
