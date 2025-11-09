-- CreateEnum
CREATE TYPE "AvailableDays" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "coach_profiles" ADD COLUMN     "available_days" "AvailableDays"[],
ADD COLUMN     "blocked_days" TEXT[],
ADD COLUMN     "blocked_time_slots" TEXT[];
