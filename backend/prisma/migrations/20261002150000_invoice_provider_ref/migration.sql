-- ============================================================
-- HÓA ĐƠN BƯỚC 5, LÁT 2 (02/10/2026 — docs/HANG-DOI-BEN.md mục 4.6):
--   1. Lưu MÃ THAM CHIẾU đã gửi nhà cung cấp cho từng lượt phát hành.
--   2. Chống phát hành trùng Ở DATABASE (trước đây chỉ "kiểm rồi mới ghi" trong mã).
--
-- Chỉ đụng bảng "InvoiceLog" (bảng này chỉ luồng hóa đơn ghi). Không khóa ngoại
-- mới, không đụng bảng đơn.
--
-- ĐIỀU KIỆN TRƯỚC KHI ÁP: bảng không được có dòng vi phạm hai chỉ mục duy nhất
-- dưới đây, nếu có thì migration hỏng. Đã đếm trên prod 02/10/2026 ~14:50: 0 hóa
-- đơn gốc trùng, 0 điều chỉnh trùng, cả bảng 2 dòng, 0 shop có cấu hình hóa đơn.
-- ============================================================

-- 1. Mã tham chiếu đã gửi nhà cung cấp (MISA: RefID). NULL = dòng do webhook tự
--    tạo cho hóa đơn lập ngoài Hubsell (không biết mã).
ALTER TABLE "InvoiceLog" ADD COLUMN "providerRef" TEXT;

-- Dòng có sẵn: hóa đơn gốc luôn gửi mã = mã đơn; hóa đơn điều chỉnh gửi
-- "<mã đơn>-DC<n>" với n = thứ tự lượt điều chỉnh của cùng hóa đơn gốc.
UPDATE "InvoiceLog" SET "providerRef" = "orderCode" WHERE "adjustmentForLogId" IS NULL;

UPDATE "InvoiceLog" AS l
SET "providerRef" = l."orderCode" || '-DC' || r.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "adjustmentForLogId" ORDER BY "createdAt", "id") AS rn
  FROM "InvoiceLog"
  WHERE "adjustmentForLogId" IS NOT NULL
) AS r
WHERE r."id" = l."id";

-- 2. Một đơn của một shop chỉ có MỘT hóa đơn gốc đang chờ hoặc đã phát hành.
CREATE UNIQUE INDEX "InvoiceLog_open_original_key"
  ON "InvoiceLog" ("ownerId", "orderCode")
  WHERE "adjustmentForLogId" IS NULL AND "status" IN ('PENDING', 'ISSUED');

-- 3. Một hóa đơn gốc chỉ có MỘT hóa đơn điều chỉnh đang chờ hoặc đã phát hành.
CREATE UNIQUE INDEX "InvoiceLog_open_adjustment_key"
  ON "InvoiceLog" ("adjustmentForLogId")
  WHERE "adjustmentForLogId" IS NOT NULL AND "status" IN ('PENDING', 'ISSUED');
