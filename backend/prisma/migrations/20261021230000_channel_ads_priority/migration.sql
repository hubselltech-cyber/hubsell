-- ============================================================
-- 21/10/2026 — THIẾT KẾ 13.9 BƯỚC B (docs/ADS-NHIP-CANH-BAO.md): lớp ưu tiên ads
-- của gian (1 tiêu tiền + Trợ lý bật · 2 có chiến dịch · 3 không chiến dịch).
-- Làn Ads nhặt lớp thấp trước; nhịp xung từng lớp tự co theo sức chứa khóa.
-- "Channel" bị worker UPDATE liên tục → khóa có thử lại như migration trước.
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
        RAISE NOTICE 'channel_ads_priority: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsPriority" INTEGER NOT NULL DEFAULT 2;
