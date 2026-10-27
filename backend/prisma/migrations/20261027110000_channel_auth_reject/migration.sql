-- ============================================================
-- 27/10/2026 — MẤT ỦY QUYỀN PHÍA SÀN, LUẬT CHUNG (docs/THOI-HAN-UY-QUYEN-SAN.md mục 6):
-- đếm số lần sàn từ chối làm mới token theo gian, đủ 3 lần trải 30 phút (hoặc mã chắc
-- chắn) thì hạ DISCONNECTED; lưu mã sàn trả để thẻ gian nói đúng lý do.
-- "Channel" bị worker UPDATE liên tục → khóa có thử lại như migration 22/10.
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
        RAISE NOTICE 'channel_auth_reject: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "authRejectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "authRejectSince" TIMESTAMP(3);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "authLostReason" TEXT;

ALTER TABLE "channel_app_auths" ADD COLUMN IF NOT EXISTS "authRejectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "channel_app_auths" ADD COLUMN IF NOT EXISTS "authRejectSince" TIMESTAMP(3);
ALTER TABLE "channel_app_auths" ADD COLUMN IF NOT EXISTS "authLostReason" TEXT;
