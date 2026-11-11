-- ============================================================
-- 11/11/2026 — CHỈ MỤC MỘT PHẦN "Order"("channelId") cho tập ĐƠN ĐÃ TRỪ KHO, CHƯA GIAO SHIP
--
-- Vì sao: cột "Chờ giao" ở Tổng kho (docs/TONG-KHO-DANG-GIU-CHO-DON.md) tính từ nhật ký trừ kho
-- của các đơn đã chốt mà chưa giao cho đơn vị vận chuyển. Câu hỏi đi từ tập đơn đó sang
-- "InventoryLog" theo orderId (services/stock-awaiting-ship.ts). Tập này nhỏ (đơn vài ngày gần
-- nhất) nhưng không có chỉ mục thì phải đọc hết đơn của gian. Đo trên DB local bằng dữ liệu giả
-- (1 shop, 400.000 đơn, 8.000 đơn chờ giao): có chỉ mục 65 ms / ~160 trang đĩa; không có 204 ms /
-- 9.294 trang đĩa.
--
-- Vị từ PHẢI khớp từng chữ với AWAITING_ORDER trong services/stock-awaiting-ship.ts — lệch là
-- planner không dùng chỉ mục. Prisma không diễn tả được chỉ mục một phần → chỉ ghi chú ở model Order.
--
-- ⚠️ PROD: bảng "Order" lớn và đang ghi liên tục. CREATE INDEX thường giữ khóa SHARE suốt lúc dựng
-- → chặn ghi đơn. TRƯỚC KHI PUSH phải dựng tay ở Supabase SQL Editor, ngoài giờ cao điểm:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_stock_awaiting_ship_idx" ON "Order" ("channelId")
--     WHERE "shippingStatus" IN ('PENDING','PROCESSED') AND "stockRestoredAt" IS NULL AND "stockDeductedAt" IS NOT NULL;
-- Khi đó ở prod IF NOT EXISTS bỏ qua (cùng cách với 20261109091500_order_item_product_idx).
--
-- CREATE INDEX (kể cả khi IF NOT EXISTS bỏ qua) vẫn xin khóa SHARE trên bảng nóng "Order" → lấy
-- khóa trước với lock_timeout + thử lại như các migration chỉ mục khác.
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
        RAISE NOTICE 'order_stock_awaiting_ship_idx: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE INDEX IF NOT EXISTS "Order_stock_awaiting_ship_idx"
  ON "Order" ("channelId")
  WHERE "shippingStatus" IN ('PENDING','PROCESSED') AND "stockRestoredAt" IS NULL AND "stockDeductedAt" IS NOT NULL;
