-- ============================================================
-- 22/10/2026 — THIẾT KẾ 13.9 BƯỚC A2 (docs/ADS-NHIP-CANH-BAO.md 13.9.8): xung Shopee
-- bị cổng gọi sàn hoãn ở bước k → lượt sau CHẠY TIẾP từ bước k (không hỏi lại các bước
-- đã có số). Mốc dở cũ hơn ADS_PULSE_RESUME_TTL_MIN thì chạy lại từ đầu.
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
        RAISE NOTICE 'channel_ads_pulse_step: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsPulseStep" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsPulseStepAt" TIMESTAMP(3);
