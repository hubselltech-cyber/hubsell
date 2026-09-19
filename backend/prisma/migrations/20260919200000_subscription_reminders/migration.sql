-- 19/09/2026: vé chống trùng thư nhắc hạn gói (workers/subscription-reminder.ts).
CREATE TABLE IF NOT EXISTS "subscription_reminders" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_reminders_subscriptionId_kind_periodEnd_key" ON "subscription_reminders"("subscriptionId", "kind", "periodEnd");
CREATE INDEX IF NOT EXISTS "subscription_reminders_batchId_idx" ON "subscription_reminders"("batchId");

DO $$ BEGIN
  ALTER TABLE "subscription_reminders" ADD CONSTRAINT "subscription_reminders_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
