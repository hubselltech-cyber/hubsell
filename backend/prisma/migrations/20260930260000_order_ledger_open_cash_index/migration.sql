-- ============================================================
-- SỔ CÁI ĐƠN — chỉ mục cho BẢNG PHÂN BỔ DÒNG TIỀN THEO GIAN đọc từ sổ
-- (docs/SO-CAI-DON.md mục 9.5). Bảng này KHÔNG lọc kỳ: cộng "Tổng tiền" sàn
-- báo của MỌI đơn chưa quyết toán đang giao / đã giao, từ trước tới nay, theo
-- gian. Đơn loại này luôn là phần rất nhỏ của sổ (vài ngày đến vài tuần gần
-- nhất) nên dùng chỉ mục CỤC BỘ: shop vài trăm nghìn đơn/tháng chỉ chạm đúng
-- các đơn còn treo, không quét lịch sử.
-- Câu đọc phải viết ĐÚNG điều kiện này để Postgres chọn chỉ mục.
-- Chỉ đụng bảng "order_ledger"; cùng khuôn khóa + thử lại; idempotent.
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
        RAISE NOTICE 'order_ledger_open_cash_index: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE INDEX IF NOT EXISTS "order_ledger_open_cash_idx"
  ON "order_ledger" ("ownerId", "channelId")
  WHERE NOT "isSettled" AND "shippingStatus" IN ('SHIPPING', 'DELIVERED');
