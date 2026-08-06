-- Quản trị nền tảng 06/08/2026: cờ isPlatformAdmin trên User — mở khóa khu
-- /admin (thống kê người dùng đăng ký, nhật ký webhook toàn hệ thống).
-- Cột có default false → chạy an toàn trên dữ liệu thật; gán quyền bằng
-- script scripts/grant-platform-admin.ts (không có API nào tự bật được).
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
