-- CreateTable
CREATE TABLE "SyncState" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "lastSyncedBlock" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_key_key" ON "SyncState"("key");
