# Currency migration — Task 1 audit (field inventory and mapping)

Audit date: 2026-09-30
Scope: every Prisma `Float` field in `selvora-api/prisma/schema.prisma`, traced through validation, routes, shared calculation code, and frontend consumers. No schema or data was changed; all database queries in this audit were read-only.

## Field classification

21 `Float` fields exist, matching all three categories `CURRENCY_DECIMAL_MIGRATION_PLAN.md` calls out.

### Money fields (15) — convert to `NUMERIC(19,2)` / Prisma `Decimal`

| Model | Field | Validation today | Notes |
| --- | --- | --- | --- |
| Inventory | unit_purchase_cost | `money` (required) | |
| Inventory | sales_tax | `optionalMoney`, default 0 | |
| Inventory | shipping_cost_inbound | `optionalMoney`, default 0 | |
| Inventory | fees | `optionalMoney`, default 0 | |
| Inventory | cashback_earned | `optionalMoney` | Written by the app, not user-entered directly (see below) |
| Inventory | gift_card_amount | `optionalMoney`, default 0 | |
| Sales | unit_price | `money` (required) | |
| Sales | commission_fee | `optionalMoney`, default 0 | |
| Sales | sale_shipping | `optionalMoney`, default 0 | |
| Sales | sale_tax_collected | `optionalMoney`, default 0 | |
| PaymentMethod | credit_limit | `optionalMoney`, nullable | |
| Expense | amount | `money` (required) | |
| RecurringExpense | amount | `money` (required) | |
| Invoice | total_amount | **none** | No validation schema and no API route exists for Invoice at all (see Dormant model, below) |
| EbayPriceCache | last_sold_price | `optionalMoney`, nullable | External cached reference price from eBay's API, display-only |

### Rate fields (3) — convert to `NUMERIC(9,6)`, separate scale from money

| Model | Field | Validation today | Notes |
| --- | --- | --- | --- |
| Platform | fee_pct | `optionalMoney`, default 0 | Reuses the money validator; no rate-specific precision or upper-bound check exists today |
| PaymentMethod | default_cashback_rate | `optionalMoney`, default 0 | Same |
| PaymentMethod | min_payment_pct | `optionalMoney`, nullable | Same |

**Finding**: rate fields currently share the exact same Zod validator (`optionalMoney`) as true money fields. There is no dedicated rate validator, so the migration's Task 2 (shared utilities) needs to introduce one rather than reuse the money helper.

### Fields requiring a product decision (3)

| Model | Field | Notes |
| --- | --- | --- |
| Goal | target_7d | Money when `metric` is `netProfit`/`totalRevenue`; a plain count when `metric` is `unitsSold` |
| Goal | target_30d | Same |
| Goal | target_ytd | Same |

Sampled production data confirms the pattern: `unitsSold` goals store whole numbers (1, 10, 1000) while `netProfit`/`totalRevenue` goals store currency amounts (10, 100, 1000 / 500, 2000, 10000). **Proposed decision**: keep `Goal.target_*` as `Float` for now and apply currency formatting/rounding only in the read path when `metric !== 'unitsSold'`; do not add a Decimal column for this model in Task 3. Converting the column type would require a discriminated schema (or a second set of unit-count columns) that isn't justified by the current three-metric design. Revisit only if a money-only goal type is added later.

### Dormant field (excluded from active migration work)

**Invoice.total_amount** has no Zod schema and no Express route (`selvora-api/routes/` has no `invoices.js`, and no route file references the `Invoice` model at all). Production has 0 rows in this table (confirmed during the Render deploy diagnosis on 2026-09-29). Buyer/Invoice tenant ownership was added in Phase 2 of the branch-consolidation plan, but no create/update path exists yet. Recommendation: convert its column type for schema consistency whenever Task 3's additive-column migration runs (it's a zero-cost, zero-risk column add on an empty table), but do not build any dedicated read/write handling for it — there is nothing to migrate.

## Key consumption points

### The shared calculation core: `shared/finance.mjs`

This is the highest-leverage file in the whole migration. It does all batch-cost, allocation, cashback-rate, and profit math in raw floating point (`Number(x) * Number(y) ...`), with **no rounding at any intermediate step** — `allocatedCost` divides a batch's total cost across sold units (`batchCost(inventory) * quantity / purchased`), which routinely produces non-terminating fractions of a cent (e.g. a $10.00 cost split across 3 units). Nothing currently rounds that division; only the UI's `.toFixed(2)` calls truncate it for *display*, while any further math (e.g. summing per-unit costs across many sales in `realizedSummary`) continues to compound the unrounded value. This is the concrete mechanism behind the "small rounding errors... accumulate" problem the plan exists to fix.

