-- Additive only: one nullable column on each table, recording why a sale or
-- purchase was voided through the MCP void_sale / void_purchase tools. Existing
-- rows keep NULL, so there is no backfill and nothing is dropped or altered.

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN "void_reason" TEXT;

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN "void_reason" TEXT;
