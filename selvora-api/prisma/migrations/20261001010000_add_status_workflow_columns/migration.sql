BEGIN;

-- Additive status-workflow columns (checkpoint 1 of the status rework).
-- Every column is nullable or defaulted, nothing is dropped or renamed, and the
-- legacy "Inventory"."status" / "Sales"."status" columns are untouched, so every
-- existing read and write keeps working exactly as before. Nothing writes these
-- columns yet except scripts/migrateStatusWorkflow.js.

-- Inventory receiving: PRE_ORDER -> PURCHASED -> INBOUND -> ON_HAND.
-- NULL distinguishes a row the backfill has not visited (or deliberately left
-- for a human to resolve) from one it mapped.
ALTER TABLE "Inventory" ADD COLUMN "receiving_status" TEXT;
-- Listing is an attribute, not a receiving step: UNLISTED <-> LISTED.
ALTER TABLE "Inventory" ADD COLUMN "is_listed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Inventory" ADD COLUMN "received_at" TIMESTAMP(3);
ALTER TABLE "Inventory" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "Inventory" ADD COLUMN "correction_note" TEXT;

-- Sales workflow. workflow_type pins the preset chosen when the sale was
-- created so a later change to the platform's preset cannot rewrite old sales.
ALTER TABLE "Sales" ADD COLUMN "workflow_type" TEXT;
ALTER TABLE "Sales" ADD COLUMN "workflow_status" TEXT;
ALTER TABLE "Sales" ADD COLUMN "delivered_at" TIMESTAMP(3);
-- Confirmed payment. Distinct from the existing user-entered "payout_date",
-- which is only an expected-payout reminder date.
ALTER TABLE "Sales" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "Sales" ADD COLUMN "paid_amount" NUMERIC(19,2);
ALTER TABLE "Sales" ADD COLUMN "paid_reference" TEXT;
-- Exception milestones. The sync_Sales_currency trigger added by
-- 20260930000000_additive_currency_decimals only assigns the "_decimal" mirror
-- columns, so these additions do not affect it. "paid_amount" has no Float
-- counterpart and is therefore exact-decimal from the start, with no mirror.
ALTER TABLE "Sales" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "Sales" ADD COLUMN "voided_at" TIMESTAMP(3);
ALTER TABLE "Sales" ADD COLUMN "return_requested_at" TIMESTAMP(3);
ALTER TABLE "Sales" ADD COLUMN "returned_at" TIMESTAMP(3);
ALTER TABLE "Sales" ADD COLUMN "disputed_at" TIMESTAMP(3);

-- Default sale workflow for new sales on a platform. Deliberately a new column
-- rather than an overload of "Platform"."type", whose live values
-- ('Vendor' | 'Marketplace' | 'Cashout') other screens already depend on.
ALTER TABLE "Platform" ADD COLUMN "workflow_preset" TEXT;

COMMIT;
