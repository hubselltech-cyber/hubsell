-- ============================================================
-- 23/11/2026 — HẠN KHIẾU NẠI ĐƠN HOÀN do sàn trả (lát 1)
-- (docs/HAN-KHIEU-NAI-DON-HOAN.md mục 8 — anh Trung duyệt 23/11/2026)
--
--   Order.returnComplaintDueAt           hạn người bán kiểm kiện trả + khiếu nại, nguyên văn của sàn
--                                        (Shopee return_seller_due_date, TikTok hạn nhận kiện 48 giờ)
--   Order.returnComplaintDueProvisional  true = hạn TẠM của Shopee lúc kiện còn trên đường
--
-- ADD COLUMN nullable / có DEFAULT hằng số → Postgres chỉ sửa metadata, không viết lại bảng; nhưng
-- cần khóa ACCESS EXCLUSIVE trên "Order" (bảng nóng) trong chớp mắt → lấy khóa có lock_timeout +
-- thử lại (cùng khuôn 20261120230000_order_return_damaged_at). KHÔNG điền cho đơn cũ: lượt đồng bộ
-- yêu cầu hoàn kế tiếp tự ghi cho yêu cầu còn biến động. CHƯA có chỉ mục — chỉ mục cho thẻ lọc
-- "Sắp hết hạn" dựng CONCURRENTLY ở lát giao diện.
-- Sổ cái đơn không đọc hai cột này (trigger order_ledger có danh sách cột riêng) → không tính lại sổ.
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
        RAISE NOTICE 'order_return_complaint_due: chưa lấy được khóa Order (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "returnComplaintDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnComplaintDueProvisional" BOOLEAN NOT NULL DEFAULT false;
