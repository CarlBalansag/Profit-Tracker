-- Stores found in a user's email that aren't supported yet, and requests for them.
CREATE TABLE "EmailStoreCandidate" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order_emails" INTEGER NOT NULL DEFAULT 0,
    "last_seen" TIMESTAMP(3),
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_at" TIMESTAMP(3),

    CONSTRAINT "EmailStoreCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailStoreCandidate_user_id_domain_key" ON "EmailStoreCandidate"("user_id", "domain");
CREATE INDEX "EmailStoreCandidate_requested_at_idx" ON "EmailStoreCandidate"("requested_at");

ALTER TABLE "EmailStoreCandidate" ADD CONSTRAINT "EmailStoreCandidate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
