-- ============================================================
-- 29/10/2026 — LÁT 3 + 4 "Tổng giá trị sản phẩm" (docs/DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-29-10.md mục 12–13):
--   Order.tiktokVoucherSeller / tiktokPriceDetailAt : voucher shop TikTok từ Get Order Price Details 202407
--     (phần nằm trong chiết khấu NBH của bản kê) — VÀO sổ cái (revenueGross + sellerVoucher) → thêm vào WHEN
--     của trigger đánh bẩn để bù nền tự tính lại đơn.
--   Order.shopeeOriginalPrice / shopeeSellerDiscount / shopeeBundleDiscount : escrow Shopee, CHỈ hiển thị.
--   OrderItem.originalPrice : giá niêm yết dòng (Shopee model_original_price / TikTok original_price).
-- "Order"/"OrderItem" bị worker ghi liên tục → khóa có thử lại như migration 22/10, 27/10.
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "Order" IN ACCESS EXCLUSIVE MODE;
      LOCK TABLE "OrderItem" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'order_tiktok_voucher_shopee_original: chưa lấy được khóa (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tiktokVoucherSeller" DECIMAL(12,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tiktokPriceDetailAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shopeeOriginalPrice" DECIMAL(12,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shopeeSellerDiscount" DECIMAL(12,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shopeeBundleDiscount" DECIMAL(12,2);
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "originalPrice" DECIMAL(12,2);

-- Trigger đánh bẩn sổ cái: thêm tiktokVoucherSeller vào danh sách cột theo dõi (bản gốc 20260930230000).
CREATE OR REPLACE TRIGGER "order_ledger_on_order_update"
  AFTER UPDATE ON "Order"
  FOR EACH ROW
  WHEN (
    ROW(OLD."channelId", OLD."orderCode", OLD."createdAt", OLD."totalAmount", OLD."sellerVoucher",
        OLD."fixedFee", OLD."paymentFee", OLD."serviceFee", OLD."sellerProtectionFee", OLD."affiliateFee",
        OLD."shippingFeeQuoted", OLD."shippingFeeActual", OLD."shippingFeeDiff", OLD."platformSubsidy",
        OLD."actualPayout", OLD."taxWithheld", OLD."adWalletTopup", OLD."shipSubsidyPlatform", OLD."shipSubsidyShop",
        OLD."refundedAmount", OLD."platformRefundAmount", OLD."platformReturnStatus", OLD."returnSolution",
        OLD."returnDeliveredAt", OLD."returnStatus", OLD."shippingStatus", OLD."isSettled", OLD."settledAt",
        OLD."deliveredAt", OLD."stockRestoredAt", OLD."packedAt", OLD."itemCount", OLD."tiktokVoucherSeller")
    IS DISTINCT FROM
    ROW(NEW."channelId", NEW."orderCode", NEW."createdAt", NEW."totalAmount", NEW."sellerVoucher",
        NEW."fixedFee", NEW."paymentFee", NEW."serviceFee", NEW."sellerProtectionFee", NEW."affiliateFee",
        NEW."shippingFeeQuoted", NEW."shippingFeeActual", NEW."shippingFeeDiff", NEW."platformSubsidy",
        NEW."actualPayout", NEW."taxWithheld", NEW."adWalletTopup", NEW."shipSubsidyPlatform", NEW."shipSubsidyShop",
        NEW."refundedAmount", NEW."platformRefundAmount", NEW."platformReturnStatus", NEW."returnSolution",
        NEW."returnDeliveredAt", NEW."returnStatus", NEW."shippingStatus", NEW."isSettled", NEW."settledAt",
        NEW."deliveredAt", NEW."stockRestoredAt", NEW."packedAt", NEW."itemCount", NEW."tiktokVoucherSeller")
  )
  EXECUTE FUNCTION "order_ledger_trg_order"();
