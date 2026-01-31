-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "latitude" DECIMAL(65,30),
ADD COLUMN     "longitude" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "coach_profiles" ADD COLUMN     "latitude" DECIMAL(65,30),
ADD COLUMN     "longitude" DECIMAL(65,30);
