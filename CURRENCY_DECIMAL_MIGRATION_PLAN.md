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

Status: **Not started**

1. List every Prisma `Float` field and classify it as money, rate, count, measurement, or unrelated.
2. Trace each money/rate field through forms, API validation, routes, database writes, analytics, imports/exports, and reports.
3. Record the current database column types and representative production values without modifying data.
4. Define one rounding policy for allocations that produce fractions of a cent.

Exit criteria: a reviewed field map and rounding policy exist before any schema change.

### 2. Shared currency utilities

Status: **Not started**

1. Add a small server-side money utility based on Prisma `Decimal`.
2. Provide safe parsing for request values, addition, subtraction, multiplication, allocation, and final cent rounding.
3. Reject invalid, non-finite, and over-precision input with clear validation errors.
4. Add focused tests for common decimals, negative adjustments where permitted, tax/shipping/fees, and split quantities.

Exit criteria: all new financial calculations can call a single tested utility without changing database types yet.

### 3. Add additive database columns and backfill

Status: **Not started**

1. Add new nullable `Decimal` columns beside existing `Float` money/rate columns. Do not remove or overwrite existing columns in this task.
2. Backfill exact two-decimal monetary values from existing data using an explicit, reviewed conversion query.
3. Produce a comparison report for old versus new totals by user, inventory item, sale, expense, and reporting period.
4. Check for nulls, impossible values, and differences beyond the agreed rounding policy.

Exit criteria: backfill is complete in a staging copy and comparisons are accepted. Production migration remains reversible because original columns still exist.

### 4. Migrate one bounded write flow: inventory purchases

Status: **Not started**

1. Update inventory purchase validation and create/edit routes to write the new decimal fields.
2. Keep compatibility reads while older records/clients still use original fields.
3. Test create, edit, partial edit, invalid values, cancellation/retry, receipt attachment, and quantity allocations.
4. Compare transaction totals in the transaction screen, detail modal, cash flow, and analytics.

Exit criteria: purchase writes and displayed purchase costs use exact values, with regression tests passing.

### 5. Migrate one bounded write flow: sales

Status: **Not started**

1. Convert sales price, commission, tax, shipping, and profit calculations to the shared decimal utility.
2. Test single and multi-quantity sales, partial sales, edits, returns/cancellations, discounts, shipping, and platform fees.
3. Verify inventory quantities and sale profitability remain consistent if a request fails or retries.

Exit criteria: sales and realized-profit totals match expected cent-accurate values in API and UI tests.

### 6. Migrate expenses, recurring expenses, accounts, invoices, and goals

Status: **Not started**

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
| 1. Inventory and mapping audit | Not started | — | — | — |
| 2. Shared currency utilities | Not started | — | — | — |
| 3. Additive columns and backfill | Not started | — | — | — |
| 4. Inventory purchase flow | Not started | — | — | — |
| 5. Sales flow | Not started | — | — | — |
| 6. Supporting finance flows | Not started | — | — | — |
| 7. Reports, imports, exports, API | Not started | — | — | — |
| 8. Read cutover and cleanup | Not started | — | — | — |

## Deferred until this plan is scheduled

The application currently uses floating-point currency fields. Until this migration is started, focused safeguards can still be added to high-risk calculations: normalize user-entered values to two decimals before saving and round calculated display totals consistently. Those safeguards are not a replacement for this migration.
