-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "confidence" JSONB,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "discount" DECIMAL(12,2),
ADD COLUMN     "extract_error" TEXT,
ADD COLUMN     "extracted_at" TIMESTAMP(3),
ADD COLUMN     "items" JSONB,
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "order_number" TEXT,
ADD COLUMN     "parser" TEXT,
ADD COLUMN     "parser_version" INTEGER,
ADD COLUMN     "payment_hint" TEXT,
ADD COLUMN     "shipping" DECIMAL(12,2),
ADD COLUMN     "subtotal" DECIMAL(12,2),
ADD COLUMN     "tax" DECIMAL(12,2),
ADD COLUMN     "total" DECIMAL(12,2),
ADD COLUMN     "tracking_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "uid_validity" TEXT;

-- CreateIndex
CREATE INDEX "EmailMessage_user_id_order_number_idx" ON "EmailMessage"("user_id", "order_number");

-- CreateIndex
CREATE INDEX "EmailMessage_account_id_status_idx" ON "EmailMessage"("account_id", "status");

