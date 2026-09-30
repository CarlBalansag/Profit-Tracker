BEGIN;
-- Additive currency storage. Original Float columns remain available for rollback.
ALTER TABLE "Inventory" ADD COLUMN "unit_purchase_cost_decimal" NUMERIC(19,2);
ALTER TABLE "Inventory" ADD COLUMN "sales_tax_decimal" NUMERIC(19,2);
ALTER TABLE "Inventory" ADD COLUMN "shipping_cost_inbound_decimal" NUMERIC(19,2);
ALTER TABLE "Inventory" ADD COLUMN "fees_decimal" NUMERIC(19,2);
ALTER TABLE "Inventory" ADD COLUMN "cashback_earned_decimal" NUMERIC(19,2);
ALTER TABLE "Inventory" ADD COLUMN "gift_card_amount_decimal" NUMERIC(19,2);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Inventory" WHERE "unit_purchase_cost"::text IN ('NaN','Infinity','-Infinity') OR "sales_tax"::text IN ('NaN','Infinity','-Infinity') OR "shipping_cost_inbound"::text IN ('NaN','Infinity','-Infinity') OR "fees"::text IN ('NaN','Infinity','-Infinity') OR "cashback_earned"::text IN ('NaN','Infinity','-Infinity') OR "gift_card_amount"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in Inventory; reconcile before migration'; END IF; END $$;
UPDATE "Inventory" SET "unit_purchase_cost_decimal" = CASE WHEN "unit_purchase_cost" IS NOT NULL THEN round("unit_purchase_cost"::text::numeric, 2) ELSE NULL END, "sales_tax_decimal" = CASE WHEN "sales_tax" IS NOT NULL THEN round("sales_tax"::text::numeric, 2) ELSE NULL END, "shipping_cost_inbound_decimal" = CASE WHEN "shipping_cost_inbound" IS NOT NULL THEN round("shipping_cost_inbound"::text::numeric, 2) ELSE NULL END, "fees_decimal" = CASE WHEN "fees" IS NOT NULL THEN round("fees"::text::numeric, 2) ELSE NULL END, "cashback_earned_decimal" = CASE WHEN "cashback_earned" IS NOT NULL THEN round("cashback_earned"::text::numeric, 2) ELSE NULL END, "gift_card_amount_decimal" = CASE WHEN "gift_card_amount" IS NOT NULL THEN round("gift_card_amount"::text::numeric, 2) ELSE NULL END;
CREATE FUNCTION "sync_Inventory_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."unit_purchase_cost_decimal" := CASE WHEN NEW."unit_purchase_cost" IS NOT NULL THEN round(NEW."unit_purchase_cost"::text::numeric, 2) ELSE NULL END;
  NEW."sales_tax_decimal" := CASE WHEN NEW."sales_tax" IS NOT NULL THEN round(NEW."sales_tax"::text::numeric, 2) ELSE NULL END;
  NEW."shipping_cost_inbound_decimal" := CASE WHEN NEW."shipping_cost_inbound" IS NOT NULL THEN round(NEW."shipping_cost_inbound"::text::numeric, 2) ELSE NULL END;
  NEW."fees_decimal" := CASE WHEN NEW."fees" IS NOT NULL THEN round(NEW."fees"::text::numeric, 2) ELSE NULL END;
  NEW."cashback_earned_decimal" := CASE WHEN NEW."cashback_earned" IS NOT NULL THEN round(NEW."cashback_earned"::text::numeric, 2) ELSE NULL END;
  NEW."gift_card_amount_decimal" := CASE WHEN NEW."gift_card_amount" IS NOT NULL THEN round(NEW."gift_card_amount"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_Inventory_currency" BEFORE INSERT OR UPDATE ON "Inventory" FOR EACH ROW EXECUTE FUNCTION "sync_Inventory_currency"();
ALTER TABLE "Sales" ADD COLUMN "unit_price_decimal" NUMERIC(19,2);
ALTER TABLE "Sales" ADD COLUMN "commission_fee_decimal" NUMERIC(19,2);
ALTER TABLE "Sales" ADD COLUMN "sale_shipping_decimal" NUMERIC(19,2);
ALTER TABLE "Sales" ADD COLUMN "sale_tax_collected_decimal" NUMERIC(19,2);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Sales" WHERE "unit_price"::text IN ('NaN','Infinity','-Infinity') OR "commission_fee"::text IN ('NaN','Infinity','-Infinity') OR "sale_shipping"::text IN ('NaN','Infinity','-Infinity') OR "sale_tax_collected"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in Sales; reconcile before migration'; END IF; END $$;
UPDATE "Sales" SET "unit_price_decimal" = CASE WHEN "unit_price" IS NOT NULL THEN round("unit_price"::text::numeric, 2) ELSE NULL END, "commission_fee_decimal" = CASE WHEN "commission_fee" IS NOT NULL THEN round("commission_fee"::text::numeric, 2) ELSE NULL END, "sale_shipping_decimal" = CASE WHEN "sale_shipping" IS NOT NULL THEN round("sale_shipping"::text::numeric, 2) ELSE NULL END, "sale_tax_collected_decimal" = CASE WHEN "sale_tax_collected" IS NOT NULL THEN round("sale_tax_collected"::text::numeric, 2) ELSE NULL END;
CREATE FUNCTION "sync_Sales_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."unit_price_decimal" := CASE WHEN NEW."unit_price" IS NOT NULL THEN round(NEW."unit_price"::text::numeric, 2) ELSE NULL END;
  NEW."commission_fee_decimal" := CASE WHEN NEW."commission_fee" IS NOT NULL THEN round(NEW."commission_fee"::text::numeric, 2) ELSE NULL END;
  NEW."sale_shipping_decimal" := CASE WHEN NEW."sale_shipping" IS NOT NULL THEN round(NEW."sale_shipping"::text::numeric, 2) ELSE NULL END;
  NEW."sale_tax_collected_decimal" := CASE WHEN NEW."sale_tax_collected" IS NOT NULL THEN round(NEW."sale_tax_collected"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_Sales_currency" BEFORE INSERT OR UPDATE ON "Sales" FOR EACH ROW EXECUTE FUNCTION "sync_Sales_currency"();
ALTER TABLE "Platform" ADD COLUMN "fee_pct_decimal" NUMERIC(9,6);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Platform" WHERE "fee_pct"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in Platform; reconcile before migration'; END IF; END $$;
UPDATE "Platform" SET "fee_pct_decimal" = CASE WHEN "fee_pct" IS NOT NULL THEN round("fee_pct"::text::numeric, 6) ELSE NULL END;
CREATE FUNCTION "sync_Platform_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."fee_pct_decimal" := CASE WHEN NEW."fee_pct" IS NOT NULL THEN round(NEW."fee_pct"::text::numeric, 6) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_Platform_currency" BEFORE INSERT OR UPDATE ON "Platform" FOR EACH ROW EXECUTE FUNCTION "sync_Platform_currency"();
ALTER TABLE "PaymentMethod" ADD COLUMN "credit_limit_decimal" NUMERIC(19,2);
ALTER TABLE "PaymentMethod" ADD COLUMN "default_cashback_rate_decimal" NUMERIC(9,6);
ALTER TABLE "PaymentMethod" ADD COLUMN "min_payment_pct_decimal" NUMERIC(9,6);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "PaymentMethod" WHERE "credit_limit"::text IN ('NaN','Infinity','-Infinity') OR "default_cashback_rate"::text IN ('NaN','Infinity','-Infinity') OR "min_payment_pct"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in PaymentMethod; reconcile before migration'; END IF; END $$;
UPDATE "PaymentMethod" SET "credit_limit_decimal" = CASE WHEN "credit_limit" IS NOT NULL THEN round("credit_limit"::text::numeric, 2) ELSE NULL END, "default_cashback_rate_decimal" = CASE WHEN "default_cashback_rate" IS NOT NULL THEN round("default_cashback_rate"::text::numeric, 6) ELSE NULL END, "min_payment_pct_decimal" = CASE WHEN "min_payment_pct" IS NOT NULL THEN round("min_payment_pct"::text::numeric, 6) ELSE NULL END;
CREATE FUNCTION "sync_PaymentMethod_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."credit_limit_decimal" := CASE WHEN NEW."credit_limit" IS NOT NULL THEN round(NEW."credit_limit"::text::numeric, 2) ELSE NULL END;
  NEW."default_cashback_rate_decimal" := CASE WHEN NEW."default_cashback_rate" IS NOT NULL THEN round(NEW."default_cashback_rate"::text::numeric, 6) ELSE NULL END;
  NEW."min_payment_pct_decimal" := CASE WHEN NEW."min_payment_pct" IS NOT NULL THEN round(NEW."min_payment_pct"::text::numeric, 6) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_PaymentMethod_currency" BEFORE INSERT OR UPDATE ON "PaymentMethod" FOR EACH ROW EXECUTE FUNCTION "sync_PaymentMethod_currency"();
ALTER TABLE "Expense" ADD COLUMN "amount_decimal" NUMERIC(19,2);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Expense" WHERE "amount"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in Expense; reconcile before migration'; END IF; END $$;
UPDATE "Expense" SET "amount_decimal" = CASE WHEN "amount" IS NOT NULL THEN round("amount"::text::numeric, 2) ELSE NULL END;
CREATE FUNCTION "sync_Expense_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."amount_decimal" := CASE WHEN NEW."amount" IS NOT NULL THEN round(NEW."amount"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_Expense_currency" BEFORE INSERT OR UPDATE ON "Expense" FOR EACH ROW EXECUTE FUNCTION "sync_Expense_currency"();
ALTER TABLE "RecurringExpense" ADD COLUMN "amount_decimal" NUMERIC(19,2);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "RecurringExpense" WHERE "amount"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in RecurringExpense; reconcile before migration'; END IF; END $$;
UPDATE "RecurringExpense" SET "amount_decimal" = CASE WHEN "amount" IS NOT NULL THEN round("amount"::text::numeric, 2) ELSE NULL END;
CREATE FUNCTION "sync_RecurringExpense_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."amount_decimal" := CASE WHEN NEW."amount" IS NOT NULL THEN round(NEW."amount"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_RecurringExpense_currency" BEFORE INSERT OR UPDATE ON "RecurringExpense" FOR EACH ROW EXECUTE FUNCTION "sync_RecurringExpense_currency"();
ALTER TABLE "Invoice" ADD COLUMN "total_amount_decimal" NUMERIC(19,2);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Invoice" WHERE "total_amount"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in Invoice; reconcile before migration'; END IF; END $$;
UPDATE "Invoice" SET "total_amount_decimal" = CASE WHEN "total_amount" IS NOT NULL THEN round("total_amount"::text::numeric, 2) ELSE NULL END;
CREATE FUNCTION "sync_Invoice_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."total_amount_decimal" := CASE WHEN NEW."total_amount" IS NOT NULL THEN round(NEW."total_amount"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_Invoice_currency" BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION "sync_Invoice_currency"();
ALTER TABLE "Goal" ADD COLUMN "target_7d_decimal" NUMERIC(19,2);
ALTER TABLE "Goal" ADD COLUMN "target_30d_decimal" NUMERIC(19,2);
ALTER TABLE "Goal" ADD COLUMN "target_ytd_decimal" NUMERIC(19,2);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Goal" WHERE "target_7d"::text IN ('NaN','Infinity','-Infinity') OR "target_30d"::text IN ('NaN','Infinity','-Infinity') OR "target_ytd"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in Goal; reconcile before migration'; END IF; END $$;
UPDATE "Goal" SET "target_7d_decimal" = CASE WHEN "metric" <> 'unitsSold' AND "target_7d" IS NOT NULL THEN round("target_7d"::text::numeric, 2) ELSE NULL END, "target_30d_decimal" = CASE WHEN "metric" <> 'unitsSold' AND "target_30d" IS NOT NULL THEN round("target_30d"::text::numeric, 2) ELSE NULL END, "target_ytd_decimal" = CASE WHEN "metric" <> 'unitsSold' AND "target_ytd" IS NOT NULL THEN round("target_ytd"::text::numeric, 2) ELSE NULL END;
CREATE FUNCTION "sync_Goal_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."target_7d_decimal" := CASE WHEN NEW."metric" <> 'unitsSold' AND NEW."target_7d" IS NOT NULL THEN round(NEW."target_7d"::text::numeric, 2) ELSE NULL END;
  NEW."target_30d_decimal" := CASE WHEN NEW."metric" <> 'unitsSold' AND NEW."target_30d" IS NOT NULL THEN round(NEW."target_30d"::text::numeric, 2) ELSE NULL END;
  NEW."target_ytd_decimal" := CASE WHEN NEW."metric" <> 'unitsSold' AND NEW."target_ytd" IS NOT NULL THEN round(NEW."target_ytd"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_Goal_currency" BEFORE INSERT OR UPDATE ON "Goal" FOR EACH ROW EXECUTE FUNCTION "sync_Goal_currency"();
ALTER TABLE "ebay_price_cache" ADD COLUMN "last_sold_price_decimal" NUMERIC(19,2);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "ebay_price_cache" WHERE "last_sold_price"::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Non-finite historic currency in ebay_price_cache; reconcile before migration'; END IF; END $$;
UPDATE "ebay_price_cache" SET "last_sold_price_decimal" = CASE WHEN "last_sold_price" IS NOT NULL THEN round("last_sold_price"::text::numeric, 2) ELSE NULL END;
CREATE FUNCTION "sync_ebay_price_cache_currency"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."last_sold_price_decimal" := CASE WHEN NEW."last_sold_price" IS NOT NULL THEN round(NEW."last_sold_price"::text::numeric, 2) ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER "sync_ebay_price_cache_currency" BEFORE INSERT OR UPDATE ON "ebay_price_cache" FOR EACH ROW EXECUTE FUNCTION "sync_ebay_price_cache_currency"();
COMMIT;
