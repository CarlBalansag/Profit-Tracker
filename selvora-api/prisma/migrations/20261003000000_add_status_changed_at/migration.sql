BEGIN;

-- "Last status updated" timestamps for the status workflow (additive).
-- Neither Inventory nor Sales has ever carried a generic updated-at column, so
-- the Statuses board had no way to say when a card last moved. These two
-- columns record exactly that: the moment the record's own workflow status last
-- changed -- not the moment any field on the row was edited.
--
-- Both are nullable with no default and nothing is dropped or renamed, so every
-- existing read and write keeps working exactly as before. There is deliberately
-- no backfill: a row created before this migration keeps NULL until its next
-- real status change, and the UI renders no timestamp at all for NULL rather
-- than inventing a misleading one.

-- Set whenever a transition writes a new "Inventory"."receiving_status", and at
-- creation time alongside the first receiving_status. A change that does not
-- touch the status (e.g. a qty_on_hand correction) deliberately leaves it alone.
ALTER TABLE "Inventory" ADD COLUMN "receiving_status_changed_at" TIMESTAMP(3);

-- The sale-side counterpart, for "Sales"."workflow_status". The
-- sync_Sales_currency trigger added by 20260930000000_additive_currency_decimals
-- only assigns the "_decimal" mirror columns, so this addition does not affect it.
ALTER TABLE "Sales" ADD COLUMN "workflow_status_changed_at" TIMESTAMP(3);

COMMIT;
