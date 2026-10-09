-- ============================================================
-- "CHƯA THANH TOÁN" THEO GIAN (09/10/2026, anh Trung chốt: cột "Doanh thu chờ đối
-- soát" của bảng Phân bổ dòng tiền phồng ảo — ANO 399,8tr trong khi Seller Center
-- báo 16tr — thay bằng số SÀN TỰ CÔNG BỐ).
--
-- Hai cột mới trên "Channel", đều cho phép NULL, không chỉ mục, không chép dữ liệu cũ:
--   "pendingIncome"          tiền sàn sẽ trả cho shop của mọi đơn sàn chưa chi
--                            (Shopee: get_income_overview.pending_amount; TikTok:
--                            sum_est_settlement_amount của /orders/unsettled).
--                            NULL = sàn không có API (Lazada/Offline) hoặc chưa sync.
--   "pendingIncomeSyncedAt"  lần cuối hỏi sàn số đó.
--
-- ADD COLUMN cột NULL chỉ sửa catalog nhưng cần khóa ACCESS EXCLUSIVE trong chốc lát.
-- "Channel" được worker ghi liên tục → lấy khóa với lock_timeout 5s và thử lại
-- (khuôn 20261003230000_shopee_auth_expire).
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Channel" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'channel_pending_income: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "pendingIncome" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "pendingIncomeSyncedAt" TIMESTAMP(3);
