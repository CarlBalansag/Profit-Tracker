# Currency Precision Migration Plan

## Goal

Replace floating-point storage and calculations for monetary amounts with PostgreSQL `NUMERIC` and Prisma `Decimal`. This prevents small rounding errors from accumulating in purchases, sales, fees, taxes, receipts, cash flow, analytics, and profit totals.

This is intentionally a sequence of small tasks. Complete and QA one task, update this file, then pause before starting the next task. Feature work can take priority between tasks.

## Working rules

- One numbered task per change set and pull/push cycle.
- Do not mix feature work with a migration task.
- Preserve historical values during every step and keep a rollback path until validation is complete.
- Use exact decimal math on the server. Round only when an amount must become a currency value with two decimal places.
- Document each completed task in the completion log, including the date, migration, validation, and any follow-up found during QA.

## Scope

### Monetary values

Convert monetary fields such as purchase cost, sale price, tax, inbound and sale shipping, fees, gift-card amounts, cashback, expense amounts, invoice totals, account credit limits, and cached marketplace prices.

### Rates and percentages

Use a separate decimal scale for rates, such as platform fees, cashback rates, and payment percentages. Rates need more than two fractional digits; proposed type: `NUMERIC(9,6)`.

### Values requiring a product decision

Goals may represent either currency or units. Before converting those fields, identify which goal types use money and which use counts so that unit targets do not gain inappropriate currency rules.

## Staged tasks

### 1. Inventory and mapping audit

Status: **Complete** — see `qa/CURRENCY_MIGRATION_AUDIT.md` for the full field map, consumption trace, representative production values, and proposed rounding policy.

1. List every Prisma `Float` field and classify it as money, rate, count, measurement, or unrelated.
2. Trace each money/rate field through forms, API validation, routes, database writes, analytics, imports/exports, and reports.
3. Record the current database column types and representative production values without modifying data.
4. Define one rounding policy for allocations that produce fractions of a cent.

Exit criteria: a reviewed field map and rounding policy exist before any schema change.

### 2. Shared currency utilities

Status: **Complete** — `selvora-api/services/money.js`, tested in `selvora-api/test/money.test.mjs`.

1. Add a small server-side money utility based on Prisma `Decimal`.
2. Provide safe parsing for request values, addition, subtraction, multiplication, allocation, and final cent rounding.
3. Reject invalid, non-finite, and over-precision input with clear validation errors.
4. Add focused tests for common decimals, negative adjustments where permitted, tax/shipping/fees, and split quantities.

Exit criteria: all new financial calculations can call a single tested utility without changing database types yet.

### 3. Add additive database columns and backfill

Status: **Complete** — `selvora-api/prisma/migrations/20260930000000_additive_currency_decimals/migration.sql`, adopting a design already proven correct in production (see below). Comparison report and Goal-recommendation update in `qa/CURRENCY_MIGRATION_AUDIT.md`.

1. Add new nullable `Decimal` columns beside existing `Float` money/rate columns. Do not remove or overwrite existing columns in this task.
2. Backfill exact two-decimal monetary values from existing data using an explicit, reviewed conversion query.
3. Produce a comparison report for old versus new totals by user, inventory item, sale, expense, and reporting period.
4. Check for nulls, impossible values, and differences beyond the agreed rounding policy.

Exit criteria: backfill is complete in a staging copy and comparisons are accepted. Production migration remains reversible because original columns still exist.

### 4. Migrate one bounded write flow: inventory purchases

Status: **Complete** — `selvora-api/validation/schemas.js` (`decimalAmount` helper), applied to `createInventory`/`updateInventory`'s 6 Inventory money fields.

1. Update inventory purchase validation and create/edit routes to write the new decimal fields.
2. Keep compatibility reads while older records/clients still use original fields.
3. Test create, edit, partial edit, invalid values, cancellation/retry, receipt attachment, and quantity allocations.
4. Compare transaction totals in the transaction screen, detail modal, cash flow, and analytics.

