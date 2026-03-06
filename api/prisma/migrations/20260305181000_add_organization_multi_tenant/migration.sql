-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ghlApiBaseUrl" TEXT,
    "ghlLocationId" TEXT,
    "ghlAccessToken" TEXT,
    "ghlContactSyncMaxPages" INTEGER,
    "ghlVisitsObjectKey" TEXT,
    "ghlVisitsFieldClientNameKey" TEXT,
    "ghlVisitsFieldOwnerKey" TEXT,
    "ghlVisitsFieldVisitDateKey" TEXT,
    "ghlVisitsFieldNotesKey" TEXT,
    "ghlVisitsFieldTitleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- Seed default organization
INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt")
VALUES ('org-trinit-default', 'Trinit', 'trinit', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE
SET "updatedAt" = EXCLUDED."updatedAt";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

-- Backfill users with default organization
UPDATE "User"
SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'trinit' LIMIT 1)
WHERE "organizationId" IS NULL;

-- Enforce tenant ownership
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "User"
ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "User_organizationId_role_idx" ON "User"("organizationId", "role");
