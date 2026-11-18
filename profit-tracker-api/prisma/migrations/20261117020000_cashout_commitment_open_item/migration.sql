-- Withdrawing a commitment keeps its row (the sale's history points at it),
-- but the unique index on (connection_id, external_item_id) then blocked
-- ever committing that item again. The rule moves to open_item_id, which
-- holds the item id only while the commitment is open and is null once it's
-- withdrawn. Postgres unique indexes allow any number of nulls.
ALTER TABLE "CashoutCommitment" ADD COLUMN "open_item_id" TEXT;

UPDATE "CashoutCommitment" SET "open_item_id" = "external_item_id" WHERE "status" <> 'withdrawn';

DROP INDEX "CashoutCommitment_connection_id_external_item_id_key";

CREATE UNIQUE INDEX "CashoutCommitment_connection_id_open_item_id_key" ON "CashoutCommitment"("connection_id", "open_item_id");
