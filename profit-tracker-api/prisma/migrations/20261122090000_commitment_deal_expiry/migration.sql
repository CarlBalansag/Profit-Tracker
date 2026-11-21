-- When the commitment's deal ends, for the To-Do list's "deal ends soon" warning.
ALTER TABLE "CashoutCommitment" ADD COLUMN "deal_expires_at" TIMESTAMP(3);
