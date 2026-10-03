-- ============================================================
-- NGÀY HẾT HẠN ỦY QUYỀN SHOPEE (03/10/2026, anh Trung duyệt: hiện ngày hết hạn trên thẻ
-- gian để chủ shop biết gian ngắt là do hết hạn ủy quyền phía Shopee).
--
-- Bốn cột mới, đều cho phép NULL, không chỉ mục, không chép dữ liệu cũ:
--   "Channel"."authExpireAt"            ngày Shopee báo quyền của shop với app chính hết hạn
--   "Channel"."authExpireCheckedAt"     lần cuối Hubsell hỏi Shopee ngày đó (mỗi ngày một lần)
--   "channel_app_auths" hai cột cùng tên, cho app Hubsell Ads
--
-- ADD COLUMN cột NULL chỉ sửa catalog nhưng cần khóa ACCESS EXCLUSIVE trong chốc lát.
-- Bảng "Channel" được worker đồng bộ ghi liên tục, nên lấy khóa trước với lock_timeout
-- 5s và thử lại (khuôn 20261003120000_invoice_order_error_count). Lấy khóa hai bảng
-- theo MỘT thứ tự cố định: "Channel" rồi "channel_app_auths".
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Channel" IN ACCESS EXCLUSIVE MODE;
      LOCK TABLE "channel_app_auths" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'shopee_auth_expire: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "authExpireAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "authExpireCheckedAt" TIMESTAMP(3);

ALTER TABLE "channel_app_auths"
  ADD COLUMN IF NOT EXISTS "authExpireAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "authExpireCheckedAt" TIMESTAMP(3);
