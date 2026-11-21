-- An external transaction id (bank, card or Copilot) on an expense, unique per
-- user so the same statement line can't be imported twice. Additive: existing
-- rows get NULL, and Postgres lets any number of rows share NULL.
ALTER TABLE "Expense" ADD COLUMN "external_id" TEXT;

CREATE UNIQUE INDEX "Expense_user_id_external_id_key" ON "Expense"("user_id", "external_id");