Exit criteria: purchase writes and displayed purchase costs use exact values, with regression tests passing.

### 5. Migrate one bounded write flow: sales

Status: **Complete** — `selvora-api/validation/schemas.js`, `decimalAmount` applied to all 4 Sales money fields in `createSale`/`updateSale`, plus the inline-sale-at-purchase fields on `createInventory` (`sale_price`, `commission_fee`, `sale_shipping`, `sale_tax_collected`) for the same POST /api/inventory sale-creation path.

1. Convert sales price, commission, tax, shipping, and profit calculations to the shared decimal utility.
2. Test single and multi-quantity sales, partial sales, edits, returns/cancellations, discounts, shipping, and platform fees.
3. Verify inventory quantities and sale profitability remain consistent if a request fails or retries.

Exit criteria: sales and realized-profit totals match expected cent-accurate values in API and UI tests.

### 6. Migrate expenses, recurring expenses, accounts, invoices, and goals

Status: **Complete** — `selvora-api/validation/schemas.js` + `selvora-api/routes/goals.js`.

1. Migrate expenses and recurring expenses first, including generated occurrences and cash-flow totals.
2. Migrate account credit limits and cashback values, using the rate scale for percentages.
3. Migrate invoice totals.
4. Apply the decision from Task 1 to monetary goals only; leave count-based goals as integer/count fields.

Exit criteria: all supporting finance flows use decimal fields and tests cover normal, empty, invalid, repeated, and failed-operation paths.

### 7. Migrate reports, imports, exports, and API serialization

Status: **Not started**

1. Update analytics, dashboards, cash flow, tax-exempt reporting, and receipt totals to use exact values.
2. Define the API contract for decimals: return normalized currency strings for money, normalized strings/rates for precision-sensitive fields, and format them in the client.
3. Update CSV/import/export behavior so no value is converted through floating-point arithmetic.
4. Test cross-page totals against known fixtures.

Exit criteria: every financial screen agrees with the same fixture totals and API responses have a documented decimal format.

### 8. Cut over reads and remove legacy columns

Status: **Not started**

1. After a full production verification window, make decimal fields required and read only those fields.
2. Run a final reconciliation report before deleting legacy columns.
3. Create a separate, reversible migration to remove Float columns only after the reconciliation is approved.
4. Update the data dictionary and this file with the final schema.

Exit criteria: no production code reads Float monetary fields, reconciliation passes, and legacy fields are safely removed.

## Required QA for every task

- Valid create and edit flows.
- Empty, invalid, and excessive-precision values.
- Partial updates that omit other monetary values.
- Multi-item and split-quantity calculations.
- Request failure, retry, and duplicate-submission behavior.
- Ownership and tenant boundaries for related records.
- Consistency between database records, transaction details, cash flow, analytics, reports, and exports.
- Relevant API tests, frontend tests, production build, Prisma validation, and migration checks.

## Completion log

