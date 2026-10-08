-- Lát T1 luồng tenant (08/10/2026): tờ nháp chờ chủ shop ký trên web nhà cung cấp.
-- Cột đánh dấu dòng PENDING là "tờ nháp đang chờ ký" (khác "tờ chưa rõ kết quả").
-- ADD COLUMN không ghi lại bảng nhưng vẫn cần khóa ACCESS EXCLUSIVE chốc lát; InvoiceLog
-- được worker ghi liên tục nên lấy khóa có thời hạn + thử lại (bẫy deadlock khi deploy).
DO $$
DECLARE attempt INT := 0;
BEGIN
  LOOP
    BEGIN
      attempt := attempt + 1;
      SET LOCAL lock_timeout = '3s';
      LOCK TABLE "InvoiceLog" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF attempt >= 40 THEN
        RAISE;
      END IF;
      RAISE NOTICE 'invoice_awaiting_signature: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
      PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "InvoiceLog" ADD COLUMN IF NOT EXISTS "awaitingSignatureAt" TIMESTAMP(3);
