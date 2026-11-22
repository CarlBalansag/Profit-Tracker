-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "documentation" TEXT,
ADD COLUMN     "documentation_note" TEXT;

-- CreateTable
CREATE TABLE "EmailMerchantRule" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "domain" TEXT,
    "label" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'create_expense',
    "auto" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "tax_category" TEXT,
    "business_use" TEXT NOT NULL DEFAULT 'business',
    "business_percent" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "purpose" TEXT,
    "payment_method_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMerchantRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMerchantRule_user_id_merchant_key" ON "EmailMerchantRule"("user_id", "merchant");

-- AddForeignKey
ALTER TABLE "EmailMerchantRule" ADD CONSTRAINT "EmailMerchantRule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

