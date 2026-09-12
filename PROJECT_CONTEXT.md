# Selvora project reference

Updated September 11, 2026. This is the main knowledge base for returning to the project.
Read [AGENTS.md](AGENTS.md) before changing code. Source code and the Prisma schema take precedence over this reference.

## Project and architecture

Selvora is a reseller profit tracker for inventory purchases, marketplace/cashout sales, cashback, expenses, and receipts.
Some package and deployment names still use **Profit Tracker**.

The central model is **one purchase batch with zero or more sales**. Buying five identical items creates one Inventory record; selling two creates a linked Sales record and reduces stock.
The Transactions screen combines remaining purchases and sales. There is no Transaction database model.
Invoices and forecasts are unfinished; this is not a complete accounting or bank synchronization system.

| Location | Purpose |
|---|---|
| `selvora-app/` | React SPA: Vite, React Router, TanStack React Query, Tailwind, Lucide, Sonner |
| `selvora-api/` | CommonJS Express API: Prisma, Zod, Discord OAuth, PostgreSQL sessions |
| `selvora-api/prisma/` | PostgreSQL schema and migrations |
| `qa/` | Audit findings, remediation evidence, fixture harness and API probes |
| `notes/archive/` | Historical feature plans; read only when investigating design intent |

The packages run independently; there is no root npm workspace runner.
Charts use Recharts and dashboard ECharts loaded from a CDN. Calendar uses FullCalendar.
Cloudinary stores receipts and publishes calendar subscription files.
See package manifests and lockfiles for dependency versions rather than keeping a duplicate version list here.

## Local setup and checks

Configure each package's environment from its `.env.example`; preserve existing environment files.
Install dependencies with `npm ci` in each package. API postinstall generates Prisma Client.
Use a dedicated development PostgreSQL database. Review migrations before applying them to the intended database.

| Working directory | Command | Purpose |
|---|---|---|
| `selvora-api` | `npm start` | API, default port 3000 |
| `selvora-app` | `npm run dev` | Vite frontend, normally port 5173 |
| Either package | `npm test` | That package's Vitest suite |
| `selvora-app` | `npm run lint` | Frontend ESLint |
| `selvora-app` | `npm run build` | Production build and PWA assets |
| `selvora-api` | `npx prisma validate` | Schema validation |
| `selvora-api` | `npx prisma migrate status` | Read migration status against configured database |

There is no Vite API proxy. Set local `VITE_API_URL` to the API origin.
An empty production API URL supports same-origin deployment rewrites.

