-- ============================================================
-- 05/11/2026 — MÃ VẠCH QUẢN LÝ của sản phẩm kho (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.2)
-- Anh Trung: "Sản phẩm trong tổng kho là sản phẩm riêng… cần có mã quản lý để kho quét hàng";
-- "khách cần sinh ra cái mã vạch quản lý đó"; chốt 13 số (chuẩn EAN-13).
--   · product_barcode_seq + product_new_barcode(): mã 13 số = "2" + 11 số thứ tự + 1 số kiểm tra
--     EAN-13. Đầu số 200–299 là khoảng "mã lưu hành hạn chế" của GS1 — không cấp cho nhà sản xuất
--     nên không trùng mã in sẵn trên bao bì.
--   · "Product"."barcode": DEFAULT gọi hàm trên → MỌI cửa tạo sản phẩm kho (tạo mới, sao chép từ
--     sàn, Excel, tự khớp + tạo SKU) tự có mã, không phải sửa từng nơi. Khách sửa tay được (hàng có
--     sẵn mã nhà sản xuất).
--   · Chỉ mục duy nhất MỘT PHẦN (userId, barcode) WHERE barcode IS NOT NULL — lúc tạo chưa dòng nào
--     có mã nên dựng tức thời, không quét cả bảng.
-- Sản phẩm CŨ: ADD COLUMN không kèm DEFAULT (kèm DEFAULT hàm VOLATILE là viết lại cả bảng dưới
-- khóa ACCESS EXCLUSIVE) → cột NULL, điền sau theo lô bằng scripts/backfill-product-barcode.ts.
-- "Product" là bảng nóng (đơn về trừ tồn liên tục) → lấy khóa có thử lại (gotcha deadlock Render).
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Product" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'product_barcode: chưa lấy được khóa Product (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

-- 11 chữ số thứ tự: hết dãy thì báo lỗi chứ không quay vòng (quay vòng = sinh mã trùng).
CREATE SEQUENCE IF NOT EXISTS public."product_barcode_seq" AS BIGINT
  START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 99999999999 NO CYCLE;

CREATE OR REPLACE FUNCTION public.product_new_barcode() RETURNS TEXT
LANGUAGE plpgsql VOLATILE
SET search_path = public
AS $$
DECLARE
  body  TEXT;
  total INTEGER := 0;
BEGIN
  body := '2' || lpad(nextval('public.product_barcode_seq')::TEXT, 11, '0');
  -- Số kiểm tra EAN-13: vị trí lẻ (từ trái) nhân 1, vị trí chẵn nhân 3.
  FOR i IN 1..12 LOOP
    total := total + substr(body, i, 1)::INTEGER * (CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END);
  END LOOP;
  RETURN body || ((10 - total % 10) % 10)::TEXT;
END;
$$;

-- Supabase mở mọi hàm schema public qua PostgREST: chặn gọi từ ngoài (ai gọi cũng đốt số thứ tự).
-- Backend đi Prisma bằng vai trò chủ sở hữu nên không ảnh hưởng. Vai trò anon / authenticated chỉ
-- có trên Supabase, DB dev trên máy không có → kiểm trước khi REVOKE.
REVOKE ALL ON FUNCTION public.product_new_barcode() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.product_new_barcode() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.product_new_barcode() FROM authenticated;
  END IF;
END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
ALTER TABLE "Product" ALTER COLUMN "barcode" SET DEFAULT public.product_new_barcode();

CREATE UNIQUE INDEX IF NOT EXISTS "Product_userId_barcode_key"
  ON "Product" ("userId", "barcode") WHERE "barcode" IS NOT NULL;
