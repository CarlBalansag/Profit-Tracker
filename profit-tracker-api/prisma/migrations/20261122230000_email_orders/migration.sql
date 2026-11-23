-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "order_id" TEXT;

-- CreateTable
CREATE TABLE "EmailOrder" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "order_number" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "first_seen" TIMESTAMP(3),
    "last_seen" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total" DECIMAL(12,2),
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "shipping" DECIMAL(12,2),
    "discount" DECIMAL(12,2),
    "tracking_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "items" JSONB,
    "payment_hint" TEXT,
    "match_state" TEXT NOT NULL DEFAULT 'unmatched',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMatch" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_ids" TEXT[],
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'suggested',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailOrder_user_id_match_state_idx" ON "EmailOrder"("user_id", "match_state");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOrder_user_id_key_key" ON "EmailOrder"("user_id", "key");

-- CreateIndex
CREATE INDEX "EmailMatch_user_id_state_idx" ON "EmailMatch"("user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMatch_order_id_record_type_record_ids_key" ON "EmailMatch"("order_id", "record_type", "record_ids");

-- CreateIndex
CREATE INDEX "EmailMessage_order_id_idx" ON "EmailMessage"("order_id");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "EmailOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOrder" ADD CONSTRAINT "EmailOrder_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMatch" ADD CONSTRAINT "EmailMatch_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMatch" ADD CONSTRAINT "EmailMatch_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "EmailOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