| Environment variables | Purpose |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Prisma pooled/direct PostgreSQL connections; sessions prefer DIRECT_URL |
| `SESSION_SECRET` | Session secret; startup requires at least 32 characters |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL` | Discord login |
| `FRONTEND_URL` | CORS origin and login redirect; defaults to localhost:5173 |
| `PORT`, `NODE_ENV` | API port and production behavior |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Receipts and calendar feeds |
| `SENTRY_DSN` and related settings | Optional API monitoring; inspect `monitoring.js` |
| `VITE_API_URL` | Frontend API origin |
| `VITE_API_DIRECT_URL` | Direct API origin for OAuth initiation; falls back to VITE_API_URL |

Frontend `src/monitoring.js` is currently a no-op; environment settings alone do not enable frontend Sentry.
Calendar subscriptions use Cloudinary, with no BACKEND_URL requirement.
Keep secrets, session data, customer records and calendar subscription tokens out of documentation.

## Authentication and deployment

Start with [API startup](selvora-api/index.js), [AuthContext](selvora-app/src/context/AuthContext.jsx), and [API hooks](selvora-app/src/hooks/useApi.js).
Discord OAuth creates/finds a user and saves a PostgreSQL session before redirecting.
`/login` is public; application routes use ProtectedRoute and Shell.

`apiFetch` supplies cookies and `X-Requested-With: XMLHttpRequest`; API mutations require that header.
Fetch resolves on HTTP errors, so callers must check response success before changing local UI state.
The shared [response guard](selvora-app/src/hooks/apiResponse.js) handles failed responses.

Sessions use connect-pg-simple, including in development. Production cookies use Secure/SameSite=None; development uses SameSite=Lax.
Production trusts one proxy hop. `/health` checks the process, not database readiness.
The API JSON request limit is 7 MB to accommodate base64 receipt uploads.

Frontend `vercel.json` contains API/auth/health proxy rewrites and an SPA fallback.
`netlify.toml` contains an alternative deployment configuration; confirm the intended target before deployment changes.
[Auth deployment checklist](AUTH_DEPLOYMENT_CHECKLIST.md) covers OAuth/cookie configuration.
PWA assets provide an app-shell cache, not offline CRUD or a synchronization queue.

## Data model and write contracts

The authoritative model is [schema.prisma](selvora-api/prisma/schema.prisma).

| Model | Meaning |
|---|---|
| User | Identity, preferences, tutorial completion and calendar token |
| Inventory | Purchase batch; quantities, unit cost, batch overhead, vendor/payment method and receipt |
| Sales | Quantity sold from one Inventory batch; price, channel, commission, shipping, dates and tax flags |
| Platform | User-owned vendor, marketplace or cashout channel |
| PaymentMethod | User-owned card/instrument; base/store cashback rates and billing metadata |
| Account | User/platform-owned subaccount; no Inventory/Sales assignment foreign key |
| Expense / RecurringExpense | Overhead entries and recurring templates with generation watermark |
| Goal | User metric and 7-day, 30-day, YTD targets |
| ProductNote | Note keyed by user plus lowercase/trimmed product name; not a SKU relationship |
| CalendarEvent | Manual event with YYYY-MM-DD date strings and optional end date |
| Buyer / Invoice | User-owned invoice domain; composite Buyer/Invoice relation enforces matching ownership |
| EbayPriceCache | Global product-name cache; no active scraper in the price router |
| user_sessions | Session table managed by connect-pg-simple, ignored by Prisma |

Money has additive Prisma Decimal companions with retained Float compatibility columns. Calculations use shared Decimal arithmetic. Status/category values are mostly strings, not database enums.
See the separate [currency migration plan](CURRENCY_DECIMAL_MIGRATION_PLAN.md); stages 1–7 are locally verified; hosted migration and final legacy cleanup remain deferred.
Receipts are one URL on Inventory or Expense, not a separate Receipt model.
Deleting Inventory cascades to linked Sales. The recurring-expense delete API atomically deletes the template and its generated entries; its database relation supports SetNull for direct template deletion.

Stock rule: `qty_on_hand = qty_purchased - sum(linked Sales.quantity)`.
Do not assume a cancelled sale automatically restores stock because analytics excludes it from realized totals.
Inventory quantity edits reject purchased quantities below linked sold units and recompute on-hand quantity.
Sale creation and quantity edits use database transactions and conditional stock claims.
Immediate purchase-plus-sale creation uses a transaction. These safeguards do not establish that every concurrent edit/delete path is safe.

Request validation lives in [schemas.js](selvora-api/validation/schemas.js) and the validation middleware.
Updates must preserve omitted fields and distinguish omission from intentional clearing.
[Ownership service](selvora-api/services/ownership.js) checks related IDs; Buyer IDs must belong to the signed-in user; Invoice links must match Buyer ownership.
Verify ownership before external uploads and preserve saved records when an operation fails.

Recurring generation runs on listing active templates and on create/update, through today or the end date.
Monthly dates clamp to month-end while preserving the original anchor day.
Expense has a unique `(recurring_expense_id, date)` constraint; createMany skips duplicates.
Confirm the matching migration is applied before relying on that constraint in a deployed database.

## Screens and API map

Page files are under `selvora-app/src/pages/`; API router files are under `selvora-api/routes/`.
[App.jsx](selvora-app/src/App.jsx) defines current routes; [useApi.js](selvora-app/src/hooks/useApi.js) defines shared queries.
API routes require sessions except explicitly public auth/health and legacy calendar feed handling.

| Screen / route | API or source to inspect |
|---|---|
| Dashboard `/` | `analytics.js`; dashboard registry, chart components and dashboard settings |
| Add Transaction `/add-transaction` | `inventory.js`; autocomplete, recent-entry reuse, draft and receipt upload helper |
| Add Sale `/add-sale` | `sales.js`; selected purchase, stock, commission and shipping |
| Transactions `/transactions` | `inventory.js`, `sales.js`, TransactionDetailModal; merged purchase/sale editing |
| Inventory `/inventory` | `inventory.js`, `productNotes.js`; remaining stock grouped by product name |
| Expenses `/expenses` | `expenses.js`, `recurringExpenses.js`; expense management and CSV export |
| Receipts `/receipts` | `receipts.js`; index, attach, detach, preview |
| Analytics `/analytics` | `analytics.js`; dashboard-derived reporting |
| Cash Flow `/cashflow` | `analytics.js`; inspect latest-sale detail scope separately from summary totals |
| Credit Card `/creditcard` | `creditcard.js`, payment methods; cashback/loss planning, not bank balances |
| Tax Exempt `/tax-exempt` | Inventory/sales data; purchase/sale flags and reporting denominators |
| Goals `/goals` | `goals.js`; typed metric/target validation |
| Calendar `/calendar` | `calendarEvents.js`, `services/calendarFeed.js`; manual/generated events and published ICS |
| Settings `/settings` | Platforms, payment methods, accounts, preferences routers and Settings components |
| Guide `/guide` | Static guidance/tutorial; verify formula claims against implementation |
| Invoices `/invoices` | Empty prototype UI; no implemented invoice API |
| Login `/login` | AuthContext, ProtectedRoute and API startup |

Forecast.jsx and root `selvora-v2-glass-workspace.jsx` are standalone prototypes outside the routed application.
Some export, inventory and settings controls remain placeholders; see QA-20/21 before promising those workflows.

Inventory supports list/create/detail/update/delete plus product-names and recent-by-name lookups.
Sales supports list/create/update, with no standalone delete endpoint.
Receipts supports list, attach and detach. Product notes use GET/PUT/DELETE keyed by name.
Calendar supports CRUD, `/auto`, `/token`, and legacy `/feed.ics`; the latter redirects to the published feed.
Other CRUD paths and router registration are easiest to verify in API startup and the relevant router.

Add Transaction uploads a supported image/PDF after saving the purchase.
If attachment fails, retry uses the saved inventory ID rather than creating another purchase.
Calendar mutations and business writes publish updated feeds through the calendar service; links must be treated as private.

## Calculations and state

Current analytics allocates purchase costs proportionally to sale quantity:

```text
batchCost = unit_purchase_cost * qty_purchased
          + sales_tax + shipping_cost_inbound + fees - gift_card_amount
