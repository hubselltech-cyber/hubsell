-- ============================================================
-- HÓA ĐƠN BƯỚC 5, LÁT 7: đơn lỗi vì dữ liệu của chính nó dừng tự thử sau 3 lượt
-- (03/10/2026, anh Trung duyệt phương án 03/10).
--
-- Hai cột mới trên InvoiceLog, đều cho phép NULL, không chỉ mục, không chép lại
-- dữ liệu cũ (dòng đời trước giữ NULL = chưa đếm):
--   · "errorScope"      — tầm của lỗi khi dòng FAILED (ACCOUNT | ORDER | TRANSIENT),
--                         là sự thật gốc để tính lại cột dưới khi cần.
--   · "orderErrorCount" — số lượt lỗi RIÊNG ĐƠN (tầm ORDER) của hóa đơn gốc tính tới
--                         dòng này; worker tự phát hành bỏ qua đơn có dòng FAILED mang
--                         số ≥ 3 (INVOICE_AUTO_ISSUE_MAX_ATTEMPTS). Bấm tay vẫn được.
--
-- ALTER TABLE ADD COLUMN cột NULL không ghi lại bảng (chỉ sửa catalog) nhưng cần khóa
-- ACCESS EXCLUSIVE trong chốc lát: lấy khóa trước với lock_timeout 5s và thử lại,
-- theo khuôn 20260930230000_order_ledger, để migration không hỏng giữa chừng lúc
-- đưa lên. Chỉ đụng MỘT bảng InvoiceLog (prod 03/10/2026: 2 dòng).
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "InvoiceLog" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'invoice_order_error_count: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "InvoiceLog"
  ADD COLUMN IF NOT EXISTS "errorScope" TEXT,
  ADD COLUMN IF NOT EXISTS "orderErrorCount" INTEGER;
