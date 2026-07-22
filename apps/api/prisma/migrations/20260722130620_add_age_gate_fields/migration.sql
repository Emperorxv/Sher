-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ageConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "birthYear" INTEGER,
ADD COLUMN     "parentalConsentConfirmed" BOOLEAN NOT NULL DEFAULT false;
