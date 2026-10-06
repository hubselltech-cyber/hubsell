-- Xóa tài khoản ngay trong app (Apple từ chối 5.1.1(v) ngày 06/10/2026): mốc người
-- dùng tự xóa. Thông tin cá nhân bị xóa ngay lúc bấm, dữ liệu nghiệp vụ giữ lại
-- theo luật kế toán và xóa cứng sau 30 ngày bằng scripts/purge-deleted-accounts.ts.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
