-- What the gift card amount on a purchase cost the user (a gift card bought at
-- a discount, or with an activation fee), so the Schedule C books can count it
-- in inventory cost. Additive and nullable: existing rows get NULL, which means
-- "not entered" (treated as free, with a note on the Schedule C page).
ALTER TABLE "Inventory" ADD COLUMN "gift_card_cost" DECIMAL(19,2);
