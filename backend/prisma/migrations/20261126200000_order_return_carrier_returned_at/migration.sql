-- ============================================================
-- 26/11/2026 — MỐC HÃNG VẬN CHUYỂN TRẢ KIỆN GIAO THẤT BẠI VỀ SHOP
-- (docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 19 — anh Trung 26/11/2026: "Làm lát lưu mốc")
--
--   Order.returnCarrierReturnedAt   hãng báo đã trả kiện quay đầu về shop. Mã ghi một lần lúc
--                                   người dùng xem danh sách đơn hoàn và hành trình hãng có mốc
--                                   "đã trả"; có mốc rồi thì thôi hỏi sàn cho đơn đó.
--
-- ADD COLUMN nullable, không DEFAULT → Postgres chỉ sửa metadata, không viết lại bảng; nhưng cần
-- khóa ACCESS EXCLUSIVE trên "Order" (bảng nóng) trong chớp mắt → lấy khóa có lock_timeout + thử
-- lại (bẫy deadlock lúc deploy Render 30/09/2026) — cùng mẫu 20261120230000_order_return_damaged_at.
--
-- KHÔNG chỉ mục mới: bộ lọc luôn đi kèm phạm vi gian + returnStatus = 'AWAITING' (tập nhỏ của
-- từng shop), cột này chỉ là vị từ lọc thêm trên tập đó.
-- KHÔNG điền cho đơn cũ: mốc tự có dần khi dòng được xem (không ghi hàng loạt lên "Order").
-- Sổ cái đơn không đọc cột này → không sửa trigger, không tính lại sổ.
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
        RAISE NOTICE 'order_return_carrier_returned_at: chưa lấy được khóa Order (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "returnCarrierReturnedAt" TIMESTAMP(3);
