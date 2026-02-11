-- CreateEnum
CREATE TYPE "CustomOfferStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "custom_offer_id" TEXT;

-- CreateTable
CREATE TABLE "custom_offers" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "status" "CustomOfferStatus" NOT NULL DEFAULT 'SENT',
    "booking_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "title" TEXT,
    "appointment_date" TIMESTAMP(3) NOT NULL,
    "session_time" TIMESTAMP(3),
    "session_time_display" TEXT,
    "duration_minutes" INTEGER,
    "number_of_members" INTEGER NOT NULL,
    "base_price_per_session" DECIMAL(65,30) NOT NULL,
    "total_amount" DECIMAL(65,30) NOT NULL,
    "paid_amount" DECIMAL(65,30),
    "due_amount" DECIMAL(65,30),
    "currency" TEXT,
    "payment_transaction_id" TEXT,

    CONSTRAINT "custom_offers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "custom_offers" ADD CONSTRAINT "custom_offers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_offers" ADD CONSTRAINT "custom_offers_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_offers" ADD CONSTRAINT "custom_offers_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_offers" ADD CONSTRAINT "custom_offers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_offers" ADD CONSTRAINT "custom_offers_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_custom_offer_id_fkey" FOREIGN KEY ("custom_offer_id") REFERENCES "custom_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
