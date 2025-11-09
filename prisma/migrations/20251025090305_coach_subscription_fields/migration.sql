-- AlterTable
ALTER TABLE "coach_profiles" ADD COLUMN     "registration_fee_paid" SMALLINT DEFAULT 0,
ADD COLUMN     "registration_fee_paid_at" TIMESTAMP(3),
ADD COLUMN     "subscription_active" SMALLINT DEFAULT 0,
ADD COLUMN     "subscription_expires_at" TIMESTAMP(3),
ADD COLUMN     "subscription_provider" TEXT,
ADD COLUMN     "subscription_reference" TEXT,
ADD COLUMN     "subscription_started_at" TIMESTAMP(3);
