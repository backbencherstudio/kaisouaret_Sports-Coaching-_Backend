-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "goals" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "objectives" TEXT,
ADD COLUMN     "referral" TEXT,
ADD COLUMN     "sports" TEXT;

-- CreateTable
CREATE TABLE "coach_profiles" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" SMALLINT DEFAULT 1,
    "user_id" TEXT NOT NULL,
    "primary_specialty" TEXT,
    "specialties" TEXT[],
    "experience_level" TEXT,
    "certifications" TEXT[],
    "hourly_rate" DECIMAL(65,30),
    "hourly_currency" TEXT,
    "is_verified" SMALLINT DEFAULT 0,
    "registration_fee_paid" SMALLINT DEFAULT 0,
    "registration_fee_paid_at" TIMESTAMP(3),
    "session_duration_minutes" INTEGER DEFAULT 60,
    "session_price" DECIMAL(65,30) DEFAULT 55,
    "subscription_active" SMALLINT DEFAULT 0,
    "subscription_started_at" TIMESTAMP(3),
    "subscription_expires_at" TIMESTAMP(3),
    "subscription_provider" TEXT,
    "subscription_reference" TEXT,
    "rgpd_laws_agreement" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "coach_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions_packages" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "coach_id" TEXT NOT NULL,
    "coach_profile_id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "number_of_sessions" INTEGER,
    "days_validity" INTEGER,
    "total_price" DECIMAL(65,30),
    "currency" TEXT,

    CONSTRAINT "sessions_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "title" TEXT,
    "coach_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "coach_profile_id" TEXT NOT NULL,
    "appointment_date" TIMESTAMP(3) NOT NULL,
    "session_time" TIMESTAMP(3),
    "duration_minutes" INTEGER DEFAULT 60,
    "session_price" DECIMAL(65,30) DEFAULT 55,
    "location" TEXT DEFAULT 'offline',
    "session_package_id" TEXT,
    "description" TEXT,
    "number_of_sessions" INTEGER,
    "days_validity" INTEGER,
    "total_completed_session" INTEGER DEFAULT 0,
    "validation_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "total_amount" DECIMAL(65,30),
    "currency" TEXT,
    "payment_transaction_id" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "rating" INTEGER,
    "feedback" TEXT,
    "google_map_link" TEXT,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_profiles_user_id_key" ON "coach_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions_packages" ADD CONSTRAINT "sessions_packages_coach_profile_id_fkey" FOREIGN KEY ("coach_profile_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coach_profile_id_fkey" FOREIGN KEY ("coach_profile_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_package_id_fkey" FOREIGN KEY ("session_package_id") REFERENCES "sessions_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
