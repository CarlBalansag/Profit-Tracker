# Profit Tracker Database Schema Diagram
https://mermaid.live/edit#pako:eNpVjctugzAQRX_FmlUrQRQcHokXlRpos4nULrIqZGHBBKMEGxmjNAX-vYaoajurGZ1z7_SQqwKBwemirrng2pBDkkli5zmNha5aU_P2SFz3adihIbWSeBvI9mGnSCtU01SyfLz720kicb-fNCRGVPI83lE8598kDiRJ97wxqjn-JYerGshLWr0LW_-fCI029ZqeODtxN-eaxFzPCjhQ6qoAZnSHDtSoaz6d0E80AyOwxgyYXQuuzxlkcrSZhssPpeqfmFZdKcB2X1p7dU3BDSYVLzX_VVAWqGPVSQPMi-YKYD18Alv5wYJ6dBUtKQ1D3_McuAEL6MJfRX5EN-sw2CxpGIwOfM1Pl4t1FIzfsbNy9w

Based on the notes you've documented for the hybrid model (incorporating `inventory` and `sales` separation), here is the visual representation of how the database entities connect to form the system.

```mermaid
erDiagram
    USERS ||--o{ INVENTORY : "creates"
    USERS ||--o{ PAYMENT_METHODS : "owns"
    USERS ||--o{ EXPENSES : "logs"
    
    INVENTORY ||--o{ SALES : "is fulfilled by"
    
    PLATFORMS ||--o{ INVENTORY : "bought from (vendor)"
    PLATFORMS ||--o{ SALES : "sold on (marketplace)"
    
    PAYMENT_METHODS ||--o{ INVENTORY : "used to pay for"
    
    BUYERS ||--o{ SALES : "buys"
    BUYERS ||--o{ INVOICES : "billed via"

    USERS {
        uuid id PK
        string username
        string email
        string auth_provider
        string accounting_preferences
    }aw

    INVENTORY {
        uuid id PK
        uuid user_id FK
        string product_name
        uuid vendor_id FK "Links to Platforms"
        uuid payment_method_id FK
        datetime purchase_date
        decimal unit_purchase_cost
        int qty_purchased
        int qty_on_hand
        decimal sales_tax
        decimal shipping_cost_inbound
        decimal cashback_earned
        enum category "Cashout, Marketplace"
    }

    SALES {
        uuid id PK
        uuid inventory_id FK
        uuid platform_id FK "Links to Platforms"
        uuid buyer_id FK "Nullable"
        int quantity
        decimal unit_price
        decimal commission_fee
        datetime sale_date
        datetime payout_date
        enum status
    }

    PLATFORMS {
        uuid id PK
        string name
        enum type "Marketplace, Cashout, Vendor"
    }

    BUYERS {
        uuid id PK
        string name
        int avg_days_to_payout
    }

    PAYMENT_METHODS {
        uuid id PK
        uuid user_id FK
        string name "e.g. Amex Blue"
        enum type "Credit, Debit"
        decimal default_cashback_rate
    }
    
    EXPENSES {
        uuid id PK
        uuid user_id FK
        decimal amount
        string category
        datetime date
        string receipt_url
    }

    INVOICES {
        uuid id PK
        uuid buyer_id FK
        datetime issue_date
        datetime due_date
        decimal total_amount
        enum status "Paid, Unpaid"
    }
```

### Key Architectural Takeaways

- **Hybrid Inventory/Sales Split**: As noted in your design files, `INVENTORY` tracks the cost basis (money out), and when an item is sold, a corresponding `SALES` record is created (money in). When you record a sale, it subtracts the `quantity` sold from `INVENTORY.qty_on_hand`.
- **Platforms Multi-Use**: The `PLATFORMS` table acts as both vendors you buy from (Best Buy, Target) linked as `vendor_id` on Inventory, and marketplaces where you sell (eBay, Amazon) linked as `platform_id` on Sales.
- **Profit Calculation Join**: Profit is calculated dynamically by joining the Sales ledger with the original Inventory table to connect revenue generated with the exact cost basis of those goods.
