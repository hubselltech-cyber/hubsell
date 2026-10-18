-- 18/10/2026 — Lát 1a của docs/MO-HINH-CAY-SAN-PHAM-SAN.md: dòng đơn mang ID LÁ SÀN.
--
-- OrderItem.externalId          id phân loại lá ("item-leaf"; SP đơn Shopee "item") — danh tính thật của dòng đơn
-- order_line_ledger.externalId  chép từ OrderItem khi tính sổ
-- order_line_ledger.itemId      SPU (phần trước dấu "-") — cột riêng để câu gom JOIN thẳng
--
-- Chỉ THÊM cột NULL, không xóa, không đổi tiền (không tăng LEDGER_FORMULA_VERSION).
-- Prod 18/10: OrderItem 214 nghìn dòng / 116 MB → ADD COLUMN NULL là siêu dữ liệu,
-- chỉ mục thường xây trong giây. order_line_ledger phân mảnh theo tháng: ALTER cha
-- lan xuống mọi mảnh, CREATE INDEX trên cha tự tạo trên từng mảnh và tự gắn cho
-- mảnh tạo sau (order_ledger_create_month_partition dùng PARTITION OF / ATTACH).
--
-- ALTER TABLE cần ACCESS EXCLUSIVE chốc lát trên bảng nóng; migration chạy lúc
-- Render khởi động song song instance cũ đang ghi đơn (bẫy deadlock 30/09/2026)
-- → lấy khóa trước, có thử lại, rồi mới ALTER. Ghi đơn của app chờ tối đa vài giây.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "OrderItem", "order_line_ledger" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_item_external_id: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE INDEX IF NOT EXISTS "OrderItem_externalId_idx" ON "OrderItem"("externalId");

ALTER TABLE "order_line_ledger"
  ADD COLUMN IF NOT EXISTS "externalId" TEXT,
  ADD COLUMN IF NOT EXISTS "itemId" TEXT;
CREATE INDEX IF NOT EXISTS "order_line_ledger_channelId_itemId_idx" ON "order_line_ledger"("channelId", "itemId");
