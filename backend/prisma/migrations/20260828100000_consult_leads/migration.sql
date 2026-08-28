-- LEAD TU VAN tu landing hubsell.tech (28/08) — khach CHUA co tai khoan de lai
-- Ten + Email + SDT qua form public ("Dang ky tu van" Enterprise + dock noi).
-- Goi chot cuoi cung van nam o PackagePayment; HQ match lead <-> User theo
-- email/SDT de biet lead da dang ky va dang dung goi nao.
DO $$ BEGIN
  CREATE TYPE "ConsultLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'DROPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "consult_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ConsultLeadStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consult_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "consult_leads_status_createdAt_idx" ON "consult_leads"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "consult_leads_email_idx" ON "consult_leads"("email");
CREATE INDEX IF NOT EXISTS "consult_leads_phone_idx" ON "consult_leads"("phone");

DO $$ BEGIN
  ALTER TABLE "consult_leads" ADD CONSTRAINT "consult_leads_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
