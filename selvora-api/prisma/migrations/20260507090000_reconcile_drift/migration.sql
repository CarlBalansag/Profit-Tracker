-- This migration reconciles schema drift: columns and indexes that were added
-- directly to the database outside of migration history. These already exist
-- in the live DB so this file is marked applied via `migrate resolve --applied`
-- without being executed.

-- Inventory: tax_exempt column and indexes
ALTER TABLE "Inventory" ADD COLUMN IF NOT EXISTS "tax_exempt" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Inventory_tax_exempt_idx" ON "Inventory"("tax_exempt");
CREATE INDEX IF NOT EXISTS "Inventory_user_id_idx" ON "Inventory"("user_id");
CREATE INDEX IF NOT EXISTS "Inventory_user_id_purchase_date_idx" ON "Inventory"("user_id", "purchase_date");

-- Platform: tax_exempt_place column
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "tax_exempt_place" BOOLEAN NOT NULL DEFAULT false;

-- Sales: additional columns and indexes
ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "taxable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "sale_tax_collected" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "customer_tax_exempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "exemption_type" TEXT;
ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "sale_shipping" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "Sales_inventory_id_idx" ON "Sales"("inventory_id");
CREATE INDEX IF NOT EXISTS "Sales_platform_id_idx" ON "Sales"("platform_id");
CREATE INDEX IF NOT EXISTS "Sales_sale_date_idx" ON "Sales"("sale_date");

-- Expense: indexes
CREATE INDEX IF NOT EXISTS "Expense_user_id_idx" ON "Expense"("user_id");
CREATE INDEX IF NOT EXISTS "Expense_user_id_date_idx" ON "Expense"("user_id", "date");

-- user_sessions table (managed by connect-pg-simple, already exists in DB)
CREATE TABLE IF NOT EXISTS "user_sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
);
