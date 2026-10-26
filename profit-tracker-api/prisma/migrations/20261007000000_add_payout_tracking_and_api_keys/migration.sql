-- Additive only: no column dropped, renamed, or made non-nullable. Existing
-- reads/writes against Sales and PaymentMethod keep working unchanged.

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN     "payout_account" TEXT,
ADD COLUMN     "payout_short_amount" DECIMAL(19,2);

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "is_personal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpWriteLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "tool" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpWriteLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_hash_key" ON "ApiKey"("key_hash");

-- CreateIndex
CREATE INDEX "ApiKey_user_id_idx" ON "ApiKey"("user_id");

-- CreateIndex
CREATE INDEX "McpWriteLog_user_id_created_at_idx" ON "McpWriteLog"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpWriteLog" ADD CONSTRAINT "McpWriteLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
