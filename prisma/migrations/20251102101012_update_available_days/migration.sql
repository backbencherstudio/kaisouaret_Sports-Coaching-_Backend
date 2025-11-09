/*
  Warnings:

  - The `available_days` column on the `coach_profiles` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "coach_profiles" DROP COLUMN "available_days",
ADD COLUMN     "available_days" TEXT[];
