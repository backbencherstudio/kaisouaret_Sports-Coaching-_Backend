/*
  Warnings:

  - You are about to drop the column `blocked_time_slots` on the `coach_profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "coach_profiles" DROP COLUMN "blocked_time_slots";

-- CreateTable
CREATE TABLE "blocked_time_slots" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coach_profile_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,

    CONSTRAINT "blocked_time_slots_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "blocked_time_slots" ADD CONSTRAINT "blocked_time_slots_coach_profile_id_fkey" FOREIGN KEY ("coach_profile_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
