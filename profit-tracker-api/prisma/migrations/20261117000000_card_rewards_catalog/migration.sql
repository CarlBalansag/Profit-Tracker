-- Points vs cashback cards, plus a cached copy of the OpenCard DB catalog.
-- Additive only: every existing card stays a cashback card with its current
-- rates, so no saved total changes until the user opts in.
ALTER TABLE "PaymentMethod" ADD COLUMN "reward_type" TEXT NOT NULL DEFAULT 'cashback';
ALTER TABLE "PaymentMethod" ADD COLUMN "points_base_rate" DOUBLE PRECISION;
ALTER TABLE "PaymentMethod" ADD COLUMN "point_value_cents" DOUBLE PRECISION;
ALTER TABLE "PaymentMethod" ADD COLUMN "rewards_label" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "catalog_card_id" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "rework_prompt_state" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "catalog_applied" TEXT;
ALTER TABLE "PaymentMethod" ADD COLUMN "catalog_synced_at" TIMESTAMP(3);

CREATE TABLE "CardCatalog" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "card_count" INTEGER NOT NULL,
    "source_url" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "last_verified" TEXT,

    CONSTRAINT "CardCatalog_pkey" PRIMARY KEY ("id")
);
