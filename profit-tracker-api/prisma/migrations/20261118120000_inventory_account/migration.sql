-- Optional store account (login) a purchase was made on.
ALTER TABLE "Inventory" ADD COLUMN "account_id" TEXT;

CREATE INDEX "Inventory_account_id_idx" ON "Inventory"("account_id");

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
