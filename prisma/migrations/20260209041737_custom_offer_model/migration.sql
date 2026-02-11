/*
  Warnings:

  - The values [SENT] on the enum `CustomOfferStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `base_price_per_session` on the `custom_offers` table. All the data in the column will be lost.
  - You are about to drop the column `conversation_id` on the `custom_offers` table. All the data in the column will be lost.
  - You are about to drop the column `custom_offer_id` on the `messages` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "CustomOfferStatus_new" AS ENUM ('PENDING', 'PAYMENT_PENDING', 'ACCEPTED', 'DECLINED');
ALTER TABLE "custom_offers" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "custom_offers" ALTER COLUMN "status" TYPE "CustomOfferStatus_new" USING ("status"::text::"CustomOfferStatus_new");
ALTER TYPE "CustomOfferStatus" RENAME TO "CustomOfferStatus_old";
ALTER TYPE "CustomOfferStatus_new" RENAME TO "CustomOfferStatus";
DROP TYPE "CustomOfferStatus_old";
ALTER TABLE "custom_offers" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "custom_offers" DROP CONSTRAINT "custom_offers_athlete_id_fkey";

-- DropForeignKey
ALTER TABLE "custom_offers" DROP CONSTRAINT "custom_offers_coach_id_fkey";

-- DropForeignKey
ALTER TABLE "custom_offers" DROP CONSTRAINT "custom_offers_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_custom_offer_id_fkey";

-- AlterTable
ALTER TABLE "custom_offers" DROP COLUMN "base_price_per_session",
DROP COLUMN "conversation_id",
ADD COLUMN     "responded_at" TIMESTAMP(3),
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "session_price" DECIMAL(65,30),
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "number_of_members" DROP NOT NULL,
ALTER COLUMN "number_of_members" SET DEFAULT 1,
ALTER COLUMN "total_amount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "custom_offer_id";

-- CreateIndex
CREATE INDEX "custom_offers_booking_id_idx" ON "custom_offers"("booking_id");

-- CreateIndex
CREATE INDEX "custom_offers_coach_id_idx" ON "custom_offers"("coach_id");

-- CreateIndex
CREATE INDEX "custom_offers_athlete_id_idx" ON "custom_offers"("athlete_id");
