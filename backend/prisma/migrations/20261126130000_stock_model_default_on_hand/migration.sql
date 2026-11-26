-- ============================================================
-- 26/11/2026 — KHO CHUẨN QUỐC TẾ: BẬT CÁCH "HÀNG TRONG KHO" (ON_HAND) CHO MỌI SHOP
-- (anh Trung 26/11: "Việc anh dùng thử mấy hôm anh thấy đã ok rồi nên bật cho tất cả các shop luôn";
--  docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 21)
--
-- Cách hiển thị của shop đọc ở services/stock-ledger.ts → resolveStockSettings:
--   · shop CHƯA có dòng shop_sync_settings (đa số) → DEFAULT_STOCK_MODEL trong mã (đổi sang ON_HAND
--     cùng commit với tệp này);
--   · shop ĐÃ có dòng → theo cột stockModel của dòng.
-- Các dòng đang mang 'LEGACY' đều do mặc định cũ của cột sinh ra lúc khách lưu cài đặt khác (tồn an
-- toàn, ngưỡng sắp hết…) — trước ngày này không có cách nào để khách tự chọn cách cũ — nên chuyển
-- hết sang ON_HAND. Từ đây 'LEGACY' trong một dòng nghĩa là Hubsell CỐ Ý cho shop đó về cách cũ.
--
-- Bảng nhỏ (vài dòng), không nằm trên đường nóng. Chỉ đổi cách hiển thị + cửa ghi; sổ tồn bán, bộ
-- đếm giữ và số đẩy lên sàn không đổi. Lùi lại toàn hệ thống: env STOCK_MODEL_FORCE=LEGACY trên web.
-- ============================================================

ALTER TABLE "shop_sync_settings" ALTER COLUMN "stockModel" SET DEFAULT 'ON_HAND';

UPDATE "shop_sync_settings" SET "stockModel" = 'ON_HAND' WHERE "stockModel" = 'LEGACY';
