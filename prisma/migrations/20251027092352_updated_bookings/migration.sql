-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "location" TEXT DEFAULT 'offline',
ADD COLUMN     "session_price" DECIMAL(65,30) DEFAULT 55;
