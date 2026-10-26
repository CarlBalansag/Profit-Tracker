-- Add credentials to existing user IDs; no business records or user identities move.
CREATE TABLE "LocalCredential" (
  "user_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  "temporary_expires_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "LocalCredential_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "LocalCredential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LocalCredential_email_normalized" CHECK ("email" = lower(trim("email")))
);
CREATE UNIQUE INDEX "LocalCredential_email_key" ON "LocalCredential"("email");
