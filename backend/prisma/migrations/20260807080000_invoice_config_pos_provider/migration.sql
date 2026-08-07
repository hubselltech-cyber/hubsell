-- NCC riêng cho luồng máy tính tiền (Multi-Vendor tab POS) — tách khỏi
-- provider kê khai. IF NOT EXISTS để chạy lại an toàn.

-- AlterTable
ALTER TABLE "InvoiceConfig" ADD COLUMN IF NOT EXISTS "posProvider" TEXT NOT NULL DEFAULT 'MISA';
