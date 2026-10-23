-- Thông báo đẩy app mobile (23/10/2026): thiết bị nhận push + nhóm thông báo khách đã tắt.
CREATE TABLE IF NOT EXISTS "push_devices" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "appVersion" TEXT,
  "deviceName" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX IF NOT EXISTS "push_devices_ownerId_idx" ON "push_devices"("ownerId");
ALTER TABLE "push_devices" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "mutedCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_ownerId_key" ON "notification_preferences"("ownerId");
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
