-- "Not a store": rows the user hid from Stores in your email.
ALTER TABLE "EmailStoreCandidate" ADD COLUMN "hidden_at" TIMESTAMP(3);
