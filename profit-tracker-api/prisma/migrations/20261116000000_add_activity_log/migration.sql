-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "reverts_id" TEXT,
    "undone_at" TIMESTAMP(3),
    "undone_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_user_id_created_at_idx" ON "ActivityLog"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ActivityLog_user_id_record_id_idx" ON "ActivityLog"("user_id", "record_id");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
