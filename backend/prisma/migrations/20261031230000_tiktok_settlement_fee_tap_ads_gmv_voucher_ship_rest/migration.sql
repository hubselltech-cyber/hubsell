-- ============================================================
-- 31/10/2026 — BẢN KÊ TIKTOK: 3 cột mới (docs/TIKTOK-PHI-BAO-CAO-KINH-DOANH-DOI-CHIEU-API-KHAO-SAT-31-10.md mục 7):
--   tap_shop_ads_commission → feeAffiliatePartnerAds (Hoa hồng quảng cáo cửa hàng của Đối tác liên kết)
--                             — trước đó rơi vào feeOther (chốt chặn): tổng không mất, chỉ thiếu tên.
--   gmv_max_coupon_fee      → feeGmvMaxVoucher (Trong đó: Voucher GMV Max) — cột con của feeGmvMax,
--                             chỉ để đối chiếu với dòng cùng tên trên Seller Center; feeGmvMax giữ nguyên.
--   (dư)                    → shipRest (Khoản vận chuyển khác) = shippingCost − Σ 8 cột ship đã đặt tên
--                             — chốt chặn nhóm vận chuyển như feeOther của nhóm phí.
-- Bản kê cũ giữ nguyên (không có dòng thô để tách); bản kê đồng bộ sau deploy có cột riêng.
-- Bảng bị worker ghi liên tục → lấy khóa có thử lại như migration 22/10 + 27/10 + 29/10.
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
        RAISE NOTICE 'tiktok_settlement_fee_cols_3110: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "tiktok_order_settlements" ADD COLUMN IF NOT EXISTS "feeAffiliatePartnerAds" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "tiktok_order_settlements" ADD COLUMN IF NOT EXISTS "feeGmvMaxVoucher" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "tiktok_order_settlements" ADD COLUMN IF NOT EXISTS "shipRest" DECIMAL(12,2) NOT NULL DEFAULT 0;
