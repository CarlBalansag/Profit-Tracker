BEGIN;

ALTER TABLE "Buyer" ADD COLUMN "user_id" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "user_id" TEXT;

-- Assign only buyers whose linked purchases identify exactly one owner.
WITH owners AS (
  SELECT s."buyer_id", MIN(i."user_id") AS "user_id"
  FROM "Sales" s JOIN "Inventory" i ON i."id" = s."inventory_id"
  WHERE s."buyer_id" IS NOT NULL
  GROUP BY s."buyer_id" HAVING COUNT(DISTINCT i."user_id") = 1
)
UPDATE "Buyer" b SET "user_id" = owners."user_id"
FROM owners WHERE b."id" = owners."buyer_id";

UPDATE "Invoice" inv SET "user_id" = b."user_id"
FROM "Buyer" b WHERE inv."buyer_id" = b."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Buyer" WHERE "user_id" IS NULL)
     OR EXISTS (SELECT 1 FROM "Invoice" WHERE "user_id" IS NULL) THEN
    RAISE EXCEPTION 'Buyer/Invoice ownership is ambiguous or missing. Resolve historical ownership before migrating; no records were reassigned arbitrarily.';
  END IF;
END $$;

ALTER TABLE "Buyer" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Buyer_user_id_idx" ON "Buyer"("user_id");
CREATE INDEX "Invoice_user_id_idx" ON "Invoice"("user_id");
CREATE UNIQUE INDEX "Buyer_id_user_id_key" ON "Buyer"("id", "user_id");
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_buyer_id_fkey";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_buyer_id_user_id_fkey"
  FOREIGN KEY ("buyer_id", "user_id") REFERENCES "Buyer"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
