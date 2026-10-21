-- ============================================================
-- 21/10/2026 — MIGRATION BÙ (phần 2): cột và giá trị enum lên production bằng
-- `prisma db push` mà không migration nào thêm (rà bằng script so schema.prisma với
-- toàn bộ thư mục migrations). Thiếu chúng, DB TRỐNG dừng ở
-- 20260930230000_order_ledger (trigger đọc old."sellerProtectionFee"…).
--
-- Đặt TRƯỚC 20260930230000. Mọi cột đều kiểm information_schema trước khi ALTER
-- → production (đã có cột) KHÔNG chạm bảng nóng Order/OrderItem/User (không lấy
-- khóa). Chỉ mục IF NOT EXISTS, khóa ngoại kiểm pg_constraint.
-- Phần 1 (bảng Ads + Ví): 20260914190000_ads_wallet_tables_baseline.
-- ============================================================

-- ReturnStatus: RECEIVED (đã nhận hàng về tay, chưa nhập kho) đứng trước RECEIVED_INTACT.
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'RECEIVED' BEFORE 'RECEIVED_INTACT';

DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('User',             'avatar',              '"avatar" TEXT'),
      ('User',             'referralSeq',         '"referralSeq" SERIAL NOT NULL'),
      ('User',             'referralCode',        '"referralCode" TEXT'),
      ('User',             'referredById',        '"referredById" TEXT'),
      ('User',             'staffUsername',       '"staffUsername" TEXT'),
      ('User',             'permissions',         '"permissions" TEXT[] DEFAULT ARRAY[]::TEXT[]'),
      ('Product',          'material',            '"material" TEXT'),
      ('Product',          'careInstructions',    '"careInstructions" TEXT'),
      ('Product',          'sizeChart',           '"sizeChart" JSONB'),
      ('Order',            'sellerProtectionFee', '"sellerProtectionFee" DECIMAL(12,2) NOT NULL DEFAULT 0'),
      ('Order',            'refundedAmount',      '"refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0'),
      ('OrderItem',        'returnedQuantity',    '"returnedQuantity" INTEGER NOT NULL DEFAULT 0'),
      ('OrderItem',        'returnRestocked',     '"returnRestocked" BOOLEAN NOT NULL DEFAULT false'),
      ('ChannelProduct',   'itemSku',             '"itemSku" TEXT'),
      ('OperatingExpense', 'fundPlatform',        '"fundPlatform" "ChannelName"')
    ) AS v(tbl, col, ddl)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = spec.tbl AND column_name = spec.col
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN %s', spec.tbl, spec.ddl);
      RAISE NOTICE 'push_drift_baseline: them cot %.%', spec.tbl, spec.col;
    END IF;
  END LOOP;
END $$;

-- User.email: schema cho NULL (nhân viên đăng nhập bằng staffUsername, không có email)
-- nhưng migration init đặt NOT NULL. Chỉ ALTER khi còn NOT NULL → production không khóa bảng.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'email' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
    RAISE NOTICE 'push_drift_baseline: User.email cho phep NULL';
  END IF;
END $$;

-- Channel: khóa duy nhất (chủ shop, sàn, id gian sàn) — schema.prisma có, migration chưa từng tạo.
CREATE UNIQUE INDEX IF NOT EXISTS "Channel_userId_channelName_externalShopId_key" ON "Channel"("userId", "channelName", "externalShopId");

CREATE UNIQUE INDEX IF NOT EXISTS "User_referralSeq_key" ON "User"("referralSeq");
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");
CREATE UNIQUE INDEX IF NOT EXISTS "User_ownerId_staffUsername_key" ON "User"("ownerId", "staffUsername");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_referredById_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey"
      FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
