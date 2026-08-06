-- SĐT đăng ký 06/08/2026: lưu chuẩn E.164 (vd "+84912345678") do src/phone.ts
-- ghép từ countryCode + số trong nước — nền cho OTP SMS/WhatsApp sau này.
-- Cột nullable → chạy an toàn trên dữ liệu thật (user cũ/Google chưa có SĐT).
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
