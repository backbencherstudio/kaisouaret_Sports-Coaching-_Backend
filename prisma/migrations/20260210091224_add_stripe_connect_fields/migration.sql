-- AlterTable
ALTER TABLE "coach_profiles" ADD COLUMN     "stripe_account_id" TEXT,
ADD COLUMN     "stripe_account_status" TEXT;

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "transfer_reference" TEXT,
ADD COLUMN     "transfer_status" TEXT;
