-- CreateTable
CREATE TABLE "OpsResolvedAlert" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "byRole" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsResolvedAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsChatMessage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsActivity" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsResolvedAlert_ownerId_idx" ON "OpsResolvedAlert"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "OpsResolvedAlert_ownerId_alertId_key" ON "OpsResolvedAlert"("ownerId", "alertId");

-- CreateIndex
CREATE INDEX "OpsChatMessage_ownerId_alertId_idx" ON "OpsChatMessage"("ownerId", "alertId");

-- CreateIndex
CREATE INDEX "OpsActivity_ownerId_idx" ON "OpsActivity"("ownerId");

-- AddForeignKey
ALTER TABLE "OpsResolvedAlert" ADD CONSTRAINT "OpsResolvedAlert_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsChatMessage" ADD CONSTRAINT "OpsChatMessage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsActivity" ADD CONSTRAINT "OpsActivity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
