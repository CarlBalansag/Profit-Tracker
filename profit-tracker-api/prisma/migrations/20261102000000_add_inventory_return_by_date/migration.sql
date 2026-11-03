-- Additive only: one nullable column. Existing purchases keep NULL (no return
-- window recorded), so no backfill and every existing read/write keeps working.

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "return_by_date" TIMESTAMP(3);
