# Selvora — Reseller Profit Tracker

> A full-stack business analytics platform built for resellers to track inventory, sales, cashback, and profit across multiple marketplaces.

**Live Demo:** [profittracker.carltechs.com](https://profittracker.carltechs.com) *(Firebase email/password login required)*

> This repository is private. The app is fully deployed and accessible via the live demo link above.

---

## What It Does

Resellers buying from vendors (Nike, Amazon, etc.) and selling on marketplaces (eBay, StockX, GOAT) need to track true per-item profit — after platform commissions, outbound shipping, purchase cost, inbound shipping, sales tax, and credit card cashback. Spreadsheets break down fast at scale.

Selvora replaces that spreadsheet with a purpose-built analytics platform:

- Log an inventory purchase → record a sale → instantly see net profit
- Credit card cashback is factored into profit calculations at the item level
- Recurring expenses (storage fees, software subscriptions) auto-generate monthly
- A customizable dashboard surfaces KPIs, trends, and pipeline status at a glance
- Optional Schedule C tax worksheet groups expenses by IRS category for filing

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 5, React Router 7, TanStack Query 5 |
| Styling | Tailwind CSS 4, Lucide Icons, Recharts 3 |
| Backend | Node.js (>=22), Express 5 |
| Database | PostgreSQL (Neon, serverless/auto-suspended), Prisma ORM 5 |
| Auth | Firebase Authentication (email/password), server-verified session cookie |
| Validation | Zod 4 (schema validation on all mutation endpoints) |
| Money | Prisma `Decimal` end-to-end (purchase/sale/fee/cashback/expense fields) — see [Currency precision](#currency-precision) |
| File Storage | Cloudinary (receipt photos/PDFs, and the hosted calendar `.ics` feed) |
| Error Tracking | Sentry (frontend + backend) |
| Hosting | Netlify (frontend) + Render (API), Neon (DB) |
| PWA | vite-plugin-pwa (installable, standalone mode) |
| Testing | Vitest (API + frontend), @testing-library/react |

---

## Architecture

```
Browser (React SPA on Netlify CDN)
  │
  │  apiFetch() — CSRF header injected on every request
  │
  ▼
Netlify redirects (netlify.toml)
  │  /api/*  → Render API
  │  /auth/* → Render API
  │  /health → Render API
  │  /*      → index.html (SPA fallback)
  ▼
Express 5 API (Render)
  │  Firebase session-cookie guard (routes/firebaseAuth.js)
  │  Zod request validation
  ▼
Prisma ORM → PostgreSQL (Neon)
  │
  ├── Cloudinary       (receipt uploads, hosted calendar feed)
  └── EbayPriceCache   (last-sold price, 24h TTL)
```

**Session store**: PostgreSQL via `connect-pg-simple`, holding a server-verified Firebase session cookie — survives server restarts.
**CSRF protection**: Custom middleware enforces `X-Requested-With: XMLHttpRequest` on all state-changing requests.
**User isolation**: Every database query filters by `user_id` at the query level; related IDs (vendor, payment method, platform, buyer) are ownership-checked before being attached to a record.

---

## Features

### Inventory & Sales
- Log purchases with vendor, payment method, tax, inbound shipping, and cashback rate
- Record sales with platform, commission fee, outbound shipping, and tax collected
- Full inline editing of any transaction field from the transaction detail modal, saved atomically alongside its sales
- Bulk delete with confirmation
- Status lifecycle tracking: `PURCHASED → LISTED → SOLD → SHIPPED_OUT → PAID → COMPLETED`

### Financial Calculations
- Net profit = revenue − commission − sale shipping − cost basis + cashback
- Cashback rate overrides per vendor/category (e.g. 5% at Amazon on a specific card)
- Cost allocated proportionally across multi-unit batches (cumulative-boundary rounding so allocations always sum exactly to the batch total)
- All figures reflected live as you type (no save required to preview)
- Server-side money math is exact (Prisma `Decimal`), not binary floating point — see [Currency precision](#currency-precision)

### Dashboard & Analytics
- Customizable stat cards — show/hide and reorder
- Two UI themes: neon-dark and glassmorphism-brown (persisted per user)
- Revenue/profit trend charts (line, area, bar) via Recharts
- Pipeline counts by status (unsold inventory stages)
- Filter by marketplace, time window (7d / 30d / YTD / All Time)
- Excludes cancelled/returned/disputed sales from revenue and profit; includes outbound shipping in cost

### Credit Card Tracker
- Monthly statement per credit card
- Loss-to-redeem cashback netting: if an item sold at a loss, shows how much cashback to redeem to cover it
- Month navigation — scroll back to any previous month
- Automatically refreshes when transactions are saved

### Expenses & Schedule C
- One-off and recurring expenses (weekly / biweekly / monthly), with month-end-safe recurrence (no skipped/duplicated occurrences)
- Auto-generates missing recurring entries on load (catch-up generation), unique-constrained against duplicates
- Pause and resume recurring expenses without deleting history
- Optional Schedule C worksheet: categorizes expenses by IRS line, tracks reviewed/pending/excluded status and documentation gaps, per tax year

### Receipts
- Attach photos or PDFs to any inventory item or expense
- Stored on Cloudinary with MIME type and size validation; ownership is checked before upload

### Calendar
- Auto-generated events from purchases, sales/payouts, and credit-card due dates
- Manually created events, with a private hosted `.ics` subscription feed (published to Cloudinary, no extra server config required)

### Onboarding
- 20-step interactive tutorial with spotlight overlays on key UI elements
- Persisted per user (`tutorial_seen` flag)
- Replayable from the Guide page

### Other
- Tax-exempt purchase and sale tracking (resale exemptions)
- Seller account management per platform
- eBay last-sold price lookup with 24-hour database cache
- Installable as a PWA (offline-capable shell)

---

## Currency precision

Every money and rate field (purchase cost, sale price, fees, tax, shipping, cashback, expense amounts, credit limits, goal targets, cached prices) is backed by a Prisma `Decimal` column kept exactly in sync with its legacy `Float` column by database triggers, validated on write via a shared `services/money.js` utility (rejects negative/over-precision/non-finite input), aggregated in `Decimal` wherever a route sums many rows (avoiding floating-point drift across hundreds of records), and substituted into API responses by `services/decimalRead.js` so every number the frontend receives is exact — with no change to the response shape. See `CURRENCY_DECIMAL_MIGRATION_PLAN.md` and `qa/CURRENCY_MIGRATION_AUDIT.md` for the full migration record and a zero-drift production reconciliation. The legacy `Float` columns remain as a reversible safety net pending a production verification window before their removal.

---

## Database Schema (key models)

```
User
  ├── FirebaseIdentity ── FirebaseSession*        (Firebase auth identity + active sessions)
  ├── LocalCredential                             (legacy local password, migration path only)
  ├── Inventory (purchases)
  │     └── Sales (per-unit sale events) ── Buyer
  │           (paid_at/paid_amount/paid_reference/payout_account/payout_short_amount track payouts)
  ├── PaymentMethod (credit/debit cards with cashback rates; is_personal flags owner-funded accounts)
  ├── Platform (vendors, marketplaces, cashout platforms)
  │     └── Account (seller accounts per platform)
  ├── Expense (one-off)
  ├── RecurringExpense → generates Expense entries
  ├── Buyer → Invoice                             (who a sale was actually paid by/through)
  ├── Goal (profit/revenue/units targets)
  ├── ProductNote
  ├── CalendarEvent
  ├── ApiKey                                      (hashed MCP bearer tokens, see MCP Server below)
  ├── McpWriteLog                                 (audit trail of every MCP write)
  └── ChangeLog                                   (field-level edit history from update_sale/update_purchase)
EbayPriceCache (product name → last sold price, TTL)
AuthIntent, MigrationApproval, AuthAttemptBucket   (stateless auth-flow support, no FK to User)
```

Every model above except `User`, `Account`, `Buyer`, `ProductNote`, `CalendarEvent`, and the auth-support models has a `Decimal` mirror column per money/rate field (see [Currency precision](#currency-precision)).

---

## API Surface

| Domain | Endpoints |
|--------|-----------|
| Auth | `POST /auth/firebase/intent`, `POST /auth/firebase/session`, `POST /auth/firebase/link`, `POST /auth/firebase/account-check`, `POST /auth/firebase/logout-all`, `GET/PATCH /auth/me`, `POST /auth/logout` |
| Inventory | `GET/POST /api/inventory`, `GET /api/inventory/product-names`, `GET /api/inventory/recent-by-name`, `GET/PUT/DELETE /api/inventory/:id`, `PUT /api/inventory/:id/transaction`, `POST /api/inventory/:id/track` |
| Sales | `GET/POST /api/sales`, `PUT/DELETE /api/sales/:id`, `POST /api/sales/:id/track`, `POST /api/sales/mark-paid-batch` (mark several sales paid from one deposit) |
| Buyers | Full CRUD `/api/buyers` (who a sale was actually paid by/through) |
| API Keys | Full CRUD `/api/api-keys` (session-authed; manages MCP bearer tokens — see MCP Server below) |
| Analytics | `GET /api/analytics/dashboard?mode&date` |
| Credit Card | `GET /api/creditcard/dashboard?month=YYYY-MM` |
| Expenses | Full CRUD `/api/expenses` |
| Recurring Expenses | Full CRUD `/api/recurring-expenses` |
| Schedule C | `GET /api/schedule-c?year=YYYY` |
| Platforms | Full CRUD + `/api/platforms/batch` (bulk upsert) |
| Payment Methods | Full CRUD `/api/payment-methods` |
| Accounts | Full CRUD `/api/accounts` |
| Goals | Full CRUD `/api/goals` |
| Receipts | `GET /api/receipts`, `POST /api/receipts/attach`, `DELETE /api/receipts/detach` |
| Product Notes | `GET/PUT/DELETE /api/product-notes` |
| Calendar Events | `GET /api/calendar-events`, `GET /api/calendar-events/auto`, `POST/PUT/DELETE /api/calendar-events/:id`, `POST /api/calendar-events/token` |
| Shipping Tracking | `POST /api/inventory/:id/track`, `POST /api/sales/:id/track` |
| Preferences | `GET/PUT /api/preferences/dashboard-settings/:style`, `GET/PUT /api/preferences/schedule-c` |
| eBay Price | `GET/POST /api/ebay-price` |
| Health | `GET /health` |

All `/api/*` endpoints require a valid Firebase session cookie. All mutation endpoints are validated with Zod schemas; related IDs are ownership-checked before being attached to a record. The one exception is `POST /mcp` (below), which uses a bearer-token API key instead of a session cookie.

---

## MCP Server (AI Assistant Access)

An MCP (Model Context Protocol) server lets an AI assistant — e.g. Claude, configured with an MCP connector — read and update your reselling data directly over HTTP, without ever logging in through the browser. It's mounted on the existing API (`selvora-api`) at `POST /mcp`, using the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) over Streamable HTTP in stateless mode (no server-held session — safe across restarts/redeploys). See `selvora-api/routes/mcp.js`.

### Why it's on the same server, not a separate one

It reuses the exact Prisma client/DB pool already tuned for Neon (the session pool is deliberately capped at 3 connections with pruning disabled, specifically to avoid waking Neon's auto-suspended compute — a second service would mean a second pool competing for that same budget), and the MCP tools call the same `requireOwned`/finance helpers the web routes use, so there's one source of truth for how revenue/profit is computed. For a single-user tool talking to one AI assistant, that outweighs the extra isolation a separate deployment would give.

### Auth: per-user API key (not your login)

`POST /mcp` is authenticated by `middleware/apiKeyAuth.js` via `Authorization: Bearer <token>`, checked against a per-user key stored only as a SHA-256 hash (`ApiKey.key_hash`) — the raw token is shown to you exactly once, when it's created or rotated, and is unrecoverable after that. This is deliberately separate from the Firebase session cookie used everywhere else in the app.

**Create or rotate a key:** sign into the app normally, go to **Settings → AI Assistant**, and click **Generate Key** (or **Rotate** on an existing key, which immediately invalidates the old token and issues a new one). Copy the token shown — it will not be shown again. Give this token to your AI assistant's MCP client configuration as the bearer token; never your account password.

### Endpoint

```
POST https://api.profittracker.carltechs.com/mcp
Authorization: Bearer <your-api-key>
Content-Type: application/json
Accept: application/json, text/event-stream
```

That's the real custom domain the frontend's Netlify redirects proxy to (`selvora-app/netlify.toml`) — not the raw Render URL. The `Accept` header listing both content types is required by the Streamable HTTP spec even though this server always responds with a single JSON body (`enableJsonResponse: true`), never SSE. Every write is recorded in `McpWriteLog` with a timestamp, tool name, and payload; `update_sale`/`update_purchase` additionally record one `ChangeLog` row per changed field (old value, new value), reviewable via `list_changes` — nothing is ever silently applied.

A sale's "buyer" is the marketplace/cashout `Platform` it was recorded against (`Sales.platform_id` — the same value `platform_id`/`cashout_platform_id`/`marketplace_platform_id` already capture when a sale is created in the web UI), not a separate contact list. `update_sale`'s `platform` param corrects it after the fact by name; nothing auto-creates a platform on an edit (unlike a purchase's vendor/store) — a typo would misattribute a sale's payout, so the name must already exist.

### Tools

Read-only:
- `list_sales(start_date?, end_date?, buyer?, payout_status?, limit?)` — `buyer` filters by the sale's marketplace/cashout name (partial, case-insensitive). Omit `limit` to get every matching sale; the SDK validates it to at most 500 when given.
- `list_inventory(status?)`
- `list_expenses(start_date?, end_date?, category?)`
- `get_cashflow_summary()` — owed to you, spend, and on-hand value, by buyer (the sale's marketplace/cashout)
- `get_unpaid_by_buyer()`
- `list_changes(limit?, record_id?)` — field-level edit history written by `update_sale`/`update_purchase` (table, record id, field, old value, new value, timestamp), most recent first. Pass `record_id` to see one sale's or purchase's history. A wrong edit is corrected by calling `update_sale`/`update_purchase` again with the `old_value` shown here — there is no automatic revert.

Write (no delete tools exist for any of these):
- `mark_sale_paid(sale_ids[], payout_date, payout_amount, payout_account?, payout_reference?)` — marks several sales paid from one deposit; works on a sale in `OUTBOUND`, `WAITING_FOR_PAYMENT`, `AWAITING_HANDOFF`, or `HANDED_OVER` (payment can land before carrier delivery/handoff is confirmed), and sets `workflow_status` to `PAID`. If `payout_amount` is less than the combined expected revenue of the given sales, the shortfall is split across them proportionally and recorded (`payout_short_amount`) rather than silently absorbed.
- `add_purchase(item, qty, unit_cost, store, card_used, purchase_date, tax_exempt?)` — `store` (vendor) is created automatically if new; `card_used` must already exist as a Payment Method (cashback/limit settings are never guessed).
- `add_expense(description, amount, date, category?, paid_from_account)` — `paid_from_account` must already exist as a Payment Method.
- `add_sale(inventory_id, qty, sale_price, fees?, sale_date, platform, notes?)` — logs a new sale against an existing purchase, claiming stock the same way the web UI's Record Sale does (rejects an oversell). `platform` must already exist.
- `update_sale(sale_id, price?, fees?, shipping?, qty?, sale_date?, platform?, notes?)` — edits an existing sale. **Never accepts payout fields** (`paid_at`/`paid_amount`/`payout_account`/`payout_reference`/`payout_short_amount` aren't in its schema at all, which is validated `.strict()` — passing them, or any other unknown field, is rejected rather than silently ignored). Changing `qty` adjusts the purchase's `qty_on_hand` by the difference, oversell-checked the same as a new sale.
- `update_purchase(purchase_id, qty?, unit_cost?, purchase_date?, store?, notes?)` — edits an existing purchase. `qty` can't drop below what's already sold from it. Total cost is derived (`unit_cost × qty` plus any tax/shipping/fees already on the row), not a separate settable field.

All three new write tools validate dates strictly (a real calendar date, not just the `YYYY-MM-DD` shape — `2026-02-30` is rejected) and reject any field not in their schema.

All amounts are returned as plain numbers and all dates as `YYYY-MM-DD` strings. Every tool is scoped to the calling token's own user — see `test/mcpTenantIsolation.test.mjs` for the end-to-end proof (two separate users/tokens, through the real auth middleware, confirming no tool leaks or mutates another user's data).

### Running locally

```bash
cd selvora-api
npm install
npm start          # the API, including /mcp, now listens on PORT (default 3000)
```

Generate a key from the running app's Settings → AI Assistant page (pointed at your local API via `VITE_API_URL`), then point your MCP client at `http://localhost:3000/mcp` with that key as the bearer token.

### Deploying

No separate deployment: `/mcp` ships with every deploy of the existing `selvora-api` Render service (same `npm start`, same environment variables — see [Environment Variables](#environment-variables)). Nothing extra to configure.

---

## Environment Variables

**API (`selvora-api/.env`)** — see `selvora-api/.env.example` for the authoritative, commented list. Key groups:
```
DATABASE_URL=          # Neon pooled PostgreSQL connection string
SESSION_SECRET=        # >= 32 character secret
FRONTEND_URL=          # https://your-netlify-domain
NODE_ENV=              # production | development

# Firebase Auth (server)
FIREBASE_AUTH_ENABLED=
FIREBASE_SIGNUP_ENABLED=
FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_JSON=   # service-account JSON, Render secret

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SENTRY_DSN=                      # optional
SENTRY_TRACES_SAMPLE_RATE=       # optional, e.g. 0.1

# Shipping tracking — all optional, per carrier
UPS_CLIENT_ID= / UPS_CLIENT_SECRET=
FEDEX_CLIENT_ID= / FEDEX_CLIENT_SECRET=
USPS_CLIENT_ID= / USPS_CLIENT_SECRET=
```

`DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_CALLBACK_URL` are no longer read by the app — Discord OAuth is retired (the `/auth/discord*` routes now just redirect to `/login`). `passport`/`passport-discord` remain as unused dependencies pending removal.

Calendar subscriptions use the configured Cloudinary account to publish a private, stable ICS feed. No `BACKEND_URL` variable is required. Keep the generated subscription link private because anyone with it can read that calendar.

**Frontend (`selvora-app/.env.local`)** — see `selvora-app/.env.example`:
```
VITE_API_URL=                    # Leave empty when using Netlify redirects (netlify.toml)

# Firebase Auth (public web config — never put a service-account key here)
VITE_FIREBASE_AUTH_ENABLED=
VITE_FIREBASE_SIGNUP_ENABLED=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_APP_ID=

VITE_SENTRY_DSN=                 # optional
VITE_SENTRY_TRACES_SAMPLE_RATE=  # optional
```
