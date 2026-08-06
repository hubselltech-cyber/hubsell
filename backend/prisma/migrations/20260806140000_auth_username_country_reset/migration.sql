-- Nâng cấp Auth 06/08/2026: đăng nhập bằng username HOẶC email, quốc gia,
-- liên kết Google OAuth, và luồng quên mật khẩu (token hash + hạn).
-- Toàn bộ cột mới nullable/có default → chạy an toàn trên dữ liệu thật.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'VN';
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN "resetTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "resetTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
