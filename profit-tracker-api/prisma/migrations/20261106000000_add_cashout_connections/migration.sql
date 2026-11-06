-- Cashout Connections, Deal Snapshots, and Item Matches.
-- Purely additive: creates three new tables without touching existing data.

-- CreateTable
CREATE TABLE "CashoutConnection" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "display_name" TEXT,
    "encrypted_key" TEXT NOT NULL,
    "key_last4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "platform_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashoutConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashoutDealSnapshot" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_deal_id" TEXT NOT NULL,
    "external_item_id" TEXT,
    "item_name" TEXT NOT NULL,
    "condition" TEXT,
    "payout" DECIMAL(19,2) NOT NULL,
    "retail" DECIMAL(19,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashoutDealSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashoutItemMatch" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "provider" TEXT NOT NULL,
    "external_deal_id" TEXT NOT NULL,
    "deal_item_name" TEXT NOT NULL,
    "inventory_id" TEXT,
    "inventory_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashoutItemMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashoutConnection_user_id_idx" ON "CashoutConnection"("user_id");
CREATE INDEX "CashoutConnection_provider_idx" ON "CashoutConnection"("provider");

-- CreateIndex
CREATE INDEX "CashoutDealSnapshot_user_id_provider_external_deal_id_idx" ON "CashoutDealSnapshot"("user_id", "provider", "external_deal_id");
CREATE INDEX "CashoutDealSnapshot_captured_at_idx" ON "CashoutDealSnapshot"("captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "CashoutItemMatch_user_id_provider_external_deal_id_key" ON "CashoutItemMatch"("user_id", "provider", "external_deal_id");
CREATE INDEX "CashoutItemMatch_user_id_idx" ON "CashoutItemMatch"("user_id");

-- AddForeignKey
ALTER TABLE "CashoutConnection" ADD CONSTRAINT "CashoutConnection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashoutConnection" ADD CONSTRAINT "CashoutConnection_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "Platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashoutDealSnapshot" ADD CONSTRAINT "CashoutDealSnapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashoutDealSnapshot" ADD CONSTRAINT "CashoutDealSnapshot_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "CashoutConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashoutItemMatch" ADD CONSTRAINT "CashoutItemMatch_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashoutItemMatch" ADD CONSTRAINT "CashoutItemMatch_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "CashoutConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
