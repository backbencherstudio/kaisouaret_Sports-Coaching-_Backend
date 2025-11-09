/*
  Warnings:

  - You are about to drop the column `ratings` on the `coach_profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "coach_profiles" DROP COLUMN "ratings",
ADD COLUMN     "avg_rating" DECIMAL(65,30),
ADD COLUMN     "rating_count" INTEGER DEFAULT 0;

-- AlterTable
ALTER TABLE "coach_reviews" ADD COLUMN     "booking_id" TEXT,
ADD COLUMN     "rating" INTEGER;
