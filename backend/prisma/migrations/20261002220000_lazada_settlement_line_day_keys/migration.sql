-- ============================================================
-- SAO KÊ LAZADA: LƯU CÁC NGÀY GIAO DỊCH ĐÃ CỘNG VÀO SAO KÊ CỦA ĐƠN (02/10/2026).
--
-- Cùng lỗi với TikTok (migration 20261002210000): lượt đối soát theo nhịp chỉ
-- đọc sao kê 7 ngày gần nhất rồi GHI ĐÈ cả sao kê của đơn bằng riêng các dòng nó
-- thấy. Đơn có dòng bán một ngày và dòng đảo / hoàn hơn một tuần sau → sao kê
-- chỉ còn dòng đảo. Prod 02/10 mới có 5 dòng sao kê Lazada, chưa thấy đơn hỏng;
-- sửa cùng đợt để ba sàn theo một quy tắc (integrations/settlement-merge.ts).
--
-- "lineDayKeys" = các ngày giao dịch đã cộng vào sao kê, dạng "ngày#số dòng".
-- Dòng có sẵn đọc ra mảng rỗng = "chưa biết gồm những dòng nào" → lần kế đơn đó
-- xuất hiện trong lượt quét, Hubsell đọc trọn giao dịch của đơn rồi ghi lại.
--
-- ADD COLUMN có DEFAULT hằng: Postgres chỉ sửa danh mục, không ghi lại bảng.
-- Cần khóa ACCESS EXCLUSIVE trong tích tắc → lấy khóa trước, lock_timeout 5s,
-- thử lại (khuôn 20260930230000_order_ledger). Chỉ đụng MỘT bảng.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "lazada_order_settlements" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'lazada_settlement_line_day_keys: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "lazada_order_settlements"
  ADD COLUMN IF NOT EXISTS "lineDayKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
