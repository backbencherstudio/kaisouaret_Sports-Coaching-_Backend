-- CreateTable
CREATE TABLE "coach_profiles" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" SMALLINT DEFAULT 1,
    "user_id" TEXT NOT NULL,
    "bio" TEXT,
    "specialty" TEXT,
    "experience_level" TEXT,
    "certifications" TEXT,
    "hourly_rate" DECIMAL(65,30),
    "hourly_currency" TEXT,
    "is_verified" SMALLINT DEFAULT 0,

    CONSTRAINT "coach_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_profiles_user_id_key" ON "coach_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
