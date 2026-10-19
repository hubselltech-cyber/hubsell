-- ============================================================
-- 19/10/2026 — CẦU DAO ADS LÁT 2 "cách ly theo gian" (docs/ADS-NHIP-CANH-BAO.md 13.8):
-- gian dính 429 tầng shop lùi RIÊNG theo bậc, bậc lưu DB để khởi động lại /
-- nhiều worker vẫn đúng. Làn Ads (ads-lane.ts) không nhặt gian đang lùi.
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
        RAISE NOTICE 'channel_ads_backoff: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsBackoffLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "adsBackoffUntil" TIMESTAMP(3);
