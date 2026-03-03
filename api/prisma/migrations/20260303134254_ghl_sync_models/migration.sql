-- CreateTable
CREATE TABLE "GhlContact" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "ghlContactId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "ownerUserId" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GhlOpportunity" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "ghlOpportunityId" TEXT NOT NULL,
    "ghlContactId" TEXT,
    "title" TEXT,
    "status" TEXT,
    "stageId" TEXT,
    "stageName" TEXT,
    "monetaryValue" DOUBLE PRECISION,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "GhlContact_sellerId_name_idx" ON "GhlContact"("sellerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GhlContact_sellerId_ghlContactId_key" ON "GhlContact"("sellerId", "ghlContactId");

-- CreateIndex
CREATE INDEX "GhlOpportunity_sellerId_ghlContactId_idx" ON "GhlOpportunity"("sellerId", "ghlContactId");

-- CreateIndex
CREATE UNIQUE INDEX "GhlOpportunity_sellerId_ghlOpportunityId_key" ON "GhlOpportunity"("sellerId", "ghlOpportunityId");

-- AddForeignKey
ALTER TABLE "GhlContact" ADD CONSTRAINT "GhlContact_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GhlOpportunity" ADD CONSTRAINT "GhlOpportunity_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GhlOpportunity" ADD CONSTRAINT "GhlOpportunity_sellerId_ghlContactId_fkey" FOREIGN KEY ("sellerId", "ghlContactId") REFERENCES "GhlContact"("sellerId", "ghlContactId") ON DELETE RESTRICT ON UPDATE CASCADE;
