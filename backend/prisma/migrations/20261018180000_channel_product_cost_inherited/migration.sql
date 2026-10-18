-- 18/10/2026 — Lát 3 của docs/MO-HINH-CAY-SAN-PHAM-SAN.md (mục 8): SỬA MỘT LẦN hậu quả
-- bản tách phân loại 15/10 — lá tách mới bị để trống giá vốn dù khách đã đặt giá cho
-- đúng mã đó. Cột đánh dấu lá nhận giá THỪA KẾ (chỉ kỹ thuật, không hiện UI): không
-- ghi đè số khách sửa tay về sau, và có đường lui một câu UPDATE. Anh Trung chốt:
-- giá vốn là của khách — chỉ trả lại giá khách đã đặt cho mã, không bịa, không nhắc;
-- phân loại khách thêm sau này khách tự nhập.
-- ChannelProduct vài chục nghìn dòng, worker danh mục ghi theo lượt → khối lấy khóa có
-- thử lại cho chắc (ADD COLUMN NULL là siêu dữ liệu, giữ khóa chốc lát).
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "ChannelProduct" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'channel_product_cost_inherited: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "ChannelProduct" ADD COLUMN IF NOT EXISTS "costPriceInheritedAt" TIMESTAMP(3);
