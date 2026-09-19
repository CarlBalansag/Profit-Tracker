# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Resellers who buy inventory to resell — the product is multi-user: any reseller can sign in with Discord OAuth and manage their own inventory, sales, platforms, payment methods, expenses, and goals, fully scoped to their own account. There is no single designated operator; design and copy should assume independent reseller accounts, not a personal single-user tool.

## Product Purpose

Profit Tracker helps resellers manage the buy-then-sell flow of their business: purchase batches, the sales linked against them, remaining stock, credit-card cashback tied to purchases, business expenses and receipts, and the resulting profit. Success is accurate, per-batch stock and profit visibility without manually reconciling a spreadsheet.

## Positioning

The core mechanism is one purchase batch with zero or more linked partial sales — buying five units creates one Inventory record; selling two creates a linked Sales record, reduces on-hand stock, and allocates cost/profit to that sale automatically. This batch-to-sale linkage, not a generic ledger or line-item bookkeeping model, is what a spreadsheet or a general tool like QuickBooks does not do natively; it is the product's confirmed differentiator.

## Operating Context

Reseller workflows: recording a purchase batch (vendor, payment method, unit cost, batch overhead, receipt upload), recording partial sales against a batch (channel, price, commission, shipping), tracking on-hand stock derived from purchased minus sold quantity, tracking credit-card cashback earned on purchases, logging business expenses (including recurring templates), attaching/reviewing receipts, using a calendar for restock/sale-related events (with a published ICS feed), and optionally opting into a Schedule C cash-method expense worksheet for tax prep. Each user's data (inventory, sales, platforms, payment methods, expenses, goals) is isolated by ownership.

## Capabilities and Constraints

Implemented and routed: Dashboard, Add Transaction, Add Sale, Transactions (merged purchase/sale view — no separate Transaction database model), Inventory, Expenses (+ recurring), Schedule C worksheet (opt-in), Receipts, Analytics, Cash Flow, Credit Card (cashback/loss planning, not bank balances), Tax Exempt, Goals, Calendar, Settings.

Explicit, developer-confirmed constraints:
- Not a complete accounting or bank-synchronization system.
- Financial formulas have historically differed across screens; dashboard, ledger, card, and tax totals must be verified together whenever money logic changes.
- Invoices is an empty prototype UI with no implemented API. Forecast and the root `selvora-v2-glass-workspace.jsx` are standalone prototypes outside the routed app.
- Some export, inventory, and settings controls remain placeholders.
- Dashboard profit calculations do not deduct business Expense records.
- Cashback uses current stored payment-method rates (with vendor-name overrides), not historical rate snapshots; some frontend calculations still use preset fallback data.
- Open product decisions, not yet resolved: overhead treatment, historical cashback handling, cancellation/return stock rules, payout recognition, cashout accounting.

Terminology:
- **Inventory** = a purchase batch record (quantity, unit cost, batch overhead, vendor/payment method, receipt).
- **Sales** = a quantity sold from one Inventory batch (partial sales allowed; price, channel, commission, shipping).
- **Transactions** screen = a merged read of purchases and sales; not its own data model.
- **Stock on hand** = qty purchased minus the sum of linked Sales quantity.

## Brand Commitments

Product name is **Profit Tracker** — confirmed by the user, and the intended name going forward for all user-facing copy, UI text, and branding. "Selvora" appears in the README and some existing internal naming/docs but is not the desired product name; do not introduce or reinforce it in new design or copy work.

## Evidence on Hand

No testimonials, case studies, press, or marketing copy exist. No logo beyond generic favicon/PWA icons (`selvora-app/public/favicon.svg`, `pwa-192x192.png`, `pwa-512x512.png`). Future work must not fabricate customers, reviews, benchmarks, or pricing claims.

## Product Principles

1. Model the real reseller mechanism — batch purchase, linked partial sale, derived stock/profit — rather than a generic ledger or line-item entry model.
2. Treat every reseller as an independent, ownership-scoped account; nothing should assume a single operator.
3. Represent maturity honestly: unfinished areas (Invoices, Forecast, some exports/settings controls) should not be presented as complete, and the product should not claim full accounting/bank-sync capability it doesn't have.
4. Keep money calculations consistent and verifiable across every surface that shows them, since formulas have diverged across screens before.
