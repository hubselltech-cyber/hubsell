-- ============================================================
-- 06/11/2026 — CÔNG TẮC ĐỒNG BỘ TỒN THEO TỪNG PHÂN LOẠI SÀN (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 7)
-- Anh Trung 05/11 đêm: nút "Đồng bộ tồn kho" hiện tại là nút TỔNG theo gian; cần bật / tắt được
-- cho từng sản phẩm và từng phân loại.
--   "ChannelProduct"."stockSyncEnabled": NULL  = theo công tắc của gian (y như trước giờ);
--                                        true / false = khách bật / tắt RIÊNG phân loại này.
-- Vì NULL = "theo gian" nên KHÔNG phải điền dữ liệu cũ: mọi dòng đang có giữ đúng hành vi hôm nay,
-- ADD COLUMN NULL là tức thời. "ChannelProduct" bị worker đồng bộ danh mục ghi liên tục → vẫn cần
-- khóa ngắn → lấy khóa có thử lại (gotcha deadlock Render).
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "ChannelProduct" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'channel_product_stock_sync: chưa lấy được khóa ChannelProduct (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "ChannelProduct" ADD COLUMN IF NOT EXISTS "stockSyncEnabled" BOOLEAN;
