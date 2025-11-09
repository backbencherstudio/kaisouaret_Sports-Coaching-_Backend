/*
  Warnings:

  - You are about to drop the column `primary_specialty` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `specialties` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "primary_specialty",
DROP COLUMN "specialties",
ADD COLUMN     "age" INTEGER,
ADD COLUMN     "goals" TEXT,
ADD COLUMN     "sports" TEXT;
