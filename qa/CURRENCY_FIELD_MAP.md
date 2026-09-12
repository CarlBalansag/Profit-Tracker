# QA-15 field audit and rounding policy

September 12, 2026. Read-only information_schema inspection confirmed all 21 listed columns currently use PostgreSQL double precision. No hosted data changed.

| Model | Money: NUMERIC(19,2) | Rates: NUMERIC(9,6) | Entry/read paths |
|---|---|---|---|
| Inventory | unit_purchase_cost, sales_tax, shipping_cost_inbound, fees, cashback_earned, gift_card_amount | — | Add Transaction, ledger/detail editing; inventory routes; analytics/card/receipt/export calculations |
| Sales | unit_price, commission_fee, sale_shipping, sale_tax_collected | — | Add Sale, immediate sale, ledger/detail; sales/inventory routes; analytics/card/receipt/exports |
| Platform | — | fee_pct | Vendor/Marketplace/Cashout settings; platforms routes; new-sale commission preview |
| PaymentMethod | credit_limit | default_cashback_rate, min_payment_pct | Payment Methods settings; paymentMethods routes; credit-card/finance helpers |
| Expense | amount | — | Expenses forms/receipt upload; expenses routes; analytics/Cash Flow/exports |
| RecurringExpense | amount | — | Expenses recurrence form; recurringExpenses routes; generated Expense amounts/exports |
| Invoice | total_amount | — | Unfinished, disabled UI; no invoice writer route |
| Goal | target_7d, target_30d, target_ytd for netProfit/totalRevenue | — | Goals settings; goals routes; Dashboard/Goals progress |
| ebay_price_cache | last_sold_price | — | Market-price cache entry; ebayPrice routes; ledger market-price display |

Goal unitsSold targets are counts, not money; validate whole nonnegative units separately. Account has no credit-limit/cashback Float fields; those belong to PaymentMethod. Inventory quantities, Buyer payout days and card statement days are Int. category_rates is JSON text containing rates: apply the six-digit rate input policy to every JSON entry; no independent database Float columns exist there. No import workflow exists. JSON/CSV/ZIP exports were connected in QA-20.

Policy: parse decimal strings without floating-point intermediate arithmetic, reject non-finite/negative/over-precision user amounts and use six decimal digits for rates. Monetary rounding uses half away from zero to match PostgreSQL round(numeric, 2). Keep calculation precision until a final money boundary. Unit allocations distribute cents by cumulative quantity boundaries, so a fully allocated batch equals its original cost; deterministic sale order and remaining inventory receive the residual cents. Example: $10 / 3 units = $3.33, $3.34, $3.33 using successive cumulative rounded boundaries. Never round a unit price before multiplying an integer quantity. Historic backfill rounds each stored field to cents, retains Float columns and reports aggregate differences.

Migration stages remain separate changes. Hosted migration/backfill and legacy column deletion require a staging reconciliation and production verification window; this task is authorized for local code/isolated QA, with no hosting or live schema changes. Retain legacy columns until that window is complete.
