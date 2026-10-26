-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "tax_details" JSONB,
ADD COLUMN "tax_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "schedule_c_enabled" BOOLEAN NOT NULL DEFAULT false;
