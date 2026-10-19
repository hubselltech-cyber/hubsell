-- ============================================================
-- 19/10/2026 — SỐ SẢN PHẨM ĐÃ BÁN theo ngày của campaign Shopee (docs/ADS-SHOPEE-KHAI-THAC-API.md 15.11):
-- Seller Center hiện cả "Đơn hàng" lẫn "Sản phẩm đã bán"; API trả broad_order_amount / direct_order_amount
-- cùng call với broad_order → lưu để bảng Hubsell khớp hai số với Shopee (anh Trung: "làm khớp Shopee luôn").
-- Bảng bị worker upsert liên tục → khóa có thử lại như các migration trước.
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "AdsCampaignDailyPerf" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'ads_perf_items_sold: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "AdsCampaignDailyPerf" ADD COLUMN IF NOT EXISTS "broadOrderAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdsCampaignDailyPerf" ADD COLUMN IF NOT EXISTS "directOrderAmount" INTEGER NOT NULL DEFAULT 0;
