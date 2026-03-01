/*
  Warnings:

  - You are about to drop the column `image` on the `marketplace_products` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "marketplace_products" DROP COLUMN "image",
ADD COLUMN     "images" TEXT[];
