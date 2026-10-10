-- ============================================================
-- MUA GÓI TRONG APP iOS QUA APP STORE (10/10/2026, Apple từ chối 3.1.1 ba lần:
-- gói mua trên web mà không mua được trong app → anh Trung chốt làm In-App
-- Purchase, kiểu Non-Renewing Subscription khớp mô hình trả trước theo kỳ).
--
-- 1. Giá trị enum mới APPLE_IAP cho PackagePayment.method — tiền Apple trả về
--    sau khi trừ hoa hồng, chứng từ vẫn đi qua recordPackagePaymentTx như payOS.
-- 2. Cột "appleAppAccountToken" trên "User" (NULL, unique): UUID app gửi cho
--    StoreKit lúc mua; giao dịch Apple trả về mang token này → backend tự tìm
--    chủ shop, không tin userId app gửi lên.
--
-- ADD VALUE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS để Render migrate deploy
-- chạy lại êm. "User" ít ghi, ADD COLUMN NULL không cần vòng lấy khóa.
-- ============================================================

ALTER TYPE "PackagePaymentMethod" ADD VALUE IF NOT EXISTS 'APPLE_IAP';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleAppAccountToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_appleAppAccountToken_key"
  ON "User"("appleAppAccountToken");
