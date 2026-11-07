-- Set automatically the first time one of this user's cashout keys passes the
-- provider's own check -- replaces the CASHOUT_BETA_USER_IDS allow-list.
ALTER TABLE "User" ADD COLUMN "cashout_access_granted" BOOLEAN NOT NULL DEFAULT false;
