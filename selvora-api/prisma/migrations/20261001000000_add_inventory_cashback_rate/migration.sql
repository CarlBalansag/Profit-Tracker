BEGIN;

-- A nullable rate distinguishes legacy purchases (which continue to use the
-- payment method's current default/category rate) from purchases whose
-- cashback rate and amount were explicitly snapshotted or overridden.
ALTER TABLE "Inventory" ADD COLUMN "cashback_rate" DOUBLE PRECISION;
ALTER TABLE "Inventory" ADD COLUMN "cashback_rate_decimal" NUMERIC(9,6);

CREATE OR REPLACE FUNCTION "sync_Inventory_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."unit_purchase_cost_decimal" := CASE WHEN NEW."unit_purchase_cost" IS NOT NULL THEN round(NEW."unit_purchase_cost"::text::numeric, 2) ELSE NULL END;
  NEW."sales_tax_decimal" := CASE WHEN NEW."sales_tax" IS NOT NULL THEN round(NEW."sales_tax"::text::numeric, 2) ELSE NULL END;
  NEW."shipping_cost_inbound_decimal" := CASE WHEN NEW."shipping_cost_inbound" IS NOT NULL THEN round(NEW."shipping_cost_inbound"::text::numeric, 2) ELSE NULL END;
  NEW."fees_decimal" := CASE WHEN NEW."fees" IS NOT NULL THEN round(NEW."fees"::text::numeric, 2) ELSE NULL END;
  NEW."cashback_earned_decimal" := CASE WHEN NEW."cashback_earned" IS NOT NULL THEN round(NEW."cashback_earned"::text::numeric, 2) ELSE NULL END;
  NEW."cashback_rate_decimal" := CASE WHEN NEW."cashback_rate" IS NOT NULL THEN round(NEW."cashback_rate"::text::numeric, 6) ELSE NULL END;
  NEW."gift_card_amount_decimal" := CASE WHEN NEW."gift_card_amount" IS NOT NULL THEN round(NEW."gift_card_amount"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;

COMMIT;
