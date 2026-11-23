-- Phase 9: finalized Schedule C reports and their revisions. Additive: a new table only.
-- CreateTable
CREATE TABLE "TaxReportSnapshot" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT,
    "report" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "input_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxReportSnapshot_user_id_year_revision_key" ON "TaxReportSnapshot"("user_id", "year", "revision");

-- AddForeignKey
ALTER TABLE "TaxReportSnapshot" ADD CONSTRAINT "TaxReportSnapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

