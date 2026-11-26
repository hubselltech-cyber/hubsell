-- ============================================================
-- 26/11/2026 — THUẾ GTGT QUẢNG CÁO (docs/TAI-CHINH-VAT-QUANG-CAO.md)
--
-- ShopTaxSetting.adsVatAsCost: shop có tính thuế GTGT sàn cộng thêm trên tiền quảng cáo
-- (TikTok 10 %, Shopee 8 % — backend/src/config/ads-vat.ts) vào chi phí của báo cáo không.
-- Mặc định TRUE (hộ / cá nhân kinh doanh không khấu trừ được thuế đầu vào); công ty kê khai
-- khấu trừ tự tắt ở trang Cấu hình thuế. Shop chưa có dòng cấu hình cũng coi như TRUE
-- (DEFAULT_TAX_CONFIG).
--
-- Bảng mỗi chủ shop tối đa một dòng (nhỏ) — thêm cột có DEFAULT là tức thì, không quét bảng.
-- ============================================================

ALTER TABLE "ShopTaxSetting" ADD COLUMN IF NOT EXISTS "adsVatAsCost" BOOLEAN NOT NULL DEFAULT true;
