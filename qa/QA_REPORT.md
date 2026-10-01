# Selvora full-site QA audit

Audit date: 2026-09-10
Scope: all 16 routed pages, frontend workflows, Express routes, validation, Prisma schema/migrations, calculations, tenant isolation, and responsive behavior.

## Executive result

The current build is deployable, and the live PostgreSQL schema is valid and up to date, but transaction editing is not safe. Several ordinary updates can overwrite fields the user did not edit. Sales and inventory writes are also split across multiple database operations without transactions, allowing partial records and overselling. Financial results differ across Transactions, Dashboard, Credit Card, and the expanded editor.

No product code or live records were changed during this audit. Browser mutation tests ran against an in-memory fixture server that loads the real Express routers. The only live database operation was the read-only `prisma migrate status` check.

**Status update, 2026-09-30**: a 7-phase branch-consolidation effort plus an 8-task currency Float→Decimal migration have since addressed 23 of this report's 24 original QA-01–24 findings (confirmed against current source, see each finding's "Update" note below); QA-20 is partially fixed. QA-25 (weak quality gates) and QA-27 (test env flakiness) remain open as documented. The executive summary above describes the app's state as of 2026-09-10 and should be read alongside the per-finding updates, not as the current state.

## Critical findings

### QA-01 — Partial updates inject create defaults and erase stored values

**Reproduced.** `updateInventory` and `updateSale` are made by calling `.partial()` on schemas whose fields already have defaults. Zod still injects those defaults into a partial update.

- `PUT /api/inventory/:id` with only `{ tracking_number: "QA" }` became an update containing purchase cost `0`, purchased quantity `1`, tax `0`, inbound shipping `0`, fees `0`, and gift card `0`.
- `PUT /api/sales/:id` with only `{ status: "PAID" }` became an update containing quantity `1`, commission `0`, outbound shipping `0`, and collected tax `0`.

This is the direct cause of the reported “Edit Row turns values to zero” behavior. See `selvora-api/validation/schemas.js:61-66`, `:82`, `:91-99`, and `:104`.

**Update 2026-09-30**: fixed during branch consolidation. `updateInventory`/`updateSale` in `selvora-api/validation/schemas.js` are now standalone schemas with only `optional()` fields, not `.partial()` of a defaulted create schema -- an untouched field is simply absent from the parsed body instead of being injected as its create-time default.

### QA-02 — Inline editor cannot preserve vendor, marketplace, or payment method

**Reproduced in the UI.** The inventory list response returns nested `vendor`, `payment_method`, and `platform` objects but omits the raw `vendor_id`, `payment_method_id`, and sale `platform_id` fields. Transactions builds its row IDs from those missing properties.

Consequences:

- Inline Edit Row opens Store, Place Sold, and Payment as blank.
- Saving an unchanged sale cleared Store and Payment and changed total cost/profit.
- Vendor and platform filter option lists are empty; selecting a payment method filters out every row.

See `selvora-api/routes/inventory.js:24-40`, `selvora-app/src/pages/Transactions.jsx:295-304`, `:623-629`.

**Update 2026-09-30**: fixed during branch consolidation. `GET /api/inventory` now explicitly selects `vendor_id`, `payment_method_id`, and nested `sales.platform_id`, and `Transactions.jsx` builds its edit state and filter option lists directly from those fields.

### QA-03 — Expanded/maximize editor also corrupts an unchanged transaction

**Reproduced in the UI.** With a fixture purchase of $500 + $40 tax + $20 inbound shipping + $10 fee − $50 gift card, clicking maximize and saving without changes:

- changed displayed total cost from **$520 to $560**;
- changed remaining inventory status from `PURCHASED` to `SOLD`;
- removed the fee and gift-card effect;
- changed displayed transaction profit;
- closed as though successful even though the sale update returned HTTP 400.

The modal initializes inventory status from the selected sale row, omits fees and gift card, sends a null payout date the API rejects, and never checks individual sale response statuses. See `selvora-app/src/components/TransactionDetailModal.jsx:115`, `:168-173`, `:181-225`.

**Update 2026-09-30**: fixed during branch consolidation. `TransactionDetailModal.jsx` now saves through the atomic `PUT /api/inventory/:id/transaction` route (`services/transactionEdit.js`), includes fees/gift-card/payout-date fields, checks each response via `requireSuccessfulResponse`, and computes totals through the shared `shared/finance.mjs` helpers instead of ad hoc math.

