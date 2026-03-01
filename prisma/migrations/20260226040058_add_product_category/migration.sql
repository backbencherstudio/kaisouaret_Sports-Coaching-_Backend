/*
  Warnings:

  - The `category` column on the `marketplace_products` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "marketplace_products" DROP COLUMN "category",
ADD COLUMN     "category" TEXT;

-- DropEnum
DROP TYPE "ProductCategory";

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "status" SMALLINT DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);
