BEGIN;

-- Lets a user manually fast-track a PAID sale into the Statuses board's
-- Completed section, instead of waiting out the automatic "3 days after
-- paid_at" window. Nullable, no default, nothing dropped or renamed -- every
-- existing read and write keeps working exactly as before.
--
-- Deliberately separate from `paid_at`: paid_at is the real payment date used
-- in financial reporting, so it must never be overwritten just to influence
-- when a card visually ages into Completed. completed_at only ever means "a
-- user explicitly marked this done early" and workflow_status itself never
-- changes when it is set.
ALTER TABLE "Sales" ADD COLUMN "completed_at" TIMESTAMP(3);

COMMIT;
