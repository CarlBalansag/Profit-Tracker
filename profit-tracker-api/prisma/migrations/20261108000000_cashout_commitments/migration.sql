-- A pledge to send units for one deal line item, made through Log Purchase.
-- One row per provider commitment, at most one per (connection, item).
CREATE TABLE "CashoutCommitment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "sale_id" TEXT,
    "external_deal_id" TEXT NOT NULL,
    "external_item_id" TEXT NOT NULL,
    "external_commitment_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tracking_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tracking_submitted_at" TIMESTAMP(3),
    "tracking_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashoutCommitment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashoutCommitment_sale_id_key" ON "CashoutCommitment"("sale_id");
CREATE UNIQUE INDEX "CashoutCommitment_external_commitment_id_key" ON "CashoutCommitment"("external_commitment_id");
CREATE UNIQUE INDEX "CashoutCommitment_connection_id_external_item_id_key" ON "CashoutCommitment"("connection_id", "external_item_id");
CREATE INDEX "CashoutCommitment_user_id_idx" ON "CashoutCommitment"("user_id");
CREATE INDEX "CashoutCommitment_connection_id_idx" ON "CashoutCommitment"("connection_id");

ALTER TABLE "CashoutCommitment" ADD CONSTRAINT "CashoutCommitment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashoutCommitment" ADD CONSTRAINT "CashoutCommitment_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "CashoutConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashoutCommitment" ADD CONSTRAINT "CashoutCommitment_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
