-- Invoices: a number per user, notes, tax and timestamps on Invoice, and the
-- lines (copies of the invoiced sales) in InvoiceLine.
ALTER TABLE "Invoice"
  ADD COLUMN "number" INTEGER,
  ADD COLUMN "tax_amount" DECIMAL(19,2) NOT NULL DEFAULT 0,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE UNIQUE INDEX "Invoice_user_id_number_key" ON "Invoice"("user_id", "number");

CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "sale_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(19,2) NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "tax" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "sale_date" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceLine_invoice_id_idx" ON "InvoiceLine"("invoice_id");
CREATE INDEX "InvoiceLine_sale_id_idx" ON "InvoiceLine"("sale_id");

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
