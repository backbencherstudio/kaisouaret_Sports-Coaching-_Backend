-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "days_validity" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "number_of_sessions" INTEGER,
ADD COLUMN     "session_package_id" TEXT,
ADD COLUMN     "total_completed_session" INTEGER DEFAULT 0,
ALTER COLUMN "session_time" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_package_id_fkey" FOREIGN KEY ("session_package_id") REFERENCES "sessions_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
