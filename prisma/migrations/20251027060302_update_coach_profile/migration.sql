/*
  Warnings:

  - You are about to drop the column `specialty` on the `coach_profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "coach_profiles" DROP COLUMN "specialty",
ADD COLUMN     "specialties" TEXT[];