### QA-04 — Sale/inventory mutations are non-atomic and can leave impossible data

**Reproduced with injected failures and concurrent requests.**

- Sale creation writes the sale first and decrements inventory second. When the inventory update fails, the API returns 500 but the sale remains.
- Sale editing updates the sale quantity before checking whether sufficient inventory exists. A request changing quantity from 2 to 99 returned 400, but quantity 99 was already stored.
- Two concurrent sales both read one unit on hand and both succeeded. Two sale records were created for one available unit.

See `selvora-api/routes/sales.js:53-87` and `:103-140`. These writes need one database transaction with a conditional/locked stock update.

**Update 2026-09-30**: fixed during branch consolidation. `routes/sales.js` and `routes/inventory.js` now wrap stock decrement and sale create/update/delete in `prisma.$transaction`, using conditional `updateMany` claims (`qty_on_hand: { gte: saleQty }`, version-matched `where` clauses) as an optimistic-concurrency lock, so a failed or concurrent write can no longer leave a partial record or oversell.

### QA-05 — Cross-user foreign IDs are accepted

**Reproduced.** Ownership is checked on the main record but not on related IDs.

- A user can attach another user’s platform as an inventory vendor.
- A user can record a sale against another user’s platform.
- A user can create an account under another user’s platform.
- `/api/platforms/batch` will return an existing foreign platform when its UUID is supplied.

This breaks tenant isolation and can expose platform metadata. See `selvora-api/routes/inventory.js:94-103`, `sales.js:53-75`, `accounts.js:15-31`, and `platforms.js:49-68`.

**Update 2026-09-30**: fixed during branch consolidation. `requireOwned()` (`services/ownership.js`) is now called for vendor/payment-method/platform IDs in `inventory.js` and `sales.js`, for `platform_id` in `accounts.js`, and per-vendor in `platforms.js`'s `/batch` route.

## High-severity findings

### QA-06 — The same fixture has four different profit/cost answers

**Reproduced.** Before any edit, the same partial sale displayed:

| Surface | Cost/profit behavior |
|---|---|
| Dashboard/API analytics | Total purchase cost $520; sale net profit $81.16 |
| Transactions | Total cost $570; sale profit $61.56 |
| Expanded sale card | Allocated cost $224; sale profit $53.48 |
| Expanded summary | Charges the whole five-unit purchase against a two-unit sale; net profit −$275.80 |

Transactions ignores gift cards and outbound sale shipping. The expanded editor ignores fees and gift cards. Its summary applies full-batch cost and cashback to partial sales. Analytics applies fees/gift cards but ignores outbound sale shipping. Relevant code: `Transactions.jsx:476-527`, `TransactionDetailModal.jsx:168-173`, `:406-410`, `:614-640`, `analytics.js:100-110`.

**Update 2026-09-30**: fixed during branch consolidation. Cost/cashback/profit formulas are now consolidated in one shared module (`shared/finance.mjs`, with a Decimal-exact backend mirror in `services/decimalFinance.js` added by the currency migration) and consumed consistently by `Transactions.jsx`, `TransactionDetailModal.jsx`, and `routes/analytics.js` -- there is no longer a second, independently-written formula per surface.

### QA-07 — Analytics and Credit Card ignore outbound shipping and count cancelled sales

**Reproduced.** Increasing sale shipping by $100 did not change Dashboard stats or Credit Card loss/netting results. Changing the sale status to `CANCELLED` still counted its revenue, profit, and two units sold.

The analytics query includes every sale status and defines revenue as price minus commission only. Credit Card uses the same omission. See `selvora-api/routes/analytics.js:99-110`, `:131-155`; `creditcard.js:123-135`.

**Update 2026-09-30**: fixed during branch consolidation. Both routes now filter sales through the shared `isRealizedSale` helper (excludes CANCELLED/RETURNED/DISPUTED) and compute revenue via `saleEconomics`, which subtracts `sale_shipping`.

### QA-08 — Cash Flow totals and buyer/owed detail use different data sets

**Code-confirmed.** The analytics API returns only the latest 10 records as `recentTransactions`. Cash Flow uses all-time aggregate stats for its cards but uses those 10 records for “Unpaid” and all buyer breakdowns. Accounts with more than 10 sales get incomplete owed totals and missing buyers while the headline total still includes all sales. See `selvora-api/routes/analytics.js:357` and `selvora-app/src/pages/CashFlow.jsx:21-62`.

