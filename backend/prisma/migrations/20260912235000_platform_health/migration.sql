-- 12/09/2026 - Muc "Suc khoe" HQ: snapshot moi gio + trang thai moc suc chua. Idempotent.
CREATE TABLE IF NOT EXISTS "platform_health_snapshots" (
  "id" TEXT NOT NULL,
  "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "channels" INTEGER NOT NULL DEFAULT 0,
  "owners" INTEGER NOT NULL DEFAULT 0,
  "ordersPerDay" INTEGER NOT NULL DEFAULT 0,
  "dbSizeMb" INTEGER NOT NULL DEFAULT 0,
  "ramMb" INTEGER NOT NULL DEFAULT 0,
  "overdueFast" INTEGER NOT NULL DEFAULT 0,
  "metrics" JSONB NOT NULL,
  CONSTRAINT "platform_health_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "platform_health_snapshots_takenAt_idx" ON "platform_health_snapshots"("takenAt");
CREATE TABLE IF NOT EXISTS "platform_capacity_milestones" (
  "key" TEXT NOT NULL,
  "reachedAt" TIMESTAMP(3),
  "warnedAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "doneBy" TEXT,
  "note" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_capacity_milestones_pkey" PRIMARY KEY ("key")
);
