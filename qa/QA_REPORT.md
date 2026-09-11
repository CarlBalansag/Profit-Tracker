# Selvora full-site QA audit

Audit date: 2026-09-10
Scope: all 16 routed pages, frontend workflows, Express routes, validation, Prisma schema/migrations, calculations, tenant isolation, and responsive behavior.

## Executive result

The current build is deployable, and the live PostgreSQL schema is valid and up to date, but transaction editing is not safe. Several ordinary updates can overwrite fields the user did not edit. Sales and inventory writes are also split across multiple database operations without transactions, allowing partial records and overselling. Financial results differ across Transactions, Dashboard, Credit Card, and the expanded editor.

No product code or live records were changed during this audit. Browser mutation tests ran against an in-memory fixture server that loads the real Express routers. The only live database operation was the read-only `prisma migrate status` check.

## Critical findings

### QA-01 — Partial updates inject create defaults and erase stored values

**Reproduced.** `updateInventory` and `updateSale` are made by calling `.partial()` on schemas whose fields already have defaults. Zod still injects those defaults into a partial update.

- `PUT /api/inventory/:id` with only `{ tracking_number: "QA" }` became an update containing purchase cost `0`, purchased quantity `1`, tax `0`, inbound shipping `0`, fees `0`, and gift card `0`.
- `PUT /api/sales/:id` with only `{ status: "PAID" }` became an update containing quantity `1`, commission `0`, outbound shipping `0`, and collected tax `0`.

This is the direct cause of the reported “Edit Row turns values to zero” behavior. See `selvora-api/validation/schemas.js:61-66`, `:82`, `:91-99`, and `:104`.

### QA-02 — Inline editor cannot preserve vendor, marketplace, or payment method

**Reproduced in the UI.** The inventory list response returns nested `vendor`, `payment_method`, and `platform` objects but omits the raw `vendor_id`, `payment_method_id`, and sale `platform_id` fields. Transactions builds its row IDs from those missing properties.

Consequences:

- Inline Edit Row opens Store, Place Sold, and Payment as blank.
- Saving an unchanged sale cleared Store and Payment and changed total cost/profit.
- Vendor and platform filter option lists are empty; selecting a payment method filters out every row.

See `selvora-api/routes/inventory.js:24-40`, `selvora-app/src/pages/Transactions.jsx:295-304`, `:623-629`.

### QA-03 — Expanded/maximize editor also corrupts an unchanged transaction

**Reproduced in the UI.** With a fixture purchase of $500 + $40 tax + $20 inbound shipping + $10 fee − $50 gift card, clicking maximize and saving without changes:

- changed displayed total cost from **$520 to $560**;
- changed remaining inventory status from `PURCHASED` to `SOLD`;
- removed the fee and gift-card effect;
- changed displayed transaction profit;
- closed as though successful even though the sale update returned HTTP 400.

The modal initializes inventory status from the selected sale row, omits fees and gift card, sends a null payout date the API rejects, and never checks individual sale response statuses. See `selvora-app/src/components/TransactionDetailModal.jsx:115`, `:168-173`, `:181-225`.

### QA-04 — Sale/inventory mutations are non-atomic and can leave impossible data

**Reproduced with injected failures and concurrent requests.**

- Sale creation writes the sale first and decrements inventory second. When the inventory update fails, the API returns 500 but the sale remains.
- Sale editing updates the sale quantity before checking whether sufficient inventory exists. A request changing quantity from 2 to 99 returned 400, but quantity 99 was already stored.
- Two concurrent sales both read one unit on hand and both succeeded. Two sale records were created for one available unit.

See `selvora-api/routes/sales.js:53-87` and `:103-140`. These writes need one database transaction with a conditional/locked stock update.

### QA-05 — Cross-user foreign IDs are accepted

**Reproduced.** Ownership is checked on the main record but not on related IDs.

- A user can attach another user’s platform as an inventory vendor.
- A user can record a sale against another user’s platform.
- A user can create an account under another user’s platform.
- `/api/platforms/batch` will return an existing foreign platform when its UUID is supplied.

This breaks tenant isolation and can expose platform metadata. See `selvora-api/routes/inventory.js:94-103`, `sales.js:53-75`, `accounts.js:15-31`, and `platforms.js:49-68`.

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

### QA-07 — Analytics and Credit Card ignore outbound shipping and count cancelled sales