**Update 2026-09-30**: fixed during branch consolidation. `analytics.js` now returns a full `cashFlowTransactions` array alongside the 10-item `recentTransactions` slice, and `CashFlow.jsx` builds its buyer/owed breakdowns from the full array instead of the 10-record one.

### QA-09 — Immediate sale can oversell, partially save, and ignore selected purchase status

**Reproduced.** Creating one purchased unit with `qty_sold: 4` succeeded, created a four-unit sale, and clamped stock to zero. When sale creation failed, the inventory purchase remained even though the API returned 500. A new purchase submitted with `Pre Order` was stored as `PURCHASED`.

See `selvora-api/routes/inventory.js:94-142`. Add Transaction’s sold quantity input also has no maximum tied to purchased quantity (`selvora-app/src/pages/AddTransaction.jsx:868-880`).

**Update 2026-09-30**: fixed during branch consolidation. The inventory create route wraps the immediate sale and stock decrement in one `$transaction` with a pre-check that rejects an over-quantity sale before writing anything, preserves an explicitly submitted purchase status instead of forcing `PURCHASED`, and `AddTransaction.jsx`'s sold-quantity input is now capped to `qty_purchased`.

### QA-10 — Editing purchased quantity does not reconcile stock or sales

**Reproduced.** A five-unit purchase with two units sold and three on hand accepted an update to `qty_purchased: 1`, leaving `qty_on_hand: 3` plus two sold units. There is no invariant enforcing `qty_purchased = qty_on_hand + valid sold quantity`. See `selvora-api/routes/inventory.js:238-260`.

**Update 2026-09-30**: fixed during branch consolidation. `PUT /api/inventory/:id` now rejects a `qty_purchased` below the already-sold quantity and recomputes `qty_on_hand = requestedQty - soldQty` inside the same optimistic-concurrency transaction, enforcing the invariant directly (see `test/inventoryQuantityInvariant.test.mjs`).

### QA-11 — Receipt upload limit is effectively about 75 KiB, not 5 MiB

**Reproduced.** A ~150 KiB base64 request was rejected by Express with HTTP 413 before the route’s 5 MiB validation ran, because `express.json()` uses its default 100 KiB body limit. See `selvora-api/index.js:55` and `routes/receipts.js:80-107`.

The route also uploads to Cloudinary before checking record ownership. A foreign/nonexistent item returned 404 after an upload had already occurred (`receipts.js:113-136`), creating orphaned files and allowing unauthorized IDs to consume storage/API quota.

**Update 2026-09-30**: fixed during branch consolidation. `index.js` raises the body limit (`express.json({ limit: '7mb' })`), and `routes/receipts.js` now checks item ownership before calling Cloudinary (see `test/receiptSafety.test.mjs`).

### QA-12 — Recurring expenses skip month-end dates and can duplicate entries

**Reproduced.** Monthly recurrence starting January 31 generated January 31, March 3, and April 3, skipping February. JavaScript `setMonth()` overflow is being used as the recurrence rule (`selvora-api/routes/recurringExpenses.js:34-43`).

Two concurrent GET requests can both see the same `last_generated`, both insert the same occurrence, and then both update the marker. There is no unique constraint on `(recurring_expense_id, date)` and generation is triggered by a read endpoint (`:49-74`, `:77-92`).

**Update 2026-09-30**: fixed during branch consolidation. `getOccurrences()` now clamps month-end rollover to the real last day of the target month, `Expense` has `@@unique([recurring_expense_id, date])`, and generation uses `skipDuplicates: true` inside a transaction, so concurrent generation can no longer produce duplicate occurrences.

### QA-13 — Tax Exempt reporting excludes valid exempt sales and uses the wrong denominator

**Code-confirmed.** The Sales tab is built only from sales belonging to tax-exempt purchases. A customer-exempt/non-taxable sale of ordinarily taxed inventory is omitted. The percentage numerator is period-filtered while its denominator is all sales across all periods. See `selvora-app/src/pages/TaxExempt.jsx:70-78`, `:115-138`.

**Update 2026-09-30**: fixed during branch consolidation. `TaxExempt.jsx` now builds its sale set from `inventory.tax_exempt || !taxable || customer_tax_exempt` (not just tax-exempt-purchase inventory), and the percentage's numerator and denominator both use the same period-filtered set.

### QA-14 — Platform tax settings can erase fields or be ignored

