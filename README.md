# Selvora — Reseller Profit Tracker

> A full-stack business analytics platform built for resellers to track inventory, sales, cashback, and profit across multiple marketplaces.

**Live Demo:** [profit-tracker.vercel.app](https://profit-tracker.vercel.app) *(Discord login required)*

> This repository is private. The app is fully deployed and accessible via the live demo link above.

---

## What It Does

Resellers buying from vendors (Nike, Amazon, etc.) and selling on marketplaces (eBay, StockX, GOAT) need to track true per-item profit — after platform commissions, outbound shipping, purchase cost, inbound shipping, sales tax, and credit card cashback. Spreadsheets break down fast at scale.

Selvora replaces that spreadsheet with a purpose-built analytics platform:

- Log an inventory purchase → record a sale → instantly see net profit
- Credit card cashback is factored into profit calculations at the item level
- Recurring expenses (storage fees, software subscriptions) auto-generate monthly
- A customizable dashboard surfaces KPIs, trends, and pipeline status at a glance

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 5, React Router 7, TanStack Query 5 |
| Styling | Tailwind CSS 4, Lucide Icons, Recharts 3 |
| Backend | Node.js, Express 5 |
| Database | PostgreSQL (Render), Prisma ORM 5 |
| Auth | Discord OAuth 2.0, express-session (PostgreSQL session store) |
| Validation | Zod 4 (schema validation on all mutation endpoints) |
| File Storage | Cloudinary (receipt photos and PDFs) |
| Error Tracking | Sentry (frontend + backend) |
| Hosting | Vercel (frontend) + Render paid tier (API + DB) |
| PWA | vite-plugin-pwa (installable, standalone mode) |
| Testing | Vitest, @testing-library/react |

---

## Architecture

```
Browser (React SPA on Vercel CDN)
  │
  │  apiFetch() — CSRF header injected on every request
  │
  ▼
Vercel Edge (API proxy rewrites)
  │  /api/* → Render API
  │  /auth/* → Render API
  ▼
Express 5 API (Render paid tier)
  │  Passport.js session check
  │  Zod request validation
  ▼
Prisma ORM → PostgreSQL (pgbouncer pooling)
  │
  ├── Cloudinary  (receipt uploads)
  └── EbayPriceCache (last-sold price, 24h TTL)
```

**Session store**: PostgreSQL via `connect-pg-simple` — survives server restarts.
**CSRF protection**: Custom middleware enforces `X-Requested-With: XMLHttpRequest` on all state-changing requests.
**User isolation**: Every database query filters by `user_id` at the query level.

---

## Features

### Inventory & Sales
- Log purchases with vendor, payment method, tax, inbound shipping, and cashback rate
- Record sales with platform, commission fee, outbound shipping, and tax collected
- Full inline editing of any transaction field from the transaction detail modal
- Bulk delete with confirmation
- Status lifecycle tracking: `PURCHASED → LISTED → SOLD → SHIPPED_OUT → PAID → COMPLETED`

### Financial Calculations
- Net profit = revenue − commission − sale shipping − cost basis + cashback
- Cashback rate overrides per vendor/category (e.g. 5% at Amazon on a specific card)
- Cost allocated proportionally across multi-unit batches
- All figures reflected live as you type (no save required to preview)

### Dashboard & Analytics
- Customizable stat cards — show/hide and reorder
- Two UI themes: neon-dark and glassmorphism-brown (persisted per user)
- Revenue/profit trend charts (line, area, bar) via Recharts
- Pipeline counts by status (unsold inventory stages)
- Filter by marketplace, time window (7d / 30d / YTD / All Time)

### Credit Card Tracker
- Monthly statement per credit card
- Loss-to-redeem cashback netting: if an item sold at a loss, shows how much cashback to redeem to cover it
- Month navigation — scroll back to any previous month
- Automatically refreshes when transactions are saved

### Expenses
- One-off and recurring expenses (weekly / biweekly / monthly)
- Auto-generates missing recurring entries on load (catch-up generation)
- Pause and resume recurring expenses without deleting history

### Receipts
- Attach photos or PDFs to any inventory item or expense
- Stored on Cloudinary with MIME type and 5MB size validation

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

## Database Schema (key models)

```
User
  └── Inventory (purchases)
        └── Sales (per-unit sale events)
              └── Buyer
  └── PaymentMethod (credit/debit cards with cashback rates)
  └── Platform (vendors, marketplaces, cashout platforms)
        └── Account (seller accounts per platform)
  └── Expense (one-off)
  └── RecurringExpense → generates Expense entries
EbayPriceCache (product name → last sold price, TTL)
Invoice (buyer invoices)
```

---

## API Surface

| Domain | Endpoints |
|--------|-----------|
| Auth | `GET /auth/discord`, `GET /auth/discord/callback`, `GET /auth/me`, `GET /auth/logout` |
| Inventory | `GET/POST /api/inventory`, `GET/PUT/DELETE /api/inventory/:id` |
| Sales | `GET/POST /api/sales`, `PUT /api/sales/:id` |
| Analytics | `GET /api/analytics/dashboard?mode&date` |
| Credit Card | `GET /api/creditcard/dashboard?month=YYYY-MM` |
| Expenses | Full CRUD `/api/expenses` |
| Recurring Expenses | Full CRUD `/api/recurring-expenses` |
| Platforms | Full CRUD + `/api/platforms/batch` (bulk upsert) |
| Payment Methods | Full CRUD `/api/payment-methods` |
| Accounts | Full CRUD `/api/accounts` |
| Receipts | `POST /api/receipts/attach`, `DELETE /api/receipts/detach` |
| Preferences | `GET/PUT /api/preferences/dashboard-settings/:style` |
| eBay Price | `GET/POST /api/ebay-price` |
| Health | `GET /health` |

All endpoints require session authentication. All mutation endpoints validated with Zod schemas.

---

## Environment Variables

**API (`selvora-api/.env`)**
```
DATABASE_URL=          # Pooled PostgreSQL connection string (pgbouncer)
DIRECT_URL=            # Direct connection for Prisma migrations
SESSION_SECRET=        # >= 32 character secret
FRONTEND_URL=          # https://your-vercel-domain.vercel.app
NODE_ENV=              # production | development
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_CALLBACK_URL=  # https://your-api-domain/auth/discord/callback
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SENTRY_DSN=            # optional
SENTRY_TRACES_SAMPLE_RATE=  # optional, e.g. 0.1
```

**Frontend (`selvora-app/.env`)**
```
VITE_API_URL=          # Leave empty if using Vercel proxy rewrites
VITE_SENTRY_DSN=       # optional
VITE_SENTRY_TRACES_SAMPLE_RATE=  # optional
```
