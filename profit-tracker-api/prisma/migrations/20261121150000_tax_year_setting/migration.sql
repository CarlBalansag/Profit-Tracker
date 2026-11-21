-- Per-user, per-tax-year Schedule C settings. Starts with the cost of stock
-- on hand at year end that is not entered as purchases (opening inventory for
-- users who had stock before they started tracking). Additive: a new table only.
-- CreateTable
CREATE TABLE "TaxYearSetting" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "untracked_inventory_end" DECIMAL(19,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxYearSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxYearSetting_user_id_year_key" ON "TaxYearSetting"("user_id", "year");

-- AddForeignKey
ALTER TABLE "TaxYearSetting" ADD CONSTRAINT "TaxYearSetting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

