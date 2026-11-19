-- ============================================================
-- 20/11/2026 — KHO CHUẨN QUỐC TẾ, LÁT 2 + 3 (docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 15)
--
--   shop_sync_settings.stockModel       LEGACY | ON_HAND — cách hiển thị + cửa ghi tồn của shop
--   shop_sync_settings.restockOnReturn  ON_CANCEL | ON_RECEIVE — đơn hủy sau khi hàng rời kho thì
--                                       cộng lại tồn lúc sàn báo hủy hay lúc kho nhận kiện
--   InventoryLog.kind / heldChange / heldAfter / onHandAfter — ba ngăn số của Nhật ký kho
--   Order_return_awaiting_idx           đơn đang "Chờ hàng về" theo gian
--   InventoryLog_manual_idx             dòng nhật ký TAY (không gắn đơn) theo SKU + ngày — báo cáo
--                                       "Hàng hỏng, mất & chênh kiểm kê" (lát 4)
--
-- Mọi cột là ADD COLUMN nullable hoặc có DEFAULT hằng → Postgres chỉ sửa metadata, không viết lại
-- bảng. "InventoryLog" nằm trên đường nóng của webhook đơn (mỗi lần trừ kho một dòng) → lấy khóa
-- có lock_timeout + thử lại (bẫy deadlock lúc deploy Render 30/09/2026). Mặc định của hai cột cài
-- đặt là hành vi CŨ → ngày lên bản không shop nào đổi số.
--
-- ⚠️ PROD: CREATE INDEX thường giữ khóa chặn GHI trên "Order" suốt lúc đọc hết bảng (~500 MB).
-- TRƯỚC KHI PUSH phải chạy tay ở Supabase SQL Editor, ngoài giờ cao điểm
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_return_awaiting_idx"
--     ON "Order" ("channelId") WHERE "returnStatus" = 'AWAITING'
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "InventoryLog_manual_idx"
--     ON "InventoryLog" ("productId", "createdAt") WHERE "orderId" IS NULL
-- rồi kiểm indisvalid = true cho CẢ HAI. Khi đó hai lệnh IF NOT EXISTS dưới đây bỏ qua trên prod.
-- ============================================================

ALTER TABLE "shop_sync_settings"
  ADD COLUMN IF NOT EXISTS "stockModel" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS "restockOnReturn" TEXT NOT NULL DEFAULT 'ON_CANCEL';

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "InventoryLog" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'stock_on_hand_model: chưa lấy được khóa InventoryLog (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "InventoryLog"
  ADD COLUMN IF NOT EXISTS "kind" TEXT,
  ADD COLUMN IF NOT EXISTS "heldChange" INTEGER,
  ADD COLUMN IF NOT EXISTS "heldAfter" INTEGER,
  ADD COLUMN IF NOT EXISTS "onHandAfter" INTEGER;

CREATE INDEX IF NOT EXISTS "Order_return_awaiting_idx"
  ON "Order" ("channelId")
  WHERE "returnStatus" = 'AWAITING';

CREATE INDEX IF NOT EXISTS "InventoryLog_manual_idx"
  ON "InventoryLog" ("productId", "createdAt")
  WHERE "orderId" IS NULL;
