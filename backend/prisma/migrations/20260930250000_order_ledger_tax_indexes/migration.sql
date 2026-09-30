-- ============================================================
-- SỔ CÁI ĐƠN — chỉ mục cho THUẾ đọc từ sổ (docs/SO-CAI-DON.md mục 9.4).
-- Dựng theo mô hình SHOP LỚN ngay (anh Trung chốt 30/09/2026).
--   1. Tờ khai cắt kỳ theo NGÀY SÀN BÁO GIAO (deliveredDate) trên TOÀN SHOP
--      (lũy kế năm soi ngưỡng 1 tỷ không lọc gian): chỉ mục
--      ("ownerId", "deliveredDate"). Sổ phân mảnh theo ngày TẠO nên truy vấn
--      theo ngày giao không cắt được mảnh — mỗi mảnh phải có lối vào theo ngày
--      giao, nếu không là quét hết đơn của chủ shop. (Đã có sẵn
--      ("channelId", "deliveredDate") cho trường hợp lọc gian.)
--   2. Kiểm "sổ còn dòng tính bằng công thức cũ không" ở MỖI lượt xem báo cáo:
--      chỉ mục ("formulaVersion") để câu kiểm (formulaVersion < hiện tại OR >
--      hiện tại) trả về ngay khi không có dòng nào, thay vì quét cả phạm vi.
--      Mọi dòng cùng một giá trị nên chỉ mục rất gọn (B-tree khử trùng).
-- Chỉ đụng bảng "order_ledger". Cùng khuôn khóa + thử lại với migration
-- 20260930240000; idempotent.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "order_ledger" IN SHARE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_ledger_tax_indexes: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE INDEX IF NOT EXISTS "order_ledger_ownerId_deliveredDate_idx"
  ON "order_ledger" ("ownerId", "deliveredDate");

CREATE INDEX IF NOT EXISTS "order_ledger_formulaVersion_idx"
  ON "order_ledger" ("formulaVersion");
