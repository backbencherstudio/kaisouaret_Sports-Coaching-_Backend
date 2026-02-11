-- CreateEnum
CREATE TYPE "SubscriptionPlanKind" AS ENUM ('COACH', 'ATHLETE');

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "kind" "SubscriptionPlanKind" NOT NULL DEFAULT 'COACH';
