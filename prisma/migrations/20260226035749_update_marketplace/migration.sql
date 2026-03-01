/*
  Warnings:

  - You are about to drop the column `brand_seller` on the `marketplace_products` table. All the data in the column will be lost.
  - The `category` column on the `marketplace_products` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('EQUIPMENT', 'APPAREL', 'NUTRITION', 'ACCESSORIES');

-- AlterTable
ALTER TABLE "marketplace_products" DROP COLUMN "brand_seller",
ADD COLUMN     "brand_name" TEXT,
ADD COLUMN     "sold_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "ProductStatus" DEFAULT 'ACTIVE',
DROP COLUMN "category",
ADD COLUMN     "category" "ProductCategory";
