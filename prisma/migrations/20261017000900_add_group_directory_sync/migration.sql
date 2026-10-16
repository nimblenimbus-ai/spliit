-- CreateTable
CREATE TABLE "GroupDirectory" (
    "id" TEXT NOT NULL,
    "syncKey" TEXT NOT NULL,
    "label" TEXT,
    "groupIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupDirectory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupDirectory_syncKey_key" ON "GroupDirectory"("syncKey");
