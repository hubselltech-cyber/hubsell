-- ============================================================
-- 23/10/2026 — KHÁCH XIN HỦY ĐƠN, CHỜ SHOP QUYẾT (cờ riêng trên Order).
-- Shopee IN_CANCEL / TikTok BUYER_CANCEL pending / Lazada reverse CANCEL
-- trước đây hoặc bị ánh xạ thẳng "Đã hủy" hoặc vô hình. Bốn cột NULL thêm
-- vào là tức thời; "Order" bị webhook/worker UPDATE liên tục → lấy khóa có
-- thử lại như các migration trước (gotcha deadlock khi deploy Render).
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
        RAISE NOTICE 'order_cancel_request: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelRequestReason" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelRequestRef" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelRequestDueAt" TIMESTAMP(3);

-- Chỉ mục MỘT PHẦN: đơn đang có yêu cầu hủy là số ít, lọc/đếm theo gian không
-- quét cả bảng (Prisma không mô tả được chỉ mục có điều kiện → SQL tay).
CREATE INDEX IF NOT EXISTS "Order_cancel_request_pending_idx"
  ON "Order" ("channelId")
  WHERE "cancelRequestedAt" IS NOT NULL;
