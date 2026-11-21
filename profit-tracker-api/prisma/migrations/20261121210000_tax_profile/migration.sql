-- Optional per-year tax profile for the Schedule C tax estimate. Additive: a
-- new table only. Holds amounts and counts, never SSNs, names or birth dates.
-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "state" TEXT,
    "filing_status" TEXT NOT NULL,
    "non_business_income" DECIMAL(19,2),
    "wages" DECIMAL(19,2),
    "other_se_income" DECIMAL(19,2),
    "federal_withholding" DECIMAL(19,2),
    "state_withholding" DECIMAL(19,2),
    "federal_estimated_paid" DECIMAL(19,2),
    "state_estimated_paid" DECIMAL(19,2),
    "qualifying_children" INTEGER,
    "other_dependents" INTEGER,
    "age65" BOOLEAN NOT NULL DEFAULT false,
    "spouse_age65" BOOLEAN NOT NULL DEFAULT false,
    "adjustments" DECIMAL(19,2),
    "itemized_deductions" DECIMAL(19,2),
    "prior_year_tax" DECIMAL(19,2),
    "prior_year_agi" DECIMAL(19,2),
    "reserve_mode" TEXT NOT NULL DEFAULT 'personalized',
    "flat_rate" DECIMAL(6,4),
    "buffer_rate" DECIMAL(6,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxProfile_user_id_year_key" ON "TaxProfile"("user_id", "year");

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

