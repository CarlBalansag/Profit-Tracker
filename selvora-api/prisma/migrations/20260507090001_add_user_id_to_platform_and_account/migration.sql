-- Add user_id to Platform table
-- First add as nullable so existing rows aren't rejected
ALTER TABLE "Platform" ADD COLUMN "user_id" TEXT;

-- Backfill: assign all existing platforms to the first user in the DB
-- (safe for single-user apps; adjust if multi-tenant data already exists)
UPDATE "Platform" SET "user_id" = (SELECT "id" FROM "User" ORDER BY "id" LIMIT 1)
WHERE "user_id" IS NULL;

-- Now enforce NOT NULL
ALTER TABLE "Platform" ALTER COLUMN "user_id" SET NOT NULL;

-- Add foreign key constraint
ALTER TABLE "Platform" ADD CONSTRAINT "Platform_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add index
CREATE INDEX "Platform_user_id_idx" ON "Platform"("user_id");

-- Add user_id to Account table
ALTER TABLE "Account" ADD COLUMN "user_id" TEXT;

-- Backfill: assign all existing accounts to the owner of their platform
UPDATE "Account" a
SET "user_id" = (SELECT p."user_id" FROM "Platform" p WHERE p."id" = a."platform_id");

-- Fallback for any orphaned accounts
UPDATE "Account" SET "user_id" = (SELECT "id" FROM "User" ORDER BY "id" LIMIT 1)
WHERE "user_id" IS NULL;

-- Enforce NOT NULL
ALTER TABLE "Account" ALTER COLUMN "user_id" SET NOT NULL;

-- Add foreign key constraint
ALTER TABLE "Account" ADD CONSTRAINT "Account_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add index
CREATE INDEX "Account_user_id_idx" ON "Account"("user_id");
