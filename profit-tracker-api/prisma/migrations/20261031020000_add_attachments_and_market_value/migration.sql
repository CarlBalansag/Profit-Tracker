-- Additive only: creates the Attachment table and adds three nullable
-- market-value columns to Inventory. Nothing is dropped, renamed, or altered.

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "kind" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_user_id_entity_type_entity_id_idx" ON "Attachment"("user_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN "market_value" DECIMAL(19,2),
ADD COLUMN "market_source" TEXT,
ADD COLUMN "market_checked_at" TIMESTAMP(3);
