-- To-Do page: what the user did with an item (snoozed, dismissed, done).
-- Additive: a new table only.
CREATE TABLE "TodoState" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "until" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodoState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TodoState_user_id_key_key" ON "TodoState"("user_id", "key");
CREATE INDEX "TodoState_user_id_idx" ON "TodoState"("user_id");

ALTER TABLE "TodoState" ADD CONSTRAINT "TodoState_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
