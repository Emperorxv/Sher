-- CreateEnum
CREATE TYPE "RetentionSubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "RetentionSubscription" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorizationCode" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "RetentionSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextChargeAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionSubscription_roomId_status_idx" ON "RetentionSubscription"("roomId", "status");

-- CreateIndex
CREATE INDEX "RetentionSubscription_userId_idx" ON "RetentionSubscription"("userId");

-- AddForeignKey
ALTER TABLE "RetentionSubscription" ADD CONSTRAINT "RetentionSubscription_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionSubscription" ADD CONSTRAINT "RetentionSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
