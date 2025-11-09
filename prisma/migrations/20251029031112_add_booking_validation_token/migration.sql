-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "token_expires_at" TIMESTAMP(3),
ADD COLUMN     "validation_token" TEXT;
