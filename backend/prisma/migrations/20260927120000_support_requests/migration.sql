-- Yêu cầu hỗ trợ từ khách đã đăng nhập (27/09/2026): khách gõ nội dung, HQ xử lý ở tab Yêu cầu hỗ trợ.
-- IF NOT EXISTS / EXCEPTION để Render migrate deploy chạy lại êm.

DO $$ BEGIN
  CREATE TYPE "SupportRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "support_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "phone" TEXT,
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'NEW',
    "reply" TEXT,
    "note" TEXT,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_requests_status_createdAt_idx" ON "support_requests"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "support_requests_userId_createdAt_idx" ON "support_requests"("userId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
