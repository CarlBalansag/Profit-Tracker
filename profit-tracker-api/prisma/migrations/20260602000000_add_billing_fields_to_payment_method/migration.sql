-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN "statement_close_day" INTEGER,
ADD COLUMN "due_day" INTEGER,
ADD COLUMN "credit_limit" DOUBLE PRECISION,
ADD COLUMN "min_payment_pct" DOUBLE PRECISION;
