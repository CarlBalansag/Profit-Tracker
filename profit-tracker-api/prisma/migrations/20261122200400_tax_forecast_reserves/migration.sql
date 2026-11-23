-- Phase 6: how to project the year's profit (on the tax profile), and a ledger of
-- money set aside for taxes. Additive: two nullable columns and a new table.
-- AlterTable
ALTER TABLE "TaxProfile" ADD COLUMN     "forecast_method" TEXT,
ADD COLUMN     "profit_target" DECIMAL(19,2);

-- CreateTable
CREATE TABLE "TaxReserveEntry" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxReserveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxReserveEntry_user_id_year_idx" ON "TaxReserveEntry"("user_id", "year");

-- AddForeignKey
ALTER TABLE "TaxReserveEntry" ADD CONSTRAINT "TaxReserveEntry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

