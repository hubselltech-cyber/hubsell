-- ============================================================
-- 20/11/2026 — THẤT THU HÀNG MẤT/HỎNG GHI THEO NGÀY BÁO HỎNG
-- (docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 17 — anh Trung chốt 20/11/2026)
--
--   Order.returnDamagedAt      mốc kho báo hỏng / mất kiện hoàn (mã ghi lúc đổi sang DAMAGED)
--   Order_return_damaged_idx   đơn kho đã báo hỏng / xóa sổ theo gian — câu đọc dòng Thất thu
--                              đi từ tập nhỏ này rồi mới nối sang sổ cái
--
-- ADD COLUMN nullable → Postgres chỉ sửa metadata, không viết lại bảng; nhưng cần khóa ACCESS
-- EXCLUSIVE trên "Order" (bảng nóng) trong chớp mắt → lấy khóa có lock_timeout + thử lại (bẫy
-- deadlock lúc deploy Render 30/09/2026). KHÔNG điền mốc cho đơn cũ: câu đọc tự lùi về
-- returnedAt rồi createdAt khi cột trống (không ghi hàng loạt lên "Order" trong migration).
-- Sổ cái đơn không đọc cột này → không sửa trigger, không tính lại sổ.
--
-- ⚠️ PROD: CREATE INDEX thường (không CONCURRENTLY) giữ khóa chặn GHI trên "Order" suốt lúc đọc
-- hết bảng — và ở đây còn nằm sau khóa ACCESS EXCLUSIVE (chặn cả ĐỌC). TRƯỚC KHI PUSH phải chạy
-- tay ở Supabase SQL Editor, ngoài giờ cao điểm:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_return_damaged_idx"
--     ON "Order" ("channelId") WHERE "returnStatus" IN ('DAMAGED', 'WRITTEN_OFF');
-- rồi kiểm indisvalid = true. Khi đó lệnh IF NOT EXISTS dưới đây bỏ qua trên prod.
--
-- Vị từ chỉ mục PHẢI khớp từng chữ với damagedLossWhereSql trong lib/damaged-loss.ts.
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
        RAISE NOTICE 'order_return_damaged_at: chưa lấy được khóa Order (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "returnDamagedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_return_damaged_idx"
  ON "Order" ("channelId")
  WHERE "returnStatus" IN ('DAMAGED', 'WRITTEN_OFF');
