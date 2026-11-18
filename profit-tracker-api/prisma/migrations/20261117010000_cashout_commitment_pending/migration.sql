-- A commitment can now be saved as "pending" before it is committed with the
-- provider: Log Purchase without a tracking number records the purchase and
-- sale, and the commit happens once tracking is added. Until then there is no
-- provider commitment id. Postgres unique indexes allow many NULLs.
ALTER TABLE "CashoutCommitment" ALTER COLUMN "external_commitment_id" DROP NOT NULL;
