-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN "tracking_info" JSONB;

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN "tracking_number" TEXT,
ADD COLUMN "tracking_info" JSONB;
