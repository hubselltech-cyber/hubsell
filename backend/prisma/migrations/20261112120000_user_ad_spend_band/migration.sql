-- 12/11/2026 — Mức chi quảng cáo sàn mỗi tháng khách tự chọn ở form đăng ký web.
-- Cột nullable, không default → Postgres chỉ sửa metadata, không viết lại bảng "User".
-- Giá trị hợp lệ kiểm ở tầng API (src/lib/ad-spend-band.ts), không dùng enum để
-- đổi mốc sau này khỏi cần migration.
--
-- "User" bị ghi liên tục (auth chạm lastActiveAt) → lấy khóa bằng lock_timeout ngắn
-- và thử lại, không đứng chờ chặn cả hàng đợi (bẫy deploy Render 30/09/2026).
DO $$
DECLARE
  attempt int := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adSpendBand" TEXT;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      attempt := attempt + 1;
      IF attempt >= 40 THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(2);
    END;
  END LOOP;
END $$;
