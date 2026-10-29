-- Additive only: one nullable column, its index, and a SET NULL foreign key.
-- Existing sales keep NULL (label taken out of the payout), so no backfill and
-- every existing read/write against Sales keeps working unchanged.

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN     "sale_shipping_payment_method_id" TEXT;

-- CreateIndex
CREATE INDEX "Sales_sale_shipping_payment_method_id_idx" ON "Sales"("sale_shipping_payment_method_id");

-- AddForeignKey
ALTER TABLE "Sales" ADD CONSTRAINT "Sales_sale_shipping_payment_method_id_fkey" FOREIGN KEY ("sale_shipping_payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
