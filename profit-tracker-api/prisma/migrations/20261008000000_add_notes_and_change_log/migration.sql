-- Additive only: no column dropped, renamed, or made non-nullable. Existing
-- reads/writes against Sales and Inventory keep working unchanged.

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeLog_user_id_created_at_idx" ON "ChangeLog"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ChangeLog_user_id_record_id_idx" ON "ChangeLog"("user_id", "record_id");

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
