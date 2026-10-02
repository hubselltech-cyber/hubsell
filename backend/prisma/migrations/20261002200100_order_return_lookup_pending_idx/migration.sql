-- ============================================================
-- QUÉT BÙ YÊU CẦU HOÀN THEO MÃ ĐƠN (02/10/2026), bước 2/2: chỉ mục tìm đơn chờ hỏi.
--
-- Chỉ mục MỘT PHẦN: chỉ chứa đơn chưa đọc yêu cầu hoàn, không hủy, và có tiền
-- hoàn trên bản kê hoặc đã ghi mốc kiện hoàn về — vài phần trăm số đơn, đơn nào
-- hỏi sàn xong (returnLookupAt có giá trị) là rời chỉ mục. Câu tìm trong
-- integrations/tiktok/returns-sync.ts (backfillTiktokReturnsByOrder) viết
-- NGUYÊN VĂN điều kiện này để Postgres dùng được chỉ mục.
--
-- CREATE INDEX thường (không CONCURRENTLY vì Prisma bọc migration trong một
-- transaction) cần khóa SHARE: chặn GHI đơn trong lúc dựng, đọc vẫn chạy. Đã
-- đếm trên prod 02/10/2026 ~17:40: bảng "Order" khoảng 46.100 dòng, 28 MB; chỉ
-- mục sẽ chứa khoảng 1.200 đơn → một lượt đọc bảng 28 MB, ước dưới vài giây
-- (CHƯA đo thời gian dựng thật). Lấy khóa trước với lock_timeout + thử lại như
-- bước 1.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Order" IN SHARE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_return_lookup_pending_idx: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE INDEX IF NOT EXISTS "Order_return_lookup_pending_idx"
  ON "Order" ("channelId", "createdAt")
  WHERE "returnLookupAt" IS NULL
    AND "shippingStatus" <> 'CANCELLED'
    AND ("refundedAmount" > 0 OR "returnDeliveredAt" IS NOT NULL);
