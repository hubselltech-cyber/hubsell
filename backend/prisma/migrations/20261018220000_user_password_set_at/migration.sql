-- ============================================================
-- 18/10/2026 — Khách đăng ký web bằng Google mở app điện thoại không biết vào
-- kiểu gì (app chỉ có ô email + mật khẩu; tài khoản Google mang passwordHash
-- của 32 byte ngẫu nhiên). Thêm "User"."passwordSetAt": NULL = chưa có mật
-- khẩu thật → Cài đặt web hiện "Đặt mật khẩu" KHÔNG đòi mật khẩu hiện tại.
--
-- Backfill (không phân biệt được user có googleId đã từng đặt mật khẩu hay chưa):
--   • Không có googleId                       → createdAt (đăng ký form / nhân viên
--                                               do chủ shop cấp: chắc chắn có mật khẩu).
--   • Có googleId + log đồng ý "register_form" → createdAt (đăng ký form trước,
--                                               liên kết Google sau: mật khẩu thật).
--   • Có googleId còn lại (google_register /   → NULL. CHẤP NHẬN: ai trong nhóm này
--     google_login / không có log)               đã đi Quên mật khẩu rồi vẫn thấy nút
--                                               "Đặt mật khẩu" không đòi mật khẩu cũ
--                                               MỘT LẦN; đăng nhập bằng mật khẩu
--                                               thành công sẽ tự ghi mốc (auth.ts).
--
-- "User" ít ghi nhưng requireAuth chạm lastActiveAt và worker ghi đơn giữ khóa
-- hàng; migration chạy lúc Render khởi động song song instance cũ (bẫy deadlock
-- 30/09/2026) → lấy khóa có thử lại rồi mới ALTER. IF NOT EXISTS để chạy lại êm.
-- ============================================================
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
        RAISE NOTICE 'user_password_set_at: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordSetAt" TIMESTAMP(3);

UPDATE "User"
SET "passwordSetAt" = "createdAt"
WHERE "passwordSetAt" IS NULL
  AND "deletedAt" IS NULL
  AND (
    "googleId" IS NULL
    OR EXISTS (
      SELECT 1 FROM "TermsAcceptance" t
      WHERE t."userId" = "User"."id" AND t."source" = 'register_form'
    )
  );
