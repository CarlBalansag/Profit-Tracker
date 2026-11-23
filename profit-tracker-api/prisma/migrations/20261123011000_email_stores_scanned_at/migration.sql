-- When the user last ran "Find stores in my email".
ALTER TABLE "EmailAccount" ADD COLUMN "stores_scanned_at" TIMESTAMP(3);
