-- A connection saved before cashout_access_granted existed already proved its
-- key works at creation time -- carry that forward instead of leaving these
-- users stuck at false until they happen to add or replace a key again.
UPDATE "User"
SET "cashout_access_granted" = true
WHERE "id" IN (SELECT DISTINCT "user_id" FROM "CashoutConnection");
