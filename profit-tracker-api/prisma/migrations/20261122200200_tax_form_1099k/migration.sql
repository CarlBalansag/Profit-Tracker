-- Form 1099-K amounts the user enters to compare with their sales on the
-- Schedule C page. Additive: a new table only. No TINs or account numbers.
-- CreateTable
CREATE TABLE "TaxForm1099K" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "payer_name" TEXT NOT NULL,
    "platform_id" TEXT,
    "gross_amount" DECIMAL(19,2) NOT NULL,
    "transaction_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxForm1099K_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxForm1099K_user_id_year_idx" ON "TaxForm1099K"("user_id", "year");

-- AddForeignKey
ALTER TABLE "TaxForm1099K" ADD CONSTRAINT "TaxForm1099K_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxForm1099K" ADD CONSTRAINT "TaxForm1099K_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "Platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

