-- ============================================================
-- MỐC ĐỔI MỤC TIÊU ROAS GẦN NHẤT (04/10/2026, anh Trung chốt: gợi ý hạ mục tiêu
-- ROAS đi từng nấc 10%, và KHÓA CỨNG 48 giờ giữa hai nấc).
--
-- Một cột mới, cho phép NULL, không chỉ mục, không chép dữ liệu cũ:
--   "AdsCampaign"."roasTargetChangedAt"  lúc Hubsell thấy mục tiêu ROAS của chiến dịch
--                                        đổi (đồng bộ thấy số sàn khác số đang lưu, hoặc
--                                        chính Hubsell gửi lệnh đổi). NULL = chưa từng thấy đổi.
--
-- ADD COLUMN cột NULL chỉ sửa catalog nhưng cần khóa ACCESS EXCLUSIVE trong chốc lát.
-- Bảng "AdsCampaign" được xung quảng cáo ghi thường xuyên, nên lấy khóa trước với
-- lock_timeout 5s và thử lại (khuôn 20261003230000_shopee_auth_expire).
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "AdsCampaign" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'ads_roas_target_changed_at: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "AdsCampaign"
  ADD COLUMN IF NOT EXISTS "roasTargetChangedAt" TIMESTAMP(3);
