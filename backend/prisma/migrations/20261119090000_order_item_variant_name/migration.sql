-- 19/11/2026 — dòng đơn mang TÊN PHÂN LOẠI sàn in lúc bán (khách không đặt SKU kêu 18/11:
-- màn "Quét xem chi tiết đơn" in dãy id sàn, tên phân loại bị cắt ở đuôi tên sản phẩm).
--
-- OrderItem.variantName  nguyên văn TikTok sku_name / Shopee model_name / Lazada variation.
--
-- Chỉ THÊM một cột NULL: là siêu dữ liệu, không ghi lại dòng nào, không chỉ mục (cột chỉ
-- để hiện, không lọc / gom theo nó), không đổi tiền (không tăng LEDGER_FORMULA_VERSION).
-- CỐ Ý không điền bù đơn cũ: điền bù lúc quét lại nghĩa là mở giao dịch cho mọi đơn tạo
-- trước hôm nay ở mỗi nhịp 10 phút (đúng bệnh băng thông worker đã sửa 12/10/2026) — đơn
-- cũ được tách tên lúc ĐỌC qua danh mục sàn (lib/order-line-display.ts).
--
-- ALTER TABLE cần ACCESS EXCLUSIVE chốc lát trên bảng nóng; migration chạy lúc Render khởi
-- động song song instance cũ đang ghi đơn (bẫy deadlock 30/09/2026) → lấy khóa trước, có
-- thử lại, rồi mới ALTER. Cùng khuôn 20261018120000_order_item_external_id.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "OrderItem" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_item_variant_name: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "variantName" TEXT;