**Reproduced at the API.** A partial platform update containing only `tax_exempt_place` reset fee percentage to zero and cleared address/notes. Creating a platform with `tax_exempt_place: true` ignored the flag. See `selvora-api/routes/platforms.js:30-41`, `:75-101` and the defaulted platform validation at `validation/schemas.js:137`.

**Update 2026-09-30**: fixed during branch consolidation. `routes/platforms.js` create/update now explicitly preserve `fee_pct`/`address`/`notes` via `!== undefined` fallbacks instead of defaulting them away, and `tax_exempt_place` is applied correctly on both create and update.

### QA-15 — Currency is stored and calculated as binary floating point

**Schema-confirmed.** Costs, prices, taxes, fees, cashback, expenses, and invoice totals all use Prisma `Float`/PostgreSQL double precision. Financial arithmetic can accumulate fractions of a cent and inconsistent rounding. These should use fixed-scale `Decimal` or integer cents. See `selvora-api/prisma/schema.prisma:45-53`, `:76-84`, `:139-145`, `:154`, `:171`, `:188`.

**Update 2026-09-30**: fixed by the 8-task currency migration (`CURRENCY_DECIMAL_MIGRATION_PLAN.md`). Every money/rate field now has a paired `Decimal` column kept in sync by database triggers, all write paths validate/round through `services/money.js`, server-side aggregation uses `services/decimalFinance.js`, and every API response substitutes the exact Decimal value (`services/decimalRead.js`). See `qa/CURRENCY_MIGRATION_AUDIT.md` for the full audit and a zero-drift production reconciliation.

## Medium-severity findings

### QA-16 — Add Transaction receipt selection is discarded

**Code-confirmed.** Files can be selected, previewed, and removed, but `handleSubmit` never reads or uploads `attachedFiles`. The transaction succeeds without the advertised attachment. See `selvora-app/src/pages/AddTransaction.jsx:88`, `:173-177`, `:184-211`, `:635-665`.

**Update 2026-09-30**: fixed during branch consolidation. `handleSubmit` now reads the attached file and uploads it via `attachInventoryReceipt` (`POST /api/receipts/attach`) after the transaction is created.

### QA-17 — Calendar validation and subscription URL are unreliable

**Reproduced.** The API accepted date `2026-02-31`, an end date before the start date, and an unsupported color. The Zod calendar schema exists but the create/update routes do not use it (`selvora-api/routes/calendarEvents.js:379-425`).

Calendar subscription constructs its public feed from `BACKEND_URL`, otherwise `http://localhost:3000`. `BACKEND_URL` is absent from the checked local environment, `.env.example`, and README, so the generated link is locally unusable and production depends on an undocumented variable (`calendarEvents.js:205-208`).

**Update 2026-09-30**: fixed during branch consolidation. `routes/calendarEvents.js` now validates create/update bodies with Zod (`calendarEvent`/`updateCalendarEvent`), rejecting invalid dates and an end date before the start date, and the subscription feed is published to Cloudinary (`services/calendarFeed.js`) instead of depending on `BACKEND_URL`.

### QA-18 — Goals accept invalid targets and coerce string `false` to true

**Reproduced.** The API accepted a negative target and stored `active: true` for the JSON string `"false"` because it calls `Boolean(active)`. Goal routes have no Zod validation. See `selvora-api/routes/goals.js:22-43`, `:62-72`.

**Update 2026-09-30**: fixed during branch consolidation. `routes/goals.js` now validates through Zod `goal`/`updateGoal` schemas (rejecting a negative target) and a `goalActive` parser that correctly reads boolean/`'true'`/`'false'` instead of `Boolean(active)`.

### QA-19 — Buyer and Invoice are not tenant-owned

**Schema-confirmed.** `Buyer` and `Invoice` have no `user_id`, unlike all other business entities. Once invoice APIs are implemented, records cannot be safely isolated by account without a schema change. See `selvora-api/prisma/schema.prisma:125-132`, `:182-190`.

**Update 2026-09-30**: fixed during branch consolidation (Phase 2). `Buyer` and `Invoice` both now have `user_id`, with `Invoice.buyer` enforced as a composite FK on `[buyer_id, user_id]` so a buyer and its invoice can never belong to different tenants. See `test/buyerOwnership.test.mjs` and `test/buyerInvoiceOwnershipMigration.test.mjs`. No `Invoice` route exists yet (confirmed again in the currency migration audit), so the ownership column is ready but unexercised by any endpoint.

