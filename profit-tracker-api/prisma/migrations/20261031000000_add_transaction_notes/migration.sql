-- Additive only: creates the TransactionNote table and copies existing legacy
-- notes into it. Inventory.notes, Sales.notes, and ProductNote are left exactly
-- as they are (no column dropped, renamed, or altered).

-- CreateTable
CREATE TABLE "TransactionNote" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'carl',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "TransactionNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionNote_user_id_entity_type_entity_id_idx" ON "TransactionNote"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "TransactionNote_user_id_created_at_idx" ON "TransactionNote"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "TransactionNote" ADD CONSTRAINT "TransactionNote_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one note per purchase that has a non-blank legacy note. "Blank"
-- means empty after trimming spaces, tabs, and line breaks
-- (chr(32) || chr(9) || chr(13) || chr(10)).
INSERT INTO "TransactionNote" ("id", "user_id", "entity_type", "entity_id", "body", "author", "pinned", "created_at", "updated_at")
SELECT gen_random_uuid()::text, i."user_id", 'purchase', i."id", btrim(i."notes", chr(32) || chr(9) || chr(13) || chr(10)), 'bot', false, now(), now()
FROM "Inventory" i
WHERE i."notes" IS NOT NULL AND btrim(i."notes", chr(32) || chr(9) || chr(13) || chr(10)) <> '';

-- Backfill: one note per sale that has a non-blank legacy note. Sales has no
-- user_id of its own; the owner comes from the purchase it was sold from.
INSERT INTO "TransactionNote" ("id", "user_id", "entity_type", "entity_id", "body", "author", "pinned", "created_at", "updated_at")
SELECT gen_random_uuid()::text, i."user_id", 'sale', s."id", btrim(s."notes", chr(32) || chr(9) || chr(13) || chr(10)), 'bot', false, now(), now()
FROM "Sales" s
JOIN "Inventory" i ON i."id" = s."inventory_id"
WHERE s."notes" IS NOT NULL AND btrim(s."notes", chr(32) || chr(9) || chr(13) || chr(10)) <> '';
