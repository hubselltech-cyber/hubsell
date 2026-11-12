-- ============================================================
-- 12/11/2026 — KHO CHUẨN QUỐC TẾ, LÁT 1 CHẠY BÓNG (docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 13)
--
-- Thêm bộ đếm "đang giữ cho đơn đã chốt, hàng chưa rời kho" và mốc rời kho trên đơn. CHƯA màn
-- nào đọc, số đẩy sàn không dùng: lát này chỉ để bộ đếm chạy song song và được đối chiếu hằng đêm
-- với câu "Chờ giao" (services/stock-awaiting-ship.ts) trước khi đổi cách hiển thị.
--
--   Product.committedQuantity        hàng đã trừ khỏi quantityInStock cho đơn đã chốt, còn trong kho
--   product_stock_levels.committed   như trên, theo vị trí
--   Order.stockCommittedAt           đơn đang nằm trong bộ đếm giữ (mốc riêng — đơn cũ đã giao
--                                    trước ngày chuyển không bao giờ vào bộ đếm); đơn hủy khi hàng
--                                    chưa rời kho thì mốc này bị XÓA (nhả giữ)
--   Order.stockShippedAt / stockShipSource   hàng đã rời kho + ai báo (HANDOVER | PLATFORM |
--                                    CHANNEL_INACTIVE)
--
-- Mọi cột là ADD COLUMN có DEFAULT hằng hoặc nullable → Postgres chỉ sửa metadata, không viết lại
-- bảng. Vẫn cần khóa ACCESS EXCLUSIVE chớp nhoáng trên ba bảng nóng → lấy CẢ BA trong MỘT lệnh
-- LOCK (thứ tự cố định, lock_timeout + thử lại; hụt giữa chừng thì khối con nhả hết rồi thử lại)
-- để không thể deadlock với giao dịch webhook đang giữ dòng "Order" chờ ghi "Product"
-- (bẫy deploy Render 30/09/2026).
--
-- ⚠️ PROD: chỉ mục một phần dưới đây phải đọc hết bảng "Order" (~500 MB) nếu dựng trong migration,
-- trong lúc đang giữ khóa → chặn đơn. TRƯỚC KHI PUSH phải chạy tay ở Supabase SQL Editor, ngoài
-- giờ cao điểm, theo đúng thứ tự:
--   1) ba lệnh ALTER TABLE … ADD COLUMN IF NOT EXISTS bên dưới (từng lệnh, SET lock_timeout = '5s');
--   2) CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_stock_committed_idx" ON "Order" ("channelId")
--        WHERE "stockCommittedAt" IS NOT NULL AND "stockShippedAt" IS NULL;
-- Khi đó ở prod mọi lệnh IF NOT EXISTS trong tệp này bỏ qua.
--
-- Vị từ chỉ mục PHẢI khớp từng chữ với COMMITTED_ORDER trong services/stock-committed.ts.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Order", "Product", "product_stock_levels" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'stock_committed_shadow: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "committedQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "product_stock_levels" ADD COLUMN IF NOT EXISTS "committed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "stockCommittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockShippedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockShipSource" TEXT;

CREATE INDEX IF NOT EXISTS "Order_stock_committed_idx"
  ON "Order" ("channelId")
  WHERE "stockCommittedAt" IS NOT NULL AND "stockShippedAt" IS NULL;