### QA-20 — Several visible controls are nonfunctional

**Reproduced in the browser and confirmed in source.**

- Inventory: search does not filter; Export Report and Add Inventory do nothing.
- Invoices: New Invoice, search, and status filtering do nothing; the page always displays a hard-coded empty state.
- Dashboard: Generate Share Card does nothing.
- Analytics: Export does nothing.
- Transactions: CSV and adjacent export/action control only show “Coming Soon.”
- Settings → Data: selection controls and all three export buttons do nothing.

Relevant locations: `Inventory.jsx:85-90`, `:158`; `Invoices.jsx:14-43`; `Dashboard.jsx:789-791`; `Analytics.jsx:142-144`; `Transactions.jsx:755-763`; `Settings.jsx:150-205`.

**Update 2026-09-30 — partially fixed.** Settings → Data was changed from a fake-interactive mockup to an honest "coming soon" placeholder during branch consolidation (Phase 5). Everything else listed here is still unchanged and still nonfunctional: Inventory's Export Report/Add Inventory buttons, the Invoices page (New Invoice/search/status filter), Dashboard's Generate Share Card, and Analytics' Export control have no click handlers (confirmed directly against current source). Not fixed as part of this pass -- out of scope for the currency-migration/read-cutover work this session focused on; candidates for a dedicated UI task.

### QA-21 — Vendor and Marketplace edit icons do nothing

**Code-confirmed.** The edit icon buttons have no click handlers, while Cashouts has a working edit modal. See `selvora-app/src/components/Settings/Vendors.jsx:503-505` and `Marketplaces.jsx:407-409`.

**Update 2026-09-30**: fixed during branch consolidation (Phase 5). Both edit buttons now call `onClick` handlers that open a working `EditModal` with save handling, matching Cashouts' existing pattern.

### QA-22 — Optional account fields cannot be cleared

**Reproduced.** Updating an account email to an empty string leaves the old email because the validated empty string becomes `null`, then the update uses nullish coalescing to retain the existing value. See `selvora-api/routes/accounts.js:63-73` and `validation/schemas.js:12-15`, `:161`.

**Update 2026-09-30**: fixed during branch consolidation (Phase 4). `routes/accounts.js`'s update handler now uses `field !== undefined ? field : existing.field` instead of `??`, so an explicit `null` from an emptied field is persisted rather than falling back to the old value.

### QA-23 — Some failed mutations are shown as successful locally

**Code-confirmed.** Expense delete/pause, platform delete, payment-method delete, and account delete handlers generally do not check `response.ok` before removing/toggling UI state. A 4xx/5xx `fetch` resolves normally, so the page can hide or toggle an item that the database did not change. Examples: `selvora-app/src/pages/Expenses.jsx:323-340`, `Settings/Vendors.jsx:429-437`, `Settings/PaymentMethods.jsx:117-123`, `Settings/Accounts.jsx:278-288`.

**Update 2026-09-30**: fixed during branch consolidation (Phase 5). Expense delete/pause, vendor/platform delete, payment-method delete, and account delete all now call the shared `requireSuccessfulResponse()` helper and only update UI state after a confirmed success.

### QA-24 — Receipt amounts omit most purchase costs

**Code-confirmed.** Receipts displays inventory amount as `unit_purchase_cost * qty_purchased`, excluding tax, inbound shipping, fees, and gift cards. That conflicts with Dashboard/credit-card spend and the amount likely shown on the receipt. See `selvora-api/routes/receipts.js:48-56`.

**Update 2026-09-30**: fixed during branch consolidation / currency migration Task 7. `routes/receipts.js` now computes the amount via the shared `batchCost()` formula, which includes tax, inbound shipping, fees, and gift card -- not just `unit_purchase_cost * qty_purchased` -- and rounds the Decimal-exact result once at the response boundary.

### QA-25 — Quality gates are too weak for the app’s data risk

- Frontend tests: 2 passing tests, both for ErrorBoundary.
- API tests: 5 passing schema tests.
- Lint: **48 errors and 2 warnings**, including state-in-effect issues and duplicate `commission_fee` in Add Transaction.
- Production build: passes, but warns about the duplicate object key and produces a 1.58 MB main JavaScript chunk.
- No tests cover transaction edits, quantity invariants, concurrent sales, calculations, tenant relationships, recurring generation, receipts, or page workflows.

