/*
  Warnings:

  - You are about to drop the column `product_id` on the `marketplace_orders` table. All the data in the column will be lost.
  - You are about to drop the column `quantity` on the `marketplace_orders` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "marketplace_orders" DROP CONSTRAINT "marketplace_orders_product_id_fkey";

-- AlterTable
ALTER TABLE "marketplace_orders" DROP COLUMN "product_id",
DROP COLUMN "quantity",
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "payment_transaction_id" TEXT,
ADD COLUMN     "shipped_at" TIMESTAMP(3),
ADD COLUMN     "shipping_address" TEXT,
ADD COLUMN     "shipping_city" TEXT,
ADD COLUMN     "shipping_country" TEXT,
ADD COLUMN     "shipping_phone" TEXT,
ADD COLUMN     "shipping_state" TEXT,
ADD COLUMN     "shipping_zip_code" TEXT,
ADD COLUMN     "tracking_number" TEXT,
ALTER COLUMN "currency" SET DEFAULT 'usd';

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "client_secret" TEXT,
ADD COLUMN     "payment_gateway" TEXT,
ADD COLUMN     "payment_intent_id" TEXT;

-- CreateTable
CREATE TABLE "marketplace_order_items" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(65,30) NOT NULL,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "product_name" TEXT,
    "product_description" TEXT,
    "product_image" TEXT,

    CONSTRAINT "marketplace_order_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_order_items" ADD CONSTRAINT "marketplace_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "marketplace_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
