-- VỊ TRÍ CHỨA HÀNG đợt B (24/09/2026): bảng vị trí cây cha-con + tồn theo SKU × vị trí,
-- nhật ký ghi vị trí + tồn sau, loại TRANSFER. IF NOT EXISTS để Render migrate deploy chạy lại êm.
-- KHÔNG seed vị trí gốc ở đây — gốc sinh lazy khi shop bấm "Thêm vị trí" lần đầu.

ALTER TYPE "InventoryLogType" ADD VALUE IF NOT EXISTS 'TRANSFER';

CREATE TABLE IF NOT EXISTS "stock_locations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isReturnDefault" BOOLEAN NOT NULL DEFAULT false,
    "sellable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_locations_userId_code_key" ON "stock_locations"("userId", "code");
CREATE INDEX IF NOT EXISTS "stock_locations_userId_sortOrder_idx" ON "stock_locations"("userId", "sortOrder");

CREATE TABLE IF NOT EXISTS "product_stock_levels" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_stock_levels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_stock_levels_productId_locationId_key" ON "product_stock_levels"("productId", "locationId");
CREATE INDEX IF NOT EXISTS "product_stock_levels_locationId_idx" ON "product_stock_levels"("locationId");

ALTER TABLE "InventoryLog" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "InventoryLog" ADD COLUMN IF NOT EXISTS "balanceAfter" INTEGER;

DO $$ BEGIN
  ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_stock_levels" ADD CONSTRAINT "product_stock_levels_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_stock_levels" ADD CONSTRAINT "product_stock_levels_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stock_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryLog" ADD CONSTRAINT "InventoryLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
