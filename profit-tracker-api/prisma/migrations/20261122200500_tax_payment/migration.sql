-- Phase 7: tax payments the user records (estimated, extension or other), per
-- tax year and jurisdiction. Additive: a new table only.
-- CreateTable
CREATE TABLE "TaxPayment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "paid_date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxPayment_user_id_year_idx" ON "TaxPayment"("user_id", "year");

-- AddForeignKey
ALTER TABLE "TaxPayment" ADD CONSTRAINT "TaxPayment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

