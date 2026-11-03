-- Refunds (part 1). Additive only: new Refund table plus running-total columns
-- defaulting to 0, so every existing purchase and sale keeps its current numbers.

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "refunded_amount" DECIMAL(19,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refunded_qty" INTEGER NOT NULL DEFAULT 0;
-- AlterTable
ALTER TABLE "Sales" ADD COLUMN     "refunded_amount" DECIMAL(19,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refunded_qty" INTEGER NOT NULL DEFAULT 0;
-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "inventory_id" TEXT,
    "sale_id" TEXT,
    "amount" DECIMAL(19,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Refund_user_id_date_idx" ON "Refund"("user_id", "date");
-- CreateIndex
CREATE INDEX "Refund_inventory_id_idx" ON "Refund"("inventory_id");
-- CreateIndex
CREATE INDEX "Refund_sale_id_idx" ON "Refund"("sale_id");
-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Safety checks Prisma cannot express: a refund belongs to exactly one purchase

-- or one sale, and no amount, unit count or running total can go negative.

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_one_owner_check" CHECK (("inventory_id" IS NULL) <> ("sale_id" IS NULL));

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_non_negative_check" CHECK ("amount" >= 0 AND "quantity" >= 0);

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_refunded_non_negative_check" CHECK ("refunded_amount" >= 0 AND "refunded_qty" >= 0);

ALTER TABLE "Sales" ADD CONSTRAINT "Sales_refunded_non_negative_check" CHECK ("refunded_amount" >= 0 AND "refunded_qty" >= 0);
