-- ============================================================
-- 07/11/2026 — CỘNG TÁC VIÊN ĐẶC BIỆT (anh Trung: "đây đã được coi là cộng tác viên rồi,
-- mình chỉ thêm tab cho cộng tác viên đặc biệt để nâng hoặc hạ mức hoa hồng và thời gian").
-- Mọi tài khoản vốn đã là CTV 10% vĩnh viễn (ReferralTree + sổ cái ví). Bảng này chỉ giữ
-- MỨC % RIÊNG + KHOẢNG THỜI GIAN do HQ đặt cho một tài khoản đã đăng ký; lúc khách được
-- giới thiệu thanh toán, service đọc dòng này (services/referral-wallet.ts):
--   còn trong [startsAt, endsAt) → dùng commissionPercent; ngoài khoảng / không có → 10%.
-- Hoa hồng đã cộng vào ví KHÔNG tính lại khi đổi % hay gỡ dòng (sổ cái append-only).
-- Bảng mới, vài chục dòng, 1-1 với User (unique userId), xóa User thì xóa theo.
-- IF NOT EXISTS để chạy lại êm. Đường lui: revert commit (bảng thừa vô hại).
-- ============================================================
CREATE TABLE IF NOT EXISTS "referral_partners" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "commissionPercent" DECIMAL(5,2) NOT NULL,
  "startsAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt"            TIMESTAMP(3),
  "note"              TEXT,
  "createdById"       TEXT,
  "updatedById"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "referral_partners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_partners_userId_key" ON "referral_partners"("userId");

DO $$ BEGIN
  ALTER TABLE "referral_partners"
    ADD CONSTRAINT "referral_partners_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bật RLS như mọi bảng khác (Supabase 30/09/2026); backend đi Prisma nên không cần policy.
ALTER TABLE "referral_partners" ENABLE ROW LEVEL SECURITY;
