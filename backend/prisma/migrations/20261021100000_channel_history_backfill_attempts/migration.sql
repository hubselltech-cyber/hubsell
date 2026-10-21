-- ============================================================
-- 21/10/2026 — ĐẾM LẦN SẬP CỦA LƯỢT NẠP LỊCH SỬ GIAN MỚI (docs/DEPLOY-RENDER-SUPABASE.md 2c):
-- worker OOM giữa lượt backfill (Bella Look 8 lần/đêm 20–21/10) thì cờ
-- historyBackfillPending không hạ, lượt sau làm lại y hệt. Bộ đếm tăng TRƯỚC khi
-- chạy, về 0 khi lượt kết thúc êm; quá HISTORY_BACKFILL_MAX_ATTEMPTS thì hạ cờ.
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
        RAISE NOTICE 'channel_history_backfill_attempts: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "historyBackfillAttempts" INTEGER NOT NULL DEFAULT 0;
