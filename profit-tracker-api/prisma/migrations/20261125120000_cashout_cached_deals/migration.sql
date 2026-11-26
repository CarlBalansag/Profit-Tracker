-- The last deal list of a cashout checked only once a day (LA, Points4Days),
-- so a server restart does not mean signing in to it again.
ALTER TABLE "CashoutConnection" ADD COLUMN "cached_deals" JSONB;
