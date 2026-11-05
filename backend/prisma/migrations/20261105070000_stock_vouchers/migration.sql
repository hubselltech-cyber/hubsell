-- ============================================================
-- 05/11/2026 — PHIẾU NHẬP / XUẤT KHO (docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 4)
-- Trước đây "Phiếu nhiều mã" chỉ ghi N dòng InventoryLog rời rạc: không số phiếu,
-- không in lại, kế toán không tra được. Nay mỗi lần ghi phiếu = một dòng
-- stock_vouchers (số PN-/PX-yyMMdd-XXXX, ảnh chụp JSON các dòng để in lại y
-- nguyên) + cột voucherId trên các dòng sổ kho của phiếu. Khuôn y hệt
-- handover_sheets (01/11). "InventoryLog" bị webhook/worker INSERT liên tục →
-- ADD COLUMN NULL là tức thời nhưng vẫn cần khóa ngắn → lấy khóa có thử lại
-- (gotcha deadlock Render). KHÔNG đánh chỉ mục trên voucherId: tra phiếu → dòng
-- đi qua ảnh chụp JSON, không quét bảng sổ.
-- ============================================================
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE "InventoryLog" IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        attempt := attempt + 1;
        IF attempt >= 40 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'stock_vouchers: chưa lấy được khóa InventoryLog (lần %), thử lại sau 3s', attempt;
        PERFORM pg_sleep(3);
    END;
  END LOOP;
  SET LOCAL lock_timeout = 0;
END $$;

ALTER TABLE "InventoryLog" ADD COLUMN IF NOT EXISTS "voucherId" TEXT;

CREATE TABLE IF NOT EXISTS "stock_vouchers" (
  "id"            TEXT NOT NULL,
  "ownerId"       TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "type"          "InventoryLogType" NOT NULL,
  "reason"        TEXT NOT NULL,
  "locationId"    TEXT,
  "locationName"  TEXT,
  "lineCount"     INTEGER NOT NULL,
  "totalQuantity" INTEGER NOT NULL,
  "totalCost"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lines"         JSONB NOT NULL DEFAULT '[]',
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_vouchers_ownerId_code_key" ON "stock_vouchers" ("ownerId", "code");
CREATE INDEX IF NOT EXISTS "stock_vouchers_ownerId_createdAt_idx" ON "stock_vouchers" ("ownerId", "createdAt");

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "stock_vouchers" ENABLE ROW LEVEL SECURITY;
