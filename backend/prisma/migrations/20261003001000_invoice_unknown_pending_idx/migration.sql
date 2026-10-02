-- ============================================================
-- HÓA ĐƠN BƯỚC 5, LÁT 6b: chỉ mục cho vòng quét "tờ chưa rõ kết quả" (03/10/2026).
--
-- Vòng quét (workers/invoice-unknown-recheck.ts) mỗi phút tìm các dòng nhật ký
-- hóa đơn ĐANG CHỜ mà CHƯA có mã tra cứu của nhà cung cấp: tờ gửi đi không nhận
-- được câu trả lời rõ, hoặc tiến trình chết giữa lúc gọi. Bảng InvoiceLog chưa có
-- chỉ mục nào tìm được các dòng này mà không đi qua mọi dòng đã phát hành / đã
-- hỏng của mọi shop.
--
-- Chỉ mục RIÊNG PHẦN: chỉ chứa dòng đang chờ chưa có mã tra cứu, tức lúc bình
-- thường gần như rỗng (prod 02/10/2026: 0 dòng như vậy, cả bảng 2 dòng).
--
-- Chỉ đụng MỘT bảng là InvoiceLog (bảng này chỉ luồng hóa đơn ghi). CREATE INDEX
-- cần khóa SHARE: lấy khóa trước với lock_timeout 5s và thử lại, theo khuôn
-- 20260930230000_order_ledger, để migration không hỏng giữa chừng lúc đưa lên.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "InvoiceLog" IN SHARE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'invoice_unknown_pending_idx: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE INDEX IF NOT EXISTS "InvoiceLog_unknown_pending_idx" ON "InvoiceLog" ("createdAt")
  WHERE "status" = 'PENDING' AND "transactionId" IS NULL;
