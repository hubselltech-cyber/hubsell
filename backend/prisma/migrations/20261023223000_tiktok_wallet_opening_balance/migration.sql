-- Ví TikTok (23/10/2026): số đầu sổ do chủ shop đối chiếu một lần với Seller Center.
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "walletOpeningBalance" DECIMAL(14,2);
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "walletReconciledAt" TIMESTAMP(3);
