-- ============================================================
-- HÓA ĐƠN BƯỚC 5, LÁT 12: hỏi trạng thái cơ quan thuế theo "giờ hỏi kế tiếp"
-- (03/10/2026, anh Trung duyệt 7 điểm kế hoạch 03/10).
--
-- 1. Cột mới "cqtNextCheckAt" trên InvoiceLog, cho phép NULL (NULL = không cần hỏi nữa).
-- 2. Gán giờ hỏi = ngay bây giờ cho các tờ ĐANG phải theo: có mã tra cứu, đang chờ hoặc
--    đã phát hành, trừ tờ đã được cơ quan thuế tiếp nhận quá 7 ngày. Viết bằng
--    IS DISTINCT FROM vì "cqtStatus" của tờ chưa hỏi lần nào là NULL (bản nháp ở
--    docs/HANG-DOI-BEN.md mục 4.6 C dùng NOT (... = 'ACCEPTED' AND ...) sẽ bỏ sót đúng
--    các tờ đó).
-- 3. Chỉ mục riêng phần chỉ chứa tờ còn phải hỏi, xếp theo giờ hỏi: vòng quét đọc MỘT
--    câu cho mọi shop, không đi qua tờ đã có kết luận. (Bản nháp mục 4.6 C xếp theo
--    (ownerId, cqtNextCheckAt); đổi vì vòng quét lấy dòng tới hạn của MỌI shop theo giờ.)
--
-- ALTER TABLE ADD COLUMN cột NULL chỉ sửa catalog nhưng cần khóa ACCESS EXCLUSIVE trong
-- chốc lát: lấy khóa trước với lock_timeout 5s và thử lại (khuôn lát 7,
-- 20261003120000_invoice_order_error_count). Chỉ đụng MỘT bảng InvoiceLog
-- (prod 03/10/2026: 2 dòng, 1 dòng sẽ được gán giờ hỏi).
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
        RAISE NOTICE 'invoice_cqt_next_check: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "InvoiceLog" ADD COLUMN IF NOT EXISTS "cqtNextCheckAt" TIMESTAMP(3);

UPDATE "InvoiceLog" SET "cqtNextCheckAt" = CURRENT_TIMESTAMP
WHERE "cqtNextCheckAt" IS NULL
  AND "transactionId" IS NOT NULL
  AND "status" IN ('PENDING', 'ISSUED')
  AND ("cqtStatus" IS DISTINCT FROM 'ACCEPTED' OR "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '7 days');

CREATE INDEX IF NOT EXISTS "InvoiceLog_cqt_due_idx" ON "InvoiceLog" ("cqtNextCheckAt")
  WHERE "cqtNextCheckAt" IS NOT NULL;
