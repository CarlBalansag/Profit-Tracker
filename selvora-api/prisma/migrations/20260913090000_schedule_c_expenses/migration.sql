-- Additive only: existing records remain unclassified and are never auto-deducted.
ALTER TABLE "User" ADD COLUMN "schedule_c_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Expense" ADD COLUMN "tax_details" JSONB;
ALTER TABLE "Expense" ADD COLUMN "tax_version" INTEGER NOT NULL DEFAULT 0;
