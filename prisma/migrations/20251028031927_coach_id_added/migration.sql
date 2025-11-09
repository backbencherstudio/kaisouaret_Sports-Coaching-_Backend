/*
  Warnings:

  - Added the required column `coach_id` to the `bookings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "coach_id" TEXT NOT NULL;
