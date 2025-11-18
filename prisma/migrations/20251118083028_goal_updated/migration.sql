-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "coach_id" TEXT;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
