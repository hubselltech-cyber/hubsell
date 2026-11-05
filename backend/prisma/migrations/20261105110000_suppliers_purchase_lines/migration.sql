-- ============================================================
-- 05/11/2026 — NHÀ CUNG CẤP + GIÁ NHẬP (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5)
-- Anh Trung: doanh nghiệp quản cả nhà cung cấp; "đây là phần thống kê thôi, phiếu
-- nhập cũng đơn giản". Phiếu nhập thêm nhà cung cấp + giá nhập từng dòng (đều tùy
-- chọn); báo cáo đọc từ bảng hẹp purchase_lines. KHÔNG tự đổi giá vốn, không đụng
-- Order / sổ tài chính.
--   · suppliers        — danh bạ gọn (không công nợ, không đơn đặt hàng).
--   · stock_vouchers   — thêm supplierId + supplierName (ảnh chụp tên lúc lập).
--   · purchase_lines   — mỗi dòng phiếu NHẬP một dòng: sản phẩm × nhà cung cấp ×
--                        số lượng × giá nhập. Bảng riêng vì báo cáo phải GROUP BY
--                        cả trang; ảnh chụp JSONB trên phiếu không đánh chỉ mục
--                        được, InventoryLog là bảng nóng lẫn hàng nghìn dòng trừ đơn.
-- Không đụng bảng nóng nào: stock_vouchers mới có từ sáng 05/11, vài dòng — ADD
-- COLUMN NULL là tức thời, không cần khóa có thử lại.
-- ============================================================
CREATE TABLE IF NOT EXISTS "suppliers" (
  "id"        TEXT NOT NULL,
  "ownerId"   TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "phone"     TEXT,
  "taxCode"   TEXT,
  "address"   TEXT,
  "note"      TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "suppliers_ownerId_name_idx" ON "suppliers" ("ownerId", "name");

ALTER TABLE "stock_vouchers" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "stock_vouchers" ADD COLUMN IF NOT EXISTS "supplierName" TEXT;
CREATE INDEX IF NOT EXISTS "stock_vouchers_ownerId_supplierId_createdAt_idx" ON "stock_vouchers" ("ownerId", "supplierId", "createdAt");

CREATE TABLE IF NOT EXISTS "purchase_lines" (
  "id"            TEXT NOT NULL,
  "ownerId"       TEXT NOT NULL,
  "voucherId"     TEXT NOT NULL,
  "supplierId"    TEXT,
  "productId"     TEXT NOT NULL,
  "quantity"      INTEGER NOT NULL,
  "purchasePrice" DECIMAL(14,2),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "purchase_lines_ownerId_productId_createdAt_idx" ON "purchase_lines" ("ownerId", "productId", "createdAt");
CREATE INDEX IF NOT EXISTS "purchase_lines_ownerId_supplierId_createdAt_idx" ON "purchase_lines" ("ownerId", "supplierId", "createdAt");
CREATE INDEX IF NOT EXISTS "purchase_lines_voucherId_idx" ON "purchase_lines" ("voucherId");

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_lines" ENABLE ROW LEVEL SECURITY;
