-- ============================================================
-- 09/11/2026 — CHỈ MỤC MỘT PHẦN "OrderItem"("productId")
--
-- Vì sao: khóa ngoại OrderItem.productId → Product(id) là ON DELETE SET NULL. Mỗi dòng
-- "Product" bị xóa, Postgres chạy `UPDATE "OrderItem" SET "productId" = NULL WHERE
-- "productId" = $1`. Cột này chưa từng có chỉ mục → mỗi sản phẩm xóa là MỘT lượt quét
-- cả bảng dòng đơn (prod 09/11: 1.307.156 dòng, 673 MB; EXPLAIN = Parallel Seq Scan,
-- cost 96.693). Lộ ra khi anh Trung bảo xóa cả Tổng kho của một khách (297 sản phẩm =
-- 297 lượt quét, SQL Editor cắt ở 2 phút). Nút xóa SKU trong app (routes/products.ts,
-- xóa lẻ + xóa hàng loạt ≤ 500) chịu đúng lượt quét này.
--
-- Chỉ mục MỘT PHẦN: 93,9 % dòng đơn có productId NULL (gian chưa nối kho) nên chỉ chứa
-- phần đã nối — prod đo sau khi dựng: 824 kB. Câu của khóa ngoại (`"productId" = $1`,
-- toán tử strict) suy ra được IS NOT NULL nên dùng được chỉ mục: EXPLAIN sau khi dựng =
-- Index Scan, cost 52.
--
-- PROD ĐÃ CÓ chỉ mục này từ 09/11/2026 ~09:12 (dựng tay bằng CREATE INDEX CONCURRENTLY ở
-- Supabase SQL Editor, không chặn ghi đơn) → ở prod IF NOT EXISTS bỏ qua. Migration này
-- để repo khớp prod và để DB dev / DB mới có chỉ mục. Prisma không diễn tả được chỉ mục
-- một phần — KHÔNG thêm @@index([productId]) vào model OrderItem (trùng tên, khác nội dung).
--
-- CREATE INDEX (kể cả khi IF NOT EXISTS bỏ qua) vẫn xin khóa SHARE trên bảng nóng
-- "OrderItem" → lấy khóa trước với lock_timeout + thử lại như các migration chỉ mục khác.
-- ============================================================

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "OrderItem" IN SHARE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_item_product_idx: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx"
  ON "OrderItem" ("productId")
  WHERE "productId" IS NOT NULL;
