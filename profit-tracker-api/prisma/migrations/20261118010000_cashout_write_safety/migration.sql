-- Cashout writes through MCP need an explicit opt-in per API key.
ALTER TABLE "ApiKey" ADD COLUMN "allow_cashout_writes" BOOLEAN NOT NULL DEFAULT false;

-- A record of every write sent to a cashout provider and what came back.
CREATE TABLE "CashoutWriteLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT,
    "commitment_id" TEXT,
    "action" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashoutWriteLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashoutWriteLog_user_id_created_at_idx" ON "CashoutWriteLog"("user_id", "created_at");

ALTER TABLE "CashoutWriteLog" ADD CONSTRAINT "CashoutWriteLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
