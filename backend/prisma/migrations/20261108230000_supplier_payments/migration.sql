-- ============================================================
-- 08/11/2026 — CÔNG NỢ NHÀ CUNG CẤP, BẢN HẸP (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 8)
-- Anh Trung: khách xin "công nợ" trong Tổng kho; khảo sát 10 phần mềm → ở phần mềm bán
-- hàng công nợ NCC chỉ là ĐUÔI CỦA PHIẾU NHẬP ("đã trả / còn nợ") cộng dồn theo nhà cung
-- cấp. Anh chốt "Làm bản hẹp NCC": chỉ phải trả theo phiếu nhập, không menu Công nợ riêng,
-- không công nợ khách / nhân viên, không định khoản, KHÔNG đụng Dòng tiền.
--   · stock_vouchers    — thêm paidAmount (Σ đã trả) + debtAmount (= totalCost − paidAmount);
--                         NULL = không theo dõi (phiếu xuất / không NCC / phiếu cũ chưa ai ghi).
--   · supplier_payments — mỗi lần trả tiền cho một phiếu một dòng (kể cả trả ngay lúc lập).
-- Không đụng bảng nóng: stock_vouchers nhỏ (mới có từ 05/11), ADD COLUMN NULL tức thời.
-- ============================================================
ALTER TABLE "stock_vouchers" ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(14,2);
ALTER TABLE "stock_vouchers" ADD COLUMN IF NOT EXISTS "debtAmount" DECIMAL(14,2);

CREATE TABLE IF NOT EXISTS "supplier_payments" (
  "id"          TEXT NOT NULL,
  "ownerId"     TEXT NOT NULL,
  "voucherId"   TEXT NOT NULL,
  "supplierId"  TEXT,
  "amount"      DECIMAL(14,2) NOT NULL,
  "paidAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note"        TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_payments_voucherId_idx" ON "supplier_payments" ("voucherId");
CREATE INDEX IF NOT EXISTS "supplier_payments_ownerId_supplierId_paidAt_idx" ON "supplier_payments" ("ownerId", "supplierId", "paidAt");

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
