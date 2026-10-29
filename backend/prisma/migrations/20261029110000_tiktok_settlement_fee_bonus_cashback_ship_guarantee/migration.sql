-- ============================================================
-- 29/10/2026 — BẢN KÊ TIKTOK: 2 phí mới có cột riêng (docs/DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-29-10.md mục 11):
--   bonus_cashback_service_fee_amount  → feeBonusCashback (Phí dịch vụ Bonus Cashback, ~1,5 % doanh thu sau CK)
--   shipping_fee_guarantee_service_fee → feeShipGuarantee (Phí Bảo đảm phí vận chuyển, 1.620đ/đơn)
-- Trước đó hai phí này rơi vào feeOther (chốt chặn) — tổng không mất, chỉ thiếu tên. Bản kê cũ giữ
-- nguyên (không có dòng thô để tách); bản kê đồng bộ sau deploy có cột riêng.
-- Bảng bị worker ghi liên tục → lấy khóa có thử lại như migration 22/10 + 27/10.
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
        RAISE NOTICE 'tiktok_settlement_fee_cols: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "tiktok_order_settlements" ADD COLUMN IF NOT EXISTS "feeBonusCashback" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "tiktok_order_settlements" ADD COLUMN IF NOT EXISTS "feeShipGuarantee" DECIMAL(12,2) NOT NULL DEFAULT 0;
