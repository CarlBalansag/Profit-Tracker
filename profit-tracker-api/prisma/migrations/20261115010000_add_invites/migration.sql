-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "used_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_hash_key" ON "Invite"("token_hash");

-- CreateIndex
CREATE INDEX "Invite_token_hash_idx" ON "Invite"("token_hash");

-- CreateIndex
CREATE INDEX "Invite_expires_at_idx" ON "Invite"("expires_at");

-- CreateIndex
CREATE INDEX "Invite_created_by_idx" ON "Invite"("created_by");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
