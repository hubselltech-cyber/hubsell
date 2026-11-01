-- ============================================================
-- 01/11/2026 — TRẠNG THÁI NỘI BỘ "ĐÃ ĐÓNG GÓI" + BIÊN BẢN BÀN GIAO CHO SHIP
-- (khách dùng Ship Xanh đề nghị). Seller in phiếu → gói → QUÉT lại kiện:
-- Order.packingDoneAt ghi mốc, đơn đã hủy bị chặn ngay lúc quét để không đưa
-- ship. Bấm "In biên bản bàn giao" → mỗi hãng vận chuyển một dòng
-- handover_sheets, Order.handoverSheetId trỏ về. Không gọi sàn, không đổi
-- shippingStatus. Hai cột NULL thêm vào Order là tức thời; "Order" bị
-- webhook/worker UPDATE liên tục → lấy khóa có thử lại (gotcha deadlock Render).
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
        RAISE NOTICE 'order_packing_handover_sheet: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "packingDoneAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "handoverSheetId" TEXT;

-- Chỉ mục MỘT PHẦN: đơn đã đóng gói mà chưa lên biên bản là tập nhỏ (hàng đang
-- nằm ở shop chờ ship), trang Đóng gói hỏi tập này liên tục → không quét bảng.
CREATE INDEX IF NOT EXISTS "Order_packing_pending_handover_idx"
  ON "Order" ("channelId")
  WHERE "packingDoneAt" IS NOT NULL AND "handoverSheetId" IS NULL;

CREATE TABLE IF NOT EXISTS "handover_sheets" (
  "id"           TEXT NOT NULL,
  "ownerId"      TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "carrier"      "Carrier",
  "carrierLabel" TEXT NOT NULL,
  "orderCount"   INTEGER NOT NULL,
  "orders"       JSONB NOT NULL DEFAULT '[]',
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "handover_sheets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "handover_sheets_ownerId_code_key" ON "handover_sheets" ("ownerId", "code");
CREATE INDEX IF NOT EXISTS "handover_sheets_ownerId_createdAt_idx" ON "handover_sheets" ("ownerId", "createdAt");

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "handover_sheets" ENABLE ROW LEVEL SECURITY;
