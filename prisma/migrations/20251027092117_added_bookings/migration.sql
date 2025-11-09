/*
  Warnings:

  - You are about to drop the column `appointment_at` on the `bookings` table. All the data in the column will be lost.
  - Added the required column `appointment_date` to the `bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `session_time` to the `bookings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "appointment_at",
ADD COLUMN     "appointment_date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "google_map_link" TEXT,
ADD COLUMN     "session_time" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "coach_profiles" ADD COLUMN     "session_duration_minutes" INTEGER DEFAULT 60,
ADD COLUMN     "session_price" DECIMAL(65,30) DEFAULT 55;
