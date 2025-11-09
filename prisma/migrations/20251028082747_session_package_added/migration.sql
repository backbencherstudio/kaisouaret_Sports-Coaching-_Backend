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

-- AddForeignKey
ALTER TABLE "sessions_packages" ADD CONSTRAINT "sessions_packages_coach_profile_id_fkey" FOREIGN KEY ("coach_profile_id") REFERENCES "coach_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