Consumers (9 files, all of which will need updating together in Tasks 4–5 since they share this one module):
- Backend: `selvora-api/routes/analytics.js`, `selvora-api/routes/creditcard.js`, `selvora-api/routes/receipts.js`
- Frontend: `selvora-app/src/components/TransactionDetailModal.jsx`, `selvora-app/src/pages/Transactions.jsx`, `selvora-app/src/pages/Inventory.jsx`, `selvora-app/src/pages/AddTransaction.jsx`, `selvora-app/src/pages/AddSale.jsx`
- Test: `selvora-api/test/finance.test.mjs` (the only existing regression coverage for this math)

### Validation layer

All money fields funnel through two Zod primitives in `selvora-api/validation/schemas.js`: `money` (required) and `optionalMoney`. Both just do `z.coerce.number().finite().min(0)` — no precision cap, no rejection of e.g. `10.999`. Task 2's "reject invalid, non-finite, and over-precision input" is not implemented anywhere today.

### Routes writing money fields directly

`selvora-api/routes/inventory.js`, `selvora-api/routes/sales.js`, `selvora-api/routes/expenses.js`, `selvora-api/routes/recurringExpenses.js`, `selvora-api/routes/platforms.js`, `selvora-api/routes/paymentMethods.js`, `selvora-api/routes/goals.js` all pass validated values straight to Prisma with `parseFloat(...)` in a few spots (e.g. `platforms.js`'s `fee_pct: parseFloat(fee_pct) || 0`) — another float round-trip.

### Cashback and category rate storage

`PaymentMethod.category_rates` stores per-store rate overrides as a JSON string (not a Float column, so out of this audit's field list), each entry with its own `rate` number consumed by `effectiveCashbackRate` in `shared/finance.mjs`. Any rate-precision change to `default_cashback_rate` should apply the same precision rules to these JSON-embedded rates for consistency, even though they're not a schema column.

## Representative production values (read-only sample, no data modified)

- `Inventory.unit_purchase_cost`: 249.99 (repeated across several rows)
- `Sales.unit_price`: 18, 43, 64.2, 287 (mixed whole and fractional)
- `Sales.commission_fee` / `sale_shipping`: 13.33 / 10.04 (already at 2-decimal precision)
- `PaymentMethod.default_cashback_rate`: 1, 5 (whole-percent values; no fractional-percent rates in current data)
- `Expense.amount`: 7.98, 2.98, 6.94, 20, 50
- `Goal` targets: netProfit/totalRevenue store currency-scale numbers, unitsSold stores small integers, confirming the product-decision classification above.

A direct SQL check (`WHERE unit_purchase_cost != ROUND(unit_purchase_cost::numeric, 2)::float8`) found **zero** existing rows with stored precision beyond 2 decimals in either `Inventory.unit_purchase_cost` or `Sales.unit_price`. This means the current risk is entirely in *calculation* (allocation, aggregation) rather than *storage* — inputs are already clean; the migration's job is to stop float math from corrupting them during derived calculations.

## Proposed rounding policy (Task 1, exit criteria item 4)

1. **Money fields** round to 2 decimal places. **Rate fields** round to 6 decimal places, consistent with the plan's proposed `NUMERIC(9,6)`.
2. Store exact `Decimal` values for every direct user input (purchase cost, sale price, fees, etc.) — no rounding needed since these are already 2-decimal entries.
3. For **allocations that split a whole amount across units** (the `allocatedCost` case), use a largest-remainder method: compute each unit's exact share with `Decimal` division (no rounding), round every share down to the cent, then distribute the leftover cents (batch total minus the sum of rounded shares) one cent at a time to the units with the largest truncated remainder. This guarantees allocated per-unit costs always sum exactly to the batch total — unlike today's raw float division, which has no such guarantee and isn't rounded at all before being summed further downstream.
4. For **derived aggregates that are not an allocation** (dashboard totals, analytics sums, cash-flow totals), sum the underlying `Decimal` values first and round once at the end for display/API output — never round intermediate per-row values before summing them, to avoid compounding rounding error across many rows.

## Exit criteria check

- [x] Every Float field listed and classified (money / rate / product-decision / dormant).
- [x] Each money/rate field traced through validation, routes, the shared calculation module, and frontend consumers.
- [x] Current column types recorded (all `Float`) and representative production values sampled, read-only.
- [x] One rounding policy defined for allocation fractions and for aggregate rounding.

Task 1 is complete. No schema change, utility code, or migration file has been written yet — that starts with Task 2 (shared currency utilities), per the plan's "pause before starting the next task" rule.
