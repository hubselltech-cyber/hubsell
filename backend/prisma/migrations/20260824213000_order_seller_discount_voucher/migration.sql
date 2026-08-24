-- CHIET KHAU VOUCHER NGUOI BAN cho hoa don (24/08 toi): tach RIENG phan
-- voucher_from_seller (giam thang so khach tra don nay) khoi cot sellerVoucher
-- (dang gop ca xu hoan - xu hoan KHONG phai chiet khau, khach van tra du).
-- Lazada giu 0 vi paid_price dong hang DA tru voucher nguoi ban.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sellerDiscountVoucher" DECIMAL(12,2) NOT NULL DEFAULT 0;
