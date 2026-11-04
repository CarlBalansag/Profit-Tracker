-- Additive only: one nullable column. Existing vendors keep NULL (no usual return
-- window), so no backfill and every existing read/write keeps working.

-- AlterTable
ALTER TABLE "Platform" ADD COLUMN     "default_return_days" INTEGER;
