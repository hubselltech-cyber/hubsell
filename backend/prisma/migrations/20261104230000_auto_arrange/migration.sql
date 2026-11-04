-- ============================================================
-- 04/11/2026 — TỰ CHUẨN BỊ HÀNG THEO GIAN (docs/TU-CHUAN-BI-HANG.md)
-- Công tắc trên Channel; cờ thử / chặn trên Order; nguồn lượt trên
-- fulfillment_batches. Hàng việc cho worker là dòng sync_cursors stream
-- "auto-arrange" (bảng có sẵn, không đổi). Mọi cột mới NULL / có default nên
-- ADD COLUMN tức thời; "Order" và "Channel" bị webhook/worker UPDATE liên tục →
-- lấy khóa có thử lại (gotcha deadlock Render).
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Order" IN ACCESS EXCLUSIVE MODE;
      LOCK TABLE "Channel" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'auto_arrange: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "autoArrangeEnabledAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "autoArrangeTriedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "autoArrangeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "autoArrangeBlockedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "autoArrangeBlockedReason" TEXT;

-- Tập "Chờ xử lý của một gian" nhỏ; máy quét tập này mỗi lượt, bảng đơn và
-- phiếu bốc hàng cũng lọc theo cặp này → không quét cả bảng ở gian lớn.
CREATE INDEX IF NOT EXISTS "Order_auto_arrange_pending_idx"
  ON "Order" ("channelId", "createdAt")
  WHERE "shippingStatus" = 'PENDING';

ALTER TABLE "fulfillment_batches" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'MANUAL';
