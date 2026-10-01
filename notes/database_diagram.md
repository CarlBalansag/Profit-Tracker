# Selvora Database Schema Diagram

Reflects `selvora-api/prisma/schema.prisma` as of 2026-09-30 (post currency-Decimal migration, post Firebase auth migration, post Buyer/Invoice tenant ownership). To regenerate a visual diagram, paste the Mermaid block below into [mermaid.live](https://mermaid.live) — the previous version of this file linked a pre-rendered diagram that encoded the stale schema below and has been removed rather than left misleading.

## Core business entities

```mermaid
erDiagram
    USERS ||--o{ INVENTORY : "creates"
    USERS ||--o{ PAYMENT_METHODS : "owns"
    USERS ||--o{ EXPENSES : "logs"
    USERS ||--o{ RECURRING_EXPENSES : "owns"
    USERS ||--o{ PLATFORMS : "owns"
    USERS ||--o{ ACCOUNTS : "owns"
    USERS ||--o{ GOALS : "sets"
    USERS ||--o{ BUYERS : "owns"
    USERS ||--o{ INVOICES : "owns"
    USERS ||--o{ PRODUCT_NOTES : "writes"
    USERS ||--o{ CALENDAR_EVENTS : "creates"

    INVENTORY ||--o{ SALES : "is fulfilled by"
    RECURRING_EXPENSES ||--o{ EXPENSES : "generates"

    PLATFORMS ||--o{ INVENTORY : "bought from (vendor)"
    PLATFORMS ||--o{ SALES : "sold on (marketplace)"
    PLATFORMS ||--o{ ACCOUNTS : "has seller account"

    PAYMENT_METHODS ||--o{ INVENTORY : "used to pay for"

    BUYERS ||--o{ SALES : "buys"
    BUYERS ||--o{ INVOICES : "billed via (same-tenant FK)"

    USERS {
        uuid id PK
        string email
        string username
        string discord_id "legacy, nullable"
        string auth_provider "legacy, nullable"
        boolean schedule_c_enabled
        json accounting_preferences
        boolean tutorial_seen
    }

    INVENTORY {
        uuid id PK
        uuid user_id FK
        string product_name
        uuid vendor_id FK "Platform, type=vendor"
        uuid payment_method_id FK
        datetime purchase_date
        float unit_purchase_cost
        decimal unit_purchase_cost_decimal
        int qty_purchased
        int qty_on_hand
        float sales_tax
        float shipping_cost_inbound
        float fees
        float cashback_earned
        float gift_card_amount
        string status "PURCHASED..COMPLETED"
        boolean tax_exempt
    }

    SALES {
        uuid id PK
        uuid inventory_id FK
        uuid platform_id FK "nullable, Platform"
        uuid buyer_id FK "nullable"
        int quantity
        float unit_price
        decimal unit_price_decimal
        float commission_fee
        float sale_shipping
        float sale_tax_collected
        datetime sale_date
        datetime payout_date
        string status
        boolean taxable
        boolean customer_tax_exempt
    }

    PLATFORMS {
        uuid id PK
        uuid user_id FK
        string name
        string type "Marketplace, Cashout, Vendor"
        float fee_pct
        decimal fee_pct_decimal
        boolean tax_exempt_place
    }

    ACCOUNTS {
        uuid id PK
        uuid user_id FK
        uuid platform_id FK
        string name
        string email "nullable"
        string status
    }

    BUYERS {
        uuid id PK
        uuid user_id FK
        string name
    }

    PAYMENT_METHODS {
        uuid id PK
        uuid user_id FK
        string name
        string type "Credit, Debit"
        float default_cashback_rate
        float credit_limit "nullable"
        float min_payment_pct "nullable"
        int statement_close_day "nullable"
        int due_day "nullable"
        string category_rates "JSON array"
    }

    EXPENSES {
        uuid id PK
        uuid user_id FK
        uuid recurring_expense_id FK "nullable"
        string name
        float amount
        decimal amount_decimal
        string category
        datetime date
        string receipt_url "nullable"
        json tax_details "Schedule C review state"
        int tax_version "optimistic concurrency"
    }

    RECURRING_EXPENSES {
        uuid id PK
        uuid user_id FK
        string name
        float amount
        string frequency "weekly, biweekly, monthly"
        datetime start_date
        datetime end_date "nullable"
        datetime last_generated "nullable"
        boolean active
    }

    GOALS {
        uuid id PK
        uuid user_id FK
        string metric "netProfit, totalRevenue, unitsSold"
        float target_7d "nullable"
        float target_30d "nullable"
        float target_ytd "nullable"
        boolean active
    }

    INVOICES {
        uuid id PK
        uuid buyer_id FK
        uuid user_id FK "composite FK with buyer_id"
        datetime issue_date
        datetime due_date
        float total_amount
        string status "Paid, Unpaid"
    }

    PRODUCT_NOTES {
        uuid id PK
        uuid user_id FK
        string product_name "unique per user, case-insensitive"
        string note
    }

    CALENDAR_EVENTS {
        uuid id PK
        uuid user_id FK
        string title
        datetime date
        datetime end_date "nullable"
        string color
    }
```

`EbayPriceCache` (mapped to table `ebay_price_cache`) is standalone, keyed by `product_name` (no FKs): caches `last_sold_price`/`last_sold_price_decimal` with a 24-hour TTL via `fetched_at`.

## Auth & session models (no business-data FKs)

Added by the Discord-to-Firebase auth migration. All relate 1:1 or many:1 to `User`, with no relation to any business entity above.

| Model | Purpose |
|---|---|
| `FirebaseIdentity` | Links a `User` 1:1 to a Firebase project UID. |
| `FirebaseSession` | An active/revoked Firebase session cookie, keyed by hashed fingerprint; belongs to `FirebaseIdentity`. |
| `LocalCredential` | Legacy local username/password credential (1:1 with `User`, PK = `user_id`); used only for the migration path onto Firebase. |
| `AuthIntent` | Short-lived, single-use token binding a login/signup/migration attempt before Firebase token exchange. |
| `MigrationApproval` | Owner-granted, time-limited approval letting a specific Firebase identity link to an existing local account. |
| `AuthAttemptBucket` | Sliding-window rate-limit counter for auth endpoints. |
| `user_sessions` | Express session store table, fully managed by `connect-pg-simple` (`@@ignore`d by Prisma). |

## Currency precision mirrors

Every model with money/rate fields above (`Inventory`, `Sales`, `Platform`, `PaymentMethod`, `Expense`, `RecurringExpense`, `Invoice`, `Goal`, `EbayPriceCache`) has a parallel `Decimal` column per field (`*_decimal`, shown only on `Inventory.unit_purchase_cost` and `Sales.unit_price` above for brevity), kept exactly in sync by database triggers and substituted into every API response. See the root `README.md`'s "Currency precision" section and `qa/CURRENCY_MIGRATION_AUDIT.md`.

## Key architectural notes

- **Hybrid Inventory/Sales split**: `INVENTORY` tracks the cost basis (money out); a `SALES` row records money in against it and decrements `INVENTORY.qty_on_hand`. Both are written inside a single Prisma transaction with an optimistic-concurrency claim on quantity, so a failed or concurrent write can't leave a partial record or oversell.
- **Platforms are multi-use**: the `PLATFORMS` table is vendors you buy from (`vendor_id` on Inventory), marketplaces/cashouts you sell on (`platform_id` on Sales), and the parent of seller `ACCOUNTS` — all the same model, distinguished by `type`.
- **Every related ID is ownership-checked**: vendor, payment method, sale platform, and buyer IDs are verified to belong to the requesting user (`services/ownership.js`) before being attached to a record, not just the primary record itself.
- **Profit calculation** joins the Sales ledger with its Inventory row to connect revenue with the batch's cost basis, allocated proportionally for multi-unit batches; the formula lives in one shared module (`shared/finance.mjs`, with a Decimal-exact backend mirror in `services/decimalFinance.js`) consumed consistently everywhere it's displayed.
- **Buyer/Invoice are tenant-owned**: both carry `user_id`, with `Invoice.buyer` enforced as a composite FK on `(buyer_id, user_id)` so a buyer and its invoice can never belong to different users. No API route reads/writes `Invoice` yet — the ownership column is in place but unexercised.
