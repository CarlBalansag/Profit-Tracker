-- Where an order ships (city and state only) and how a store order with no
-- matching purchase was sorted: resale, ask, personal, or kept by the user.
ALTER TABLE "EmailMessage" ADD COLUMN "ship_to" TEXT;
ALTER TABLE "EmailOrder" ADD COLUMN "ship_to" TEXT;
ALTER TABLE "EmailOrder" ADD COLUMN "leaning" TEXT;
ALTER TABLE "EmailOrder" ADD COLUMN "leaning_reason" TEXT;
