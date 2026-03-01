-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "custom_offer_payment_transaction_id" TEXT;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_custom_offer_payment_transaction_id_fkey" FOREIGN KEY ("custom_offer_payment_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