soldCost = batchCost * sale.quantity / qty_purchased
saleRevenue = unit_price * quantity - commission_fee - sale_shipping
grossProfit = saleRevenue - soldCost
soldCashback = soldCost * effectiveCashbackRate / 100
```

Analytics and Credit Card exclude CANCELLED, RETURNED and DISPUTED sales from realized economics.
Dashboard profit calculations do not deduct business Expense records.
Purchase spend and sale results use different date scopes; current stock and related card sales can have broader scopes.
Recent transactions in analytics are limited to ten sales, not a complete ledger.

Cashback uses current stored payment-method rates with vendor-name substring overrides and expiry dates.
Some frontend calculations also use preset fallback data. There is no universal historical rate snapshot or reward-cap engine.
Static presets need periodic review. Credit Card estimates spend/loss coverage; it does not record bank payments or statement balances.

Core batch allocation, sale economics and stored-rate cashback are shared in `shared/decimalFinance.mjs`. Verify preview, editor, ledger, dashboard, card and tax totals together when changing money.
Product decisions still needed include overhead treatment, historical cashback, cancellation/return stock rules, payout recognition and cashout accounting.

React Query coexists with local-state fetching in Expenses, Receipts and Settings components.
Invalidating a query does not refresh a separate local array; inspect all affected views after writes.
Query keys and several localStorage keys are not namespaced by user, so login transitions/cache clearing matter.
Browser storage includes dashboard layout, UI preferences, a 30-minute purchase draft and transaction columns.

`src/index.css` controls theme tokens, glass/carbon layouts and many utility overrides.
`useUiPreferences.js` manages browser theme/style; `useDashboardSettings.js` manages per-style layouts and server preferences.
Dashboard variants change layout/navigation as well as colors. Inspect active imports before modifying retained legacy CSS/UI components.

## QA and future work

[QA_REPORT.md](qa/QA_REPORT.md) is the September 10 audit, not a live list of unfixed bugs.
[QA_REMEDIATION_PROGRESS.md](qa/QA_REMEDIATION_PROGRESS.md) records selected later fixes and their validation.
Read both alongside current source/tests; remediation entries may retain historical commit/push status.
Newer code has safeguards absent from the audit, including update preservation, related-ID checks, stock claims, receipt safety and recurrence deduplication.
Do not infer that an audit finding remains open or is fully resolved without checking its affected paths.

Backend regression tests are in `selvora-api/test/`; frontend tests sit alongside source files.
The QA harness/probes use mocked Prisma/Cloudinary and fixture data; they are not proof of real PostgreSQL concurrency or external-service behavior.
Old test counts, lint counts and migration status are historical evidence, not current verification results.
This cleanup changes documentation only and does not revalidate application workflows or deployment state.

[BACKLOG.md](BACKLOG.md) is the single curated list of future ideas, replacing notes/todo.txt.
Archived notes preserve design history but contain proposed models/formulas that differ from current code.
Use Git history for code changes instead of maintaining Changes.txt.
Update only the affected reference section when architecture, contracts or behavior changes; keep detailed QA evidence in qa/.
