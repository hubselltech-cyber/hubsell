-- 18/10/2026 — Bản 1.3.0: Sign in with Apple trong app mobile.
-- "User"."appleUserId" = sub Apple (unique), "appleRefreshTokenEnc" = refresh_token
-- mã hóa chỉ để thu hồi khi khách xóa tài khoản (Apple 5.1.1(v)).
-- Khóa có thử lại như user_password_set_at (bẫy deadlock khi Render chạy song song).
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'user_apple_sign_in: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleUserId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleRefreshTokenEnc" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_appleUserId_key" ON "User"("appleUserId");