**Reproduced.** Increasing sale shipping by $100 did not change Dashboard stats or Credit Card loss/netting results. Changing the sale status to `CANCELLED` still counted its revenue, profit, and two units sold.

The analytics query includes every sale status and defines revenue as price minus commission only. Credit Card uses the same omission. See `selvora-api/routes/analytics.js:99-110`, `:131-155`; `creditcard.js:123-135`.

### QA-08 — Cash Flow totals and buyer/owed detail use different data sets

**Code-confirmed.** The analytics API returns only the latest 10 records as `recentTransactions`. Cash Flow uses all-time aggregate stats for its cards but uses those 10 records for “Unpaid” and all buyer breakdowns. Accounts with more than 10 sales get incomplete owed totals and missing buyers while the headline total still includes all sales. See `selvora-api/routes/analytics.js:357` and `selvora-app/src/pages/CashFlow.jsx:21-62`.

### QA-09 — Immediate sale can oversell, partially save, and ignore selected purchase status

**Reproduced.** Creating one purchased unit with `qty_sold: 4` succeeded, created a four-unit sale, and clamped stock to zero. When sale creation failed, the inventory purchase remained even though the API returned 500. A new purchase submitted with `Pre Order` was stored as `PURCHASED`.

See `selvora-api/routes/inventory.js:94-142`. Add Transaction’s sold quantity input also has no maximum tied to purchased quantity (`selvora-app/src/pages/AddTransaction.jsx:868-880`).

### QA-10 — Editing purchased quantity does not reconcile stock or sales

**Reproduced.** A five-unit purchase with two units sold and three on hand accepted an update to `qty_purchased: 1`, leaving `qty_on_hand: 3` plus two sold units. There is no invariant enforcing `qty_purchased = qty_on_hand + valid sold quantity`. See `selvora-api/routes/inventory.js:238-260`.

### QA-11 — Receipt upload limit is effectively about 75 KiB, not 5 MiB

**Reproduced.** A ~150 KiB base64 request was rejected by Express with HTTP 413 before the route’s 5 MiB validation ran, because `express.json()` uses its default 100 KiB body limit. See `selvora-api/index.js:55` and `routes/receipts.js:80-107`.

The route also uploads to Cloudinary before checking record ownership. A foreign/nonexistent item returned 404 after an upload had already occurred (`receipts.js:113-136`), creating orphaned files and allowing unauthorized IDs to consume storage/API quota.

### QA-12 — Recurring expenses skip month-end dates and can duplicate entries

**Reproduced.** Monthly recurrence starting January 31 generated January 31, March 3, and April 3, skipping February. JavaScript `setMonth()` overflow is being used as the recurrence rule (`selvora-api/routes/recurringExpenses.js:34-43`).

Two concurrent GET requests can both see the same `last_generated`, both insert the same occurrence, and then both update the marker. There is no unique constraint on `(recurring_expense_id, date)` and generation is triggered by a read endpoint (`:49-74`, `:77-92`).

### QA-13 — Tax Exempt reporting excludes valid exempt sales and uses the wrong denominator

**Code-confirmed.** The Sales tab is built only from sales belonging to tax-exempt purchases. A customer-exempt/non-taxable sale of ordinarily taxed inventory is omitted. The percentage numerator is period-filtered while its denominator is all sales across all periods. See `selvora-app/src/pages/TaxExempt.jsx:70-78`, `:115-138`.

### QA-14 — Platform tax settings can erase fields or be ignored

**Reproduced at the API.** A partial platform update containing only `tax_exempt_place` reset fee percentage to zero and cleared address/notes. Creating a platform with `tax_exempt_place: true` ignored the flag. See `selvora-api/routes/platforms.js:30-41`, `:75-101` and the defaulted platform validation at `validation/schemas.js:137`.

### QA-15 — Currency is stored and calculated as binary floating point

**Schema-confirmed.** Costs, prices, taxes, fees, cashback, expenses, and invoice totals all use Prisma `Float`/PostgreSQL double precision. Financial arithmetic can accumulate fractions of a cent and inconsistent rounding. These should use fixed-scale `Decimal` or integer cents. See `selvora-api/prisma/schema.prisma:45-53`, `:76-84`, `:139-145`, `:154`, `:171`, `:188`.

## Medium-severity findings