| Task | Status | Completed | Validation | Notes |
| --- | --- | --- | --- | --- |
| 1. Inventory and mapping audit | Complete | 2026-09-30 | Read-only field/consumption audit + production value sampling | 21 Float fields: 15 money, 3 rate, 3 product-decision (Goal targets), 1 dormant (Invoice, no route exists). Zero existing precision drift found in stored values; risk is in calculation (shared/finance.mjs), not storage. See qa/CURRENCY_MIGRATION_AUDIT.md. |
| 2. Shared currency utilities | Complete | 2026-09-30 | 5 focused tests: decimal add/subtract/multiply, half-cent rounding, allocation across split quantities (incl. remainder distribution), rejection of malformed/negative/over-precision/excessive input, rate-scale (6dp) parsing | `services/money.js` exports Decimal, decimal, parseAmount(value, scale), moneyString, rateString, add, subtract, multiply, allocate. Not yet wired into any route or the schema — that starts in Task 3/4. |
| 3. Additive columns and backfill | Complete | 2026-09-30 | Fresh-database migration test (embedded-postgres), zero-drift check (`prisma migrate diff` against schema.prisma), read-only comparison report across every field in production | 21 nullable Decimal columns + 9 sync triggers across Inventory/Sales/Platform/PaymentMethod/Expense/RecurringExpense/Invoice/Goal/ebay_price_cache. This formally adopts a design that had already been applied to production out-of-band (see QA-26) — verified byte-identical to that prior implementation before reuse. Goal recommendation from Task 1 reversed (see audit addendum): target columns included after all, using the existing conditional (metric <> 'unitsSold') backfill design. One real float-precision artifact found and explained in Inventory.cashback_earned (a computed, not user-entered, field) — not a backfill defect. |
| 4. Inventory purchase flow | Complete | 2026-09-30 | 8 new tests (`test/inventoryDecimalValidation.test.mjs`) covering valid input, over-precision/malformed/negative rejection, partial-update isolation; full suite (183 tests) green | Wired Task 2's `parseAmount` into `createInventory`/`updateInventory` for the 5 direct-entry Inventory money fields (reject over-precision/malformed/negative input) and `cashback_earned` specifically with `round: true` instead of reject, since it's server/client-*computed* (cost × rate ÷ 100), not typed by a person -- this directly fixes the float-drift instance found in the Task 3 comparison report. Storage is still the Float columns (sync triggers keep `_decimal` mirrors current); no read path changed. |
| 5. Sales flow | Complete | 2026-09-30 | 7 new tests (`test/salesDecimalValidation.test.mjs`); full suite (190 tests) green | All 4 Sales money fields are direct user input (confirmed by tracing every frontend form that submits them) so all use strict `decimalAmount()`, unlike Task 4's `cashback_earned`. Also found and fixed a real gap: `createInventory`'s inline-sale fields `sale_shipping`/`sale_tax_collected` had no Zod validation at all (passed through unchecked via `.passthrough()`, relying solely on the route's `parseFloat() \|\| 0`) -- now validated like every other sale field. Scope note: the plan's "profit calculations" wording is deferred to Task 7 -- no backend route computes/stores a derived profit value for Sales (profit is purely a frontend display computation from these now-validated raw fields via the isomorphic `shared/finance.mjs`, which can't depend on services/money.js's Prisma.Decimal in the browser); Task 7 is where read-path/display precision is explicitly in scope. |
| 6. Supporting finance flows | Complete | 2026-09-30 | 12 new tests (`test/task6DecimalValidation.test.mjs` + 1 in `test/schemas.test.mjs`); full suite (202 tests) green | Expense.amount, RecurringExpense.amount: strict `decimalAmount()`. PaymentMethod.credit_limit: strict money; default_cashback_rate/min_payment_pct: strict rate (`scale: 6`). Platform.fee_pct: strict rate. Account model has no money fields (Task 6's "account credit limits" refers to PaymentMethod.credit_limit, already covered). Invoice.total_amount: left as-is -- still no route exists (Task 1/3 finding). Goal: cross-field validation moved to routes/goals.js (not pure Zod) since an update can omit `metric` and inherit the existing record's -- money-metric targets use strict decimalAmount(2dp), unitsSold targets must be integers. Also fixed a real bug in Task 4/5's shared decimalAmount() helper: `defaultValue` never applied when a key was entirely absent (only when present-but-empty), because Zod's `.optional()` short-circuits before a transform's own undefined-handling runs; every existing caller happened to be masked by a redundant route-level `parseFloat(x) \|\| 0`, so this was latent, not an observed regression. Fixed by using a real Zod `.default()` wrapper. |
| 7. Reports, imports, exports, API | Not started | — | — | — |
| 8. Read cutover and cleanup | Not started | — | — | — |

## Deferred until this plan is scheduled

The application currently uses floating-point currency fields. Until this migration is started, focused safeguards can still be added to high-risk calculations: normalize user-entered values to two decimals before saving and round calculated display totals consistently. Those safeguards are not a replacement for this migration.
