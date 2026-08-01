-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'ROOM_UNLOCK';

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "memberCountAtEnd" INTEGER,
ADD COLUMN     "unlockPaymentId" TEXT,
ADD COLUMN     "unlockedAt" TIMESTAMP(3);