### QA-16 — Add Transaction receipt selection is discarded

**Code-confirmed.** Files can be selected, previewed, and removed, but `handleSubmit` never reads or uploads `attachedFiles`. The transaction succeeds without the advertised attachment. See `selvora-app/src/pages/AddTransaction.jsx:88`, `:173-177`, `:184-211`, `:635-665`.

### QA-17 — Calendar validation and subscription URL are unreliable

**Reproduced.** The API accepted date `2026-02-31`, an end date before the start date, and an unsupported color. The Zod calendar schema exists but the create/update routes do not use it (`selvora-api/routes/calendarEvents.js:379-425`).

Calendar subscription constructs its public feed from `BACKEND_URL`, otherwise `http://localhost:3000`. `BACKEND_URL` is absent from the checked local environment, `.env.example`, and README, so the generated link is locally unusable and production depends on an undocumented variable (`calendarEvents.js:205-208`).

### QA-18 — Goals accept invalid targets and coerce string `false` to true

**Reproduced.** The API accepted a negative target and stored `active: true` for the JSON string `"false"` because it calls `Boolean(active)`. Goal routes have no Zod validation. See `selvora-api/routes/goals.js:22-43`, `:62-72`.

### QA-19 — Buyer and Invoice are not tenant-owned

**Schema-confirmed.** `Buyer` and `Invoice` have no `user_id`, unlike all other business entities. Once invoice APIs are implemented, records cannot be safely isolated by account without a schema change. See `selvora-api/prisma/schema.prisma:125-132`, `:182-190`.

### QA-20 — Several visible controls are nonfunctional

**Reproduced in the browser and confirmed in source.**

- Inventory: search does not filter; Export Report and Add Inventory do nothing.
- Invoices: New Invoice, search, and status filtering do nothing; the page always displays a hard-coded empty state.
- Dashboard: Generate Share Card does nothing.
- Analytics: Export does nothing.
- Transactions: CSV and adjacent export/action control only show “Coming Soon.”
- Settings → Data: selection controls and all three export buttons do nothing.

Relevant locations: `Inventory.jsx:85-90`, `:158`; `Invoices.jsx:14-43`; `Dashboard.jsx:789-791`; `Analytics.jsx:142-144`; `Transactions.jsx:755-763`; `Settings.jsx:150-205`.

### QA-21 — Vendor and Marketplace edit icons do nothing

**Code-confirmed.** The edit icon buttons have no click handlers, while Cashouts has a working edit modal. See `selvora-app/src/components/Settings/Vendors.jsx:503-505` and `Marketplaces.jsx:407-409`.

### QA-22 — Optional account fields cannot be cleared

**Reproduced.** Updating an account email to an empty string leaves the old email because the validated empty string becomes `null`, then the update uses nullish coalescing to retain the existing value. See `selvora-api/routes/accounts.js:63-73` and `validation/schemas.js:12-15`, `:161`.

### QA-23 — Some failed mutations are shown as successful locally

**Code-confirmed.** Expense delete/pause, platform delete, payment-method delete, and account delete handlers generally do not check `response.ok` before removing/toggling UI state. A 4xx/5xx `fetch` resolves normally, so the page can hide or toggle an item that the database did not change. Examples: `selvora-app/src/pages/Expenses.jsx:323-340`, `Settings/Vendors.jsx:429-437`, `Settings/PaymentMethods.jsx:117-123`, `Settings/Accounts.jsx:278-288`.

### QA-24 — Receipt amounts omit most purchase costs

**Code-confirmed.** Receipts displays inventory amount as `unit_purchase_cost * qty_purchased`, excluding tax, inbound shipping, fees, and gift cards. That conflicts with Dashboard/credit-card spend and the amount likely shown on the receipt. See `selvora-api/routes/receipts.js:48-56`.

### QA-25 — Quality gates are too weak for the app’s data risk

- Frontend tests: 2 passing tests, both for ErrorBoundary.
- API tests: 5 passing schema tests.
- Lint: **48 errors and 2 warnings**, including state-in-effect issues and duplicate `commission_fee` in Add Transaction.
- Production build: passes, but warns about the duplicate object key and produces a 1.58 MB main JavaScript chunk.
- No tests cover transaction edits, quantity invariants, concurrent sales, calculations, tenant relationships, recurring generation, receipts, or page workflows.

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