### QA-26 — Orphaned currency-decimal columns and triggers live in production, undeclared in schema.prisma

**Reproduced (2026-09-30), found while diagnosing an unrelated Render deploy failure.**

Production's Postgres database has 6 `_decimal` NUMERIC columns plus 9 `sync_<Table>_currency` BEFORE INSERT/UPDATE triggers (and their backing functions) on `Inventory`, `Sales`, `Platform`, `PaymentMethod`, `Expense`, `RecurringExpense`, `Invoice`, `Goal`, and `ebay_price_cache`. They were introduced by a migration named `20260912090000_additive_currency_decimals`, applied directly to production from a separate `codex/qa-checkpoint` branch (see commit `6ec3e0e81a51a56d0419000eb8c7496950bdde57` on that branch). No equivalent migration or `_decimal` field exists anywhere in `main`'s `prisma/schema.prisma` or migrations directory — `main` and `codex/qa-checkpoint` implemented overlapping features independently, and only `codex/qa-checkpoint`'s currency-decimal work ever reached the database.

Confirmed impact:
- `grep -r "_decimal"` across `selvora-api` and `selvora-app/src` returns no matches — no application code reads or writes these columns today.
- Current row counts are small: Inventory 62, Sales 49, Platform 49, PaymentMethod 13, Expense 7, Goal 3; RecurringExpense/Invoice/ebay_price_cache are empty.
- **Confirmed failure mode**: a rolled-back test insert of `Infinity` into `Expense.amount` throws `numeric field overflow` from the `sync_Expense_currency` trigger, because Postgres `NUMERIC` cannot represent `Infinity` the way `float`/`double precision` can. Any future bug that produces a float `Infinity`/`-Infinity` (e.g. a division-by-zero in a margin calculation) on any of the 9 affected tables will now hard-fail the entire write with this generic error instead of the failure surfacing in application logic.
- Because this schema exists in the database but not in `schema.prisma`, `prisma db pull` or `prisma migrate dev` run against this database would misrepresent the real schema or report unexpected drift.

Not fixed as part of this task (unrelated to the Render build failure it was found alongside). Recommended follow-up: decide whether to formally adopt the decimal-currency migration into `main` (write the matching `schema.prisma` fields and reconcile the migration history) or drop the orphaned columns/triggers/functions to bring production back in line with `main`'s declared schema.

**Update 2026-09-30**: resolved by the currency migration's Task 3 (`CURRENCY_DECIMAL_MIGRATION_PLAN.md`) -- the columns/triggers were formally adopted into a tracked `main` migration (`20260930000000_additive_currency_decimals`), verified byte-identical to what was already live, and `schema.prisma` now declares all 21 fields. See `qa/CURRENCY_MIGRATION_AUDIT.md` for the comparison report.

### QA-27 — Local test runs can silently hit a live carrier API depending on module require order

**Reproduced 2026-09-30**, found while adding regression tests for the currency migration's Task 4 (unrelated to this finding).

