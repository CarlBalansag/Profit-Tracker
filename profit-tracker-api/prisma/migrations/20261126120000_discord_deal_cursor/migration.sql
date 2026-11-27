-- Where the Discord deal reader has read up to in each channel it follows
-- (LA and Points4Days deal posts, services/cashouts/discordDeals.js).
CREATE TABLE "DiscordDealCursor" (
    "channel_id" TEXT NOT NULL,
    "last_message_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordDealCursor_pkey" PRIMARY KEY ("channel_id")
);
