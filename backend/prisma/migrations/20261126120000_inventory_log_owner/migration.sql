-- ============================================================
-- 26/11/2026 — KHO CHUẨN QUỐC TẾ, BỊT LỖ QUY MÔ TRƯỚC KHI MỞ CHO MỌI SHOP
-- (docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 20 + 21)
--
-- "InventoryLog" không có cột chủ shop → mọi câu "nhật ký của shop này" phải lọc qua quan hệ
-- Product. Đo prod 26/11: trang đầu Nhật ký kho của shop 5.702 mã đi lùi chỉ mục ngày của CẢ bảng
-- qua 22.453 dòng của shop khác (37.879 khối) để lấy 20 dòng — đúng dạng câu danh sách đơn đã làm
-- cạn Disk IO 25/11. Thêm:
--   InventoryLog.ownerId                 chủ shop của dòng (= Product.userId)
--   trigger inventory_log_owner_trg      BEFORE INSERT tự điền ownerId khi nơi ghi không truyền →
--                                        không đường ghi nào (kể cả bản cũ đang chạy lúc deploy)
--                                        tạo được dòng thiếu chủ; hàng rào ở database, không ở trí nhớ
--   InventoryLog_owner_created_idx       (ownerId, createdAt, id)  — danh sách + đếm Nhật ký kho
--   InventoryLog_owner_manual_idx        (ownerId, createdAt) WHERE orderId IS NULL — báo cáo
--                                        "Hàng hỏng, mất & chênh kiểm kê"
--   InventoryLog_owner_restore_idx       (ownerId, createdAt) dòng CỘNG LẠI của đơn hủy sau khi rời
--                                        kho — dòng "N sản phẩm chưa về kho" ở Tổng kho
--
-- ⚠️ "InventoryLog" có trigger sổ cái AFTER INSERT OR UPDATE OR DELETE (order_ledger_on_inventory_log):
-- mỗi dòng gắn đơn bị UPDATE là một lượt đánh dấu tính lại sổ của đơn đó. Điền ownerId cho dòng cũ
-- KHÔNG đổi con số nào của sổ → trên PROD phải điền TAY trước khi push, theo lô, với
--   SET LOCAL session_replication_role = replica   (tắt trigger trong đúng giao dịch đó)
-- Khi đó lệnh UPDATE ở cuối tệp này không còn dòng nào để sửa. Trên database dev lệnh UPDATE chạy
-- bình thường (trigger sổ cái chạy theo, vô hại).
--
-- ⚠️ PROD: ba chỉ mục dựng tay CONCURRENTLY trước khi push (bảng 64 MB, vài giây mỗi cái), kiểm
-- indisvalid; ba lệnh IF NOT EXISTS dưới đây bỏ qua trên prod.
-- ============================================================

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
        RAISE NOTICE 'inventory_log_owner: chưa lấy được khóa InventoryLog (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "InventoryLog" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;

CREATE OR REPLACE FUNCTION "inventory_log_set_owner"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."ownerId" IS NULL THEN
    SELECT p."userId" INTO NEW."ownerId" FROM "Product" p WHERE p."id" = NEW."productId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER "inventory_log_owner_trg"
  BEFORE INSERT ON "InventoryLog"
  FOR EACH ROW EXECUTE FUNCTION "inventory_log_set_owner"();

UPDATE "InventoryLog" il
   SET "ownerId" = p."userId"
  FROM "Product" p
 WHERE p."id" = il."productId" AND il."ownerId" IS NULL;

CREATE INDEX IF NOT EXISTS "InventoryLog_owner_created_idx"
  ON "InventoryLog" ("ownerId", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "InventoryLog_owner_manual_idx"
  ON "InventoryLog" ("ownerId", "createdAt")
  WHERE "orderId" IS NULL;

CREATE INDEX IF NOT EXISTS "InventoryLog_owner_restore_idx"
  ON "InventoryLog" ("ownerId", "createdAt")
  WHERE "orderId" IS NOT NULL AND "changeQuantity" > 0 AND ("kind" IS NULL OR "kind" = 'RETURN');
