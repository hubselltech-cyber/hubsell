-- ============================================================
-- GIÁ VỐN THEO GIAN (anh Trung chốt 11/10/2026)
--
-- Từ bản này giá vốn hiệu lực của một SKU sàn = giá RIÊNG CỦA GIAN
-- (ChannelProduct.costPrice > 0), không có thì giá MẶC ĐỊNH của sản phẩm kho
-- đã nối (Product.costPrice) — xem lib/cost-price.ts effectiveSkuCost.
--
-- Trước bản này, SKU ĐÃ nối kho luôn lấy giá kho, cột ChannelProduct.costPrice
-- của nó bị bỏ qua — chỉ còn là giá sót lại từ hồi chưa nối (khi nối, giá đó
-- đã được chép lên kho nếu kho đang 0). Để quy tắc mới KHÔNG đổi giá vốn đang
-- dùng của bất kỳ khách nào, xóa giá sót đó: dòng đã nối kho về "chưa có giá
-- riêng" → tiếp tục theo giá kho y như trước. SKU chưa nối kho không đụng.
--
-- Không có trigger sổ cái trên "ChannelProduct" (sổ chỉ bắt Product.costPrice)
-- và đơn cũ giữ nguyên ảnh chụp OrderItem.costPriceAtSale → báo cáo không đổi.
--
-- Chỉ khóa dòng (UPDATE), không khóa bảng; vẫn để lock_timeout + thử lại phòng
-- khi worker đồng bộ danh mục đang ghi đúng các dòng đó (bẫy deadlock 30/09).
-- Chạy lại vô hại (idempotent).
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      UPDATE "ChannelProduct"
      SET "costPrice" = NULL
      WHERE "productId" IS NOT NULL
        AND "costPrice" IS NOT NULL;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      attempt := attempt + 1;
      IF attempt >= 40 THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(3);
    END;
  END LOOP;
END $$;
