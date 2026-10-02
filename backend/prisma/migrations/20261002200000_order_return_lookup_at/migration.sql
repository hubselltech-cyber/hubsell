-- ============================================================
-- QUÉT BÙ YÊU CẦU HOÀN THEO MÃ ĐƠN (02/10/2026), bước 1/2: thêm cột mốc.
--
-- "returnLookupAt" = Hubsell đã đọc yêu cầu hoàn của sàn cho đơn này. Null =
-- chưa đọc. Cột cho phép NULL, không mặc định → Postgres chỉ sửa danh mục,
-- không ghi lại bảng. Trigger sổ cái đơn KHÔNG so cột này nên không sinh việc
-- tính lại.
--
-- ADD COLUMN cần khóa ACCESS EXCLUSIVE trên "Order" trong tích tắc. Lấy khóa
-- TRƯỚC với lock_timeout 5s + thử lại (khuôn 20260930230000_order_ledger): nếu
-- có giao dịch ghi đơn đang chạy thì nhả ra chờ 3s rồi thử lại, không để hàng
-- đợi khóa chặn mọi câu đọc / ghi đơn của app. Migration này chỉ đụng MỘT bảng
-- nên không thể deadlock giữa chừng.
--
-- Chỉ mục tách sang migration kế (20261002200100) để lúc dựng chỉ mục không
-- còn giữ khóa ACCESS EXCLUSIVE (đọc đơn vẫn chạy).
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Order" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_return_lookup_at: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "returnLookupAt" TIMESTAMP(3);