`selvora-api/.env` has real `FEDEX_CLIENT_ID`/`FEDEX_CLIENT_SECRET` values configured (presumably for manual testing of the live app). `test/trackingRoutes.test.mjs`'s `POST /api/sales/:id/track` test asserts `{ trackable: false, reason: 'not_configured' }`, with a comment claiming "No carrier credentials are configured in the test environment" -- but that was only true by accident: whether `services/tracking.js`'s `client.isConfigured()` check sees the real env vars depends on whether something earlier in the require graph has already triggered `dotenv` to load (e.g. via `@prisma/client`'s bundled auto-load) by the time the test harness checks them.

Concretely: adding `require('../services/money.js')` to `selvora-api/validation/schemas.js` (an otherwise-unrelated new require early in the module graph) was enough to flip this test from passing (`not_configured`, ~300ms) to making a real outbound request to FedEx's tracking API and getting `trackable: true` back (~1.5-1.9s) -- confirmed reproducible 6/6 runs with the require present, 6/6 without it. Confirmed **not** a CI risk: `.github/workflows/qa.yml` never sets these env vars, so `FEDEX_CLIENT_ID=` `FEDEX_CLIENT_SECRET=` (matching CI) makes the test pass regardless of require order.

Proposed fix: the test (or the harness's `beforeAll`) should explicitly clear/stub `process.env.FEDEX_CLIENT_ID`/`FEDEX_CLIENT_SECRET` (and the other carrier credential pairs) rather than relying on them happening to be unset, so local runs can't depend on require order or on what happens to be in a developer's `.env`.

### QA-28 — Task 8's read cutover missed nested Platform objects, leaking raw Decimal fields

**Reproduced and fixed 2026-09-30**, found during a fresh QA pass after the currency migration and branch-consolidation work. `Vendor` and a `Sale`'s `platform` are both the same `Platform` model, which carries `fee_pct`/`fee_pct_decimal` -- but the Task 8 read-cutover helpers only ever substituted the *direct* model's own fields, not nested relations of the same model:

- `GET /api/inventory/:id` and `PUT /api/inventory/:id` / `PUT /api/inventory/:id/transaction` use `include: { vendor: true, ... }`, returning the vendor's raw `fee_pct` (not exact) plus the raw `fee_pct_decimal` Decimal instance, unprocessed, as an undocumented extra field in the JSON response. `GET /api/inventory/:id` additionally nests `sales[].platform`, with the same leak.
- `GET /api/sales` includes a sibling `platform` on each sale with the identical leak.
- `GET /api/accounts` includes `platform` with the identical leak.
- `services/scheduleC.js`'s `expenseWorksheet` summed `expense.amount` (the Float column) directly rather than the exact Decimal value, and spread the raw expense record (including the unprocessed `amount_decimal` field) into each worksheet row.
- `routes/analytics.js`'s `cashFlowTransactions[].commission` read `sale.commission_fee` directly, inconsistent with every sibling field in that object, which is Decimal-computed and rounded at the response boundary.

Confirmed real but low-impact in practice: the production reconciliation (`qa/CURRENCY_MIGRATION_AUDIT.md`) already showed zero drift beyond $0.005 for every affected field, so the *displayed numbers* were correct; the bug was the leaked raw `_decimal` field (an internal implementation detail appearing in API responses) and the architectural inconsistency with Task 8's "no production code reads Float monetary fields" goal.

**Fixed**: `exactInventory()` (`routes/inventory.js`) now also substitutes a nested `vendor` and each sale's nested `platform`; `exactSale()` (`routes/sales.js`) now substitutes a nested `platform`; `routes/accounts.js` gained an `exactAccount()` wrapper for its nested `platform`; `routes/scheduleC.js` now runs its expense list through `withExactList()` before building the worksheet; `analytics.js`'s `commission` field now reads the exact Decimal value like its siblings. All via the existing `services/decimalRead.js` helpers -- no new logic, just completing the wiring. Full regression suite (215 backend + 68 frontend tests) green after the fix; no schema or API shape change.

Also surfaced along the way: re-running the original `qa/probe.cjs` bug-reproduction harness against current code confirmed 26 of 29 original probes no longer reproduce (consistent with the QA-01–24 updates above). One probe ("100 KiB JSON parser rejects advertised sub-5 MB receipt," QA-11) still reports REPRODUCED, but this is a harness fidelity gap, not a real regression: `qa/harness.cjs` builds its own bare `express.json()` (Express's 100 KiB default) rather than mounting the real `selvora-api/index.js`, which has set `express.json({ limit: '7mb' })` since the QA-11 fix. Confirmed directly against `index.js` source. Not fixed as part of this task -- a harness-accuracy issue, in the same spirit as QA-25's broader "quality gates are too weak" finding, not a product bug.

## Checks that passed

- Production frontend build completed.
- Prisma schema validated.
- All 12 migrations are applied to the configured PostgreSQL database; schema status is up to date.
- All 16 application routes rendered with fixture data after normal query settling.
- At 390×844, tested routes had no document-level horizontal overflow or blank pages.
- Primary-record ownership checks rejected another user’s inventory update.
- Unauthenticated inventory access returned 401.
- Negative sale quantity was rejected before writes.
- Existing API and frontend test suites passed.

## Coverage and limitations

The audit exercised the actual frontend and Express route code with isolated fixture data. It did not write to the configured PostgreSQL database. Discord OAuth, actual Cloudinary transfer, eBay interaction, generated calendar subscription polling, and PWA offline behavior were not exercised end to end because those require external side effects or deployment-specific credentials. The calendar feed configuration was checked from repository and environment variable names without exposing their values.

Machine-readable probe evidence is in `qa/probe-results.json`; the reproducible harness is `qa/harness.cjs` and `qa/probe.cjs`.
