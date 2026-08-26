-- HANG DOI hoi get_tracking_info cho Cuu don giao that bai (26/08) — cung
-- khuon StockPushJob: moi don MOT ve (orderId unique), worker nhat ve den han
-- theo tran call/gian. Thay 2 Map in-memory (mat khi restart) bang ve ben DB,
-- chuan bi cho quy mo thuong mai hoa (trieu don van bi chan tren so call).
DO $$ BEGIN
  CREATE TYPE "DeliveryTrackingTaskKind" AS ENUM ('DETECT', 'OUTCOME');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "delivery_tracking_tasks" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "DeliveryTrackingTaskKind" NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_tracking_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_tracking_tasks_orderId_key" ON "delivery_tracking_tasks"("orderId");
CREATE INDEX IF NOT EXISTS "delivery_tracking_tasks_channelId_nextRunAt_idx" ON "delivery_tracking_tasks"("channelId", "nextRunAt");

DO $$ BEGIN
  ALTER TABLE "delivery_tracking_tasks" ADD CONSTRAINT "delivery_tracking_tasks_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "delivery_tracking_tasks" ADD CONSTRAINT "delivery_tracking_tasks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
