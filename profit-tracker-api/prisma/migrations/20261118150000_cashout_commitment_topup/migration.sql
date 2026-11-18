-- Several purchases can share one provider commitment (buying more of an item
-- already committed raises it), so neither the item nor the provider's
-- commitment id is unique per row any more. Additive otherwise: existing rows
-- keep their values and each stays a one-purchase commitment.
DROP INDEX "CashoutCommitment_connection_id_open_item_id_key";
DROP INDEX "CashoutCommitment_external_commitment_id_key";

CREATE INDEX "CashoutCommitment_connection_id_open_item_id_idx" ON "CashoutCommitment"("connection_id", "open_item_id");
CREATE INDEX "CashoutCommitment_external_commitment_id_idx" ON "CashoutCommitment"("external_commitment_id");

ALTER TABLE "CashoutCommitment" ADD COLUMN "commit_error" TEXT;
