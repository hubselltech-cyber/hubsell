-- 12/09/2026 - Cau dao goi Ads API theo app (services/api-budget.ts). Idempotent.
CREATE TABLE IF NOT EXISTS "api_throttle_states" (
  "app" TEXT NOT NULL,
  "pausedUntil" TIMESTAMP(3),
  "level" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "tripCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_throttle_states_pkey" PRIMARY KEY ("app")
);
