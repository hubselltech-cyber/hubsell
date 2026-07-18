-- CreateTable
CREATE TABLE "StaffChannel" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "StaffChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffChannel_staffId_idx" ON "StaffChannel"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChannel_staffId_channelId_key" ON "StaffChannel"("staffId", "channelId");

-- AddForeignKey
ALTER TABLE "StaffChannel" ADD CONSTRAINT "StaffChannel_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffChannel" ADD CONSTRAINT "StaffChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
