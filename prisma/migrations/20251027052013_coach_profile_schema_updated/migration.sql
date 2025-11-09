/*
  Warnings:

  - You are about to drop the column `bio` on the `coach_profiles` table. All the data in the column will be lost.
  - The `certifications` column on the `coach_profiles` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "coach_profiles" DROP COLUMN "bio",
ADD COLUMN     "primary_specialty" TEXT,
DROP COLUMN "certifications",
ADD COLUMN     "certifications" TEXT[];
