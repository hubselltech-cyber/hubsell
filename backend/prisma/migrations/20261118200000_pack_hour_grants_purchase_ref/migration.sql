-- ============================================================
-- VIDEO ĐÓNG HÀNG — MUA GIỜ QUAY: mỗi khoản đã thu = MỘT dòng PURCHASE (18/11/2026,
-- docs/VIDEO-DONG-HANG-THIET-KE.md mục 19).
--
-- Anh Trung 16/11: "khách mua bao nhiêu thì hệ thống cộng vào tài khoản của khách bấy nhiêu, mình thu
-- trước… coi như là một giao dịch mua hàng". Đơn giá chốt 1.500 đ / giờ, tính thẳng.
--
-- Chỉ ADD trên bảng nhỏ `pack_hour_grants` (prod 16/11: 0 dòng) — không đụng "Order" hay bảng lớn nào.
--   paymentRef  mã của khoản tiền đã thu (vd "payos:<mã GD ngân hàng>") — DUY NHẤT: webhook bắn hai lần /
--               poll đua webhook thì lượt thứ hai đụng chỉ mục và KHÔNG cộng giờ lần nữa.
--   amountVnd   số tiền đã thu cho dòng này (đồng, số nguyên) — để sổ giờ hiện "n giờ · X đ" và đối chiếu.
-- Ràng buộc: dòng PURCHASE BẮT BUỘC có cả hai và số giây phải dương (mua không bao giờ trừ giờ).
-- ============================================================

ALTER TABLE "pack_hour_grants" ADD COLUMN IF NOT EXISTS "paymentRef" TEXT;
ALTER TABLE "pack_hour_grants" ADD COLUMN IF NOT EXISTS "amountVnd" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "pack_hour_grants_payment_ref_key"
  ON "pack_hour_grants" ("paymentRef") WHERE "paymentRef" IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_hour_grants_purchase_check') THEN
    ALTER TABLE "pack_hour_grants" ADD CONSTRAINT "pack_hour_grants_purchase_check" CHECK (
      "kind" <> 'PURCHASE' OR ("paymentRef" IS NOT NULL AND "amountVnd" > 0 AND "seconds" > 0)
    );
  END IF;
END $$;
