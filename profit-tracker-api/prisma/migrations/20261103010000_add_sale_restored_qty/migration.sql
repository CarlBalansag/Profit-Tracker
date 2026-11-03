-- Units a cancel_sale/void_sale/mark_returned status action put back in stock.
-- Without it, deleting or recounting a cancelled/returned sale restored or
-- counted those units a second time.

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN "restored_qty" INTEGER NOT NULL DEFAULT 0;

-- Backfill: every one of those actions stamps its own timestamp, and until now
-- each restored all the units the sale still held (quantity - refunded_qty;
-- refunds are refused once a sale is cancelled/returned, so that is unchanged).
-- A past partial mark_returned is not recoverable and is counted as full.
-- Legacy status edits never restored stock and never set these timestamps.
UPDATE "Sales"
SET "restored_qty" = "quantity" - "refunded_qty"
WHERE "cancelled_at" IS NOT NULL OR "voided_at" IS NOT NULL OR "returned_at" IS NOT NULL;
