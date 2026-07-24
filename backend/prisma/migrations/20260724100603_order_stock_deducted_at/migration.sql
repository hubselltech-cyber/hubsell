-- Chốt chặn trừ kho trùng cho đơn TikTok đẩy về qua webhook nhiều lần.
ALTER TABLE "Order" ADD COLUMN "stockDeductedAt" TIMESTAMP(3);
