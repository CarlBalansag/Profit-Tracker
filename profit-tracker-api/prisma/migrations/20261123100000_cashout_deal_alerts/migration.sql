-- Cashout deal alerts: per-user settings, the shared list of deals seen, and
-- the alert moments the push sender works through.
ALTER TABLE "NotificationSettings"
  ADD COLUMN "deal_alerts" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deal_min_profit" DECIMAL(19,2) NOT NULL DEFAULT 0,
  ADD COLUMN "deal_providers" JSONB,
  ADD COLUMN "deal_stores" JSONB,
  ADD COLUMN "deal_quiet_from" TEXT,
  ADD COLUMN "deal_quiet_to" TEXT;

CREATE TABLE "CashoutDeal" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_deal_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "deal_url" TEXT,
    "retail" DECIMAL(19,2),
    "payout" DECIMAL(19,2) NOT NULL,
    "stores" JSONB,
    "vendor_limit" INTEGER,
    "expires_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alerted_payout" DECIMAL(19,2),
    CONSTRAINT "CashoutDeal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CashoutDeal_provider_external_deal_id_key" ON "CashoutDeal"("provider", "external_deal_id");
CREATE INDEX "CashoutDeal_last_seen_at_idx" ON "CashoutDeal"("last_seen_at");

CREATE TABLE "CashoutDealAlert" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payout" DECIMAL(19,2) NOT NULL,
    "previous_payout" DECIMAL(19,2),
    "retail" DECIMAL(19,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    CONSTRAINT "CashoutDealAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CashoutDealAlert_created_at_idx" ON "CashoutDealAlert"("created_at");
CREATE INDEX "CashoutDealAlert_dispatched_at_idx" ON "CashoutDealAlert"("dispatched_at");
ALTER TABLE "CashoutDealAlert" ADD CONSTRAINT "CashoutDealAlert_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "CashoutDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
