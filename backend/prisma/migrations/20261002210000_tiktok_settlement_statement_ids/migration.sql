-- ============================================================
-- SAO KÊ TIKTOK: LƯU MỌI BẢN KÊ ĐÃ CỘNG VÀO SAO KÊ CỦA ĐƠN (02/10/2026), bước 1/2.
--
-- Sự cố: lượt đối soát theo nhịp chỉ đọc bản kê 7 ngày gần nhất rồi GHI ĐÈ cả
-- sao kê của đơn bằng riêng các dòng nó thấy. Đơn có dòng BÁN ở một bản kê và
-- dòng HOÀN ở bản kê sau đó hơn một tuần → sao kê chỉ còn dòng hoàn, tiền quyết
-- toán âm gần bằng giá bán (prod 02/10: 43 đơn / 5 gian, lỗ ảo khoảng 11,55 triệu).
--
-- "statementIds" = danh sách bản kê có dòng của đơn đã cộng vào sao kê. Lượt quét
-- so danh sách này với các bản kê nó thấy để biết phải đọc lại bản kê cũ nào
-- (integrations/tiktok/service.ts, planTiktokSettlementWrite).
--
-- ADD COLUMN có DEFAULT hằng: Postgres chỉ sửa danh mục, không ghi lại bảng;
-- dòng có sẵn đọc ra mảng rỗng (= "chỉ biết bản kê ghi sau cùng ở statementId").
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
      LOCK TABLE "tiktok_order_settlements" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'tiktok_settlement_statement_ids: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "tiktok_order_settlements"
  ADD COLUMN IF NOT EXISTS "statementIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
