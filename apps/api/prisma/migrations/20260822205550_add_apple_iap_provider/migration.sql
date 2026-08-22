-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'APPLE_IAP';

-- AlterTable
ALTER TABLE "RetentionSubscription" ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK';
