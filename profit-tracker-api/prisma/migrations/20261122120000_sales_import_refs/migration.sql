-- AlterTable
ALTER TABLE "Sales" ADD COLUMN "import_refs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Sales_import_refs_idx" ON "Sales" USING GIN ("import_refs");
