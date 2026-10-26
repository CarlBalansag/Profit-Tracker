# Schedule C — Future Planning Notes

> Planning and recordkeeping notes only. The current Schedule C work remains separate. This document is not tax advice and does not represent a filing-ready tax calculation.

## Product boundary

Schedule C is a federal income-tax worksheet. It is separate from state sales-tax exemption tracking. Profit Tracker should collect objective facts and supporting evidence, calculate reviewable worksheet totals, and allow the user or tax professional to confirm tax treatment.

Avoid storing the proprietor's SSN unless the product later becomes a secured tax-filing service. A worksheet export can leave that field blank.

## Existing foundation to retain

The current Schedule C expense work already captures useful supporting information:

- Business, mixed, personal, or unreviewed use
- Business-use percentage
- Payee/vendor
- Business purpose
- Expense category
- Payment status and paid date
- Payment evidence reference
- Receipt attachment status
- User-reviewed confirmation

Future work would expand beyond the current paid-expense worksheet rather than replace it.

## Business tax profile

Store one profile per business and tax year:

- Entity type and whether Schedule C is applicable
- Proprietor and business/DBA name
- Business address
- EIN when applicable
- Principal business description
- Six-digit business/NAICS code
- Accounting method: cash, accrual, or other
- Material participation answer
- Whether the business started, was acquired, or restarted during the year
- Whether payments may require Forms 1099
- Whether required Forms 1099 were or will be filed
- At-risk classification if a loss is reported

One user may operate more than one business, so this must not be a single global user setting.

## Income terminology for resellers

Do not treat gross sale, gross profit, net payout, and net profit as synonyms.

```text
Gross receipts
− customer returns and allowances
= net receipts

Net receipts
− cost of goods sold
= gross profit

Gross profit
− platform fees
− outbound shipping
− other business expenses
= net business profit
```

### Example sale

```text
Item sale price:                 $250
Shipping charged to customer:    $15
Gross customer charges:         $265
Platform fee:                   -$30
Outbound label:                 -$12
Inventory cost/COGS:           -$130
Profit before other expenses:    $93
```

Sales tax should be recorded separately with who collected and remitted it. Do not silently combine or net source amounts.

## Income information to collect

### Per sale

- Item sale price before tax
- Shipping charged to customer
- Customer discount
- Gross customer charge
- Sales tax charged
- Tax collector: marketplace, seller, or neither
- Platform commission and fee details
- Outbound shipping paid by seller
- Refunds and allowances
- Net platform payout
- Sale date
- Delivery/acceptance date
- Payment-waiting date
- Paid/completed date
- Platform statement/order reference
- Related Forms 1099 and reconciliation notes

### Shipping distinctions

- **Shipping charged to customer:** revenue received from the customer.
- **Outbound shipping paid by seller:** selling expense for delivery to the customer/provider.
- **Inbound shipping paid by buyer/reseller:** acquisition cost associated with inventory/COGS.

### Discounts

- **Purchase discount:** lowers the item's actual inventory cost. An item with a $200 retail price bought for $120 has a $120 purchase cost; the $80 difference is not income.
- **Customer discount:** lowers the actual selling price. If an item is listed at $250 and sold with $20 off, record $230 as the actual sale price.
- Retail/list price can be retained as optional analytics metadata, but it is not inventory cost.

### Sales returns and allowances

- **Return:** the customer gives the item back and receives a refund.
- **Allowance:** the customer keeps the item but receives a partial refund, rebate, damage credit, or price adjustment.

For a return, collect refund date/amount, returned quantity, item condition, whether it returned to inventory, return shipping, and whether it is resellable.

### Platform commissions and fees

Examples include final-value fees, transaction fees, payment-processing fees, authentication fees, listing fees, promoted-listing fees, and cash-out processing fees. Keep fee type, amount, platform, date, refund/reversal, and related sale.

### Net payout

Net payout is the amount deposited by the platform after deductions the platform handled. It is a reconciliation amount, not gross or net profit.

A future payout model should support one payout containing multiple sales and one sale receiving later adjustments:

```text
Payout
 ├─ allocation to Sale A
 ├─ allocation to Sale B
 └─ allocation to Sale C
```

### Other business income

Possible reseller examples:

- Seller/platform incentive
- Referral or affiliate income
- Lost-shipment or shipping-insurance payment
- Chargeback recovery
- Vendor settlement
- Compensation for a cancelled order
- Barter or business credit

Do not automatically classify credit-card rewards, vendor rebates, or purchase refunds as other income. Capture the source, date, amount, related record, evidence, proposed classification, and confirmation.

## Inventory and cost of goods sold

### Recommended default

Profit Tracker's purchase-batch model naturally supports specific identification at actual cost. Use cost as the product default and do not automatically mark inventory down using marketplace listing prices.

### Cost example

```text
Purchase price:       $120
Nonrefunded tax:       $10
Inbound shipping:      $10
Inventory cost:       $140
```

### Lower of cost or market

This method compares each item's cost with its qualified market value on the inventory date and uses the lower value. It is a consistent tax method, not a one-off “current eBay price” adjustment.

Example:

```text
Cost:                 $300
Qualified market:     $220
Inventory value:      $220
```

If supported, require valuation date, evidence, source, explanation, and professional confirmation.

### Inventory method change

Examples include cost to lower-of-cost-or-market, changing cost-flow/identification methods, or changing the consistent treatment of material inventory costs. This is not the same as fixing a typo. Lock the selected method after filing/review and warn that a change may require professional review and Form 3115.

### Purchase adjustments

Track vendor adjustments against the original purchase:

- Merchandise return
- Partial vendor credit
- Price correction
- Damaged-item credit
- Coupon/rebate adjustment
- Sales-tax refund
- Inbound-shipping refund

Example of a later sales-tax refund:

```text
Original inventory cost:  $140
Tax refunded by vendor:   -$10
Adjusted inventory cost:   $130
```

Store adjustment type, amount, date, vendor, reason, purchase link, and credit memo/refund evidence.

### COGS calculation

Year-level concept:

```text
Beginning inventory
+ adjusted purchases and included inbound costs
− personal withdrawals and purchase returns/allowances
− ending inventory
= cost of goods sold
```

Batch example:

```text
Five units including allocated inbound cost: $525
Per-unit cost:                                $105
Two units sold → COGS:                        $210
Three units remain → ending inventory:        $315
```

The app should allocate applicable purchase price, nonrefunded purchase tax, inbound shipping, and other included acquisition costs, minus linked purchase adjustments. Platform fees and outbound shipping remain selling expenses.

## Full expense categories

Future Schedule C support should cover the form's relevant categories, including advertising, vehicle, commissions/fees, contract labor, depreciation, insurance, interest, professional services, office, rent/lease, repairs, supplies, taxes/licenses, travel, meals, utilities, wages, and itemized other expenses.

## Vehicle and mileage

### Recommended initial implementation

Do not build automatic GPS tracking first. Import Stride's mileage CSV, detect duplicates, and place trips in a review queue.

Vehicle profile:

- Description
- Date placed in business service
- Deduction method
- Beginning and ending odometer
- Business, commuting, and other/personal miles
- Personal availability
- Whether another personal vehicle exists

Trip record:

- Date
- Miles
- Origin/destination or route
- Business purpose
- Related purchase, sale, or shipment
- Source: Stride, manual, or future automatic tracking
- Import identifier
- Reviewed status

Track parking and tolls separately. Use tax-year-specific mileage rates rather than hardcoding a permanent rate.

## Equipment and depreciation

Equipment is used to operate the business over time; it is not merchandise purchased for resale.

Examples for resellers:

- Computer
- Label printer or scanner
- Barcode scanner
- Camera and product-photography lighting
- Shelving and storage racks
- Packing workstation
- Office furniture
- Safe/security equipment
- Dolly or hand truck
- Dedicated business phone
- Business vehicle

Distinguish:

| Item | Treatment candidate |
| --- | --- |
| Product purchased to resell | Inventory |
| Box, tape, or blank label consumed in fulfillment | Supply |
| Monthly software subscription | Software expense |
| Label printer used for several years | Equipment/asset |

Asset register fields:

- Asset name/category/description
- Vendor and receipt
- Purchase and placed-in-service dates
- Purchase price, tax, shipping, and total basis
- Business-use percentage
- Serial number/location when useful
- Proposed treatment: expense now, depreciation, Section 179, or review needed
- Disposal/loss date and proceeds
- User/accountant-confirmed treatment

The app should flag asset candidates but should not automatically decide depreciation treatment.

## Home office for resellers

### Guided eligibility questions

- Is the home the business's only fixed location?
- Is the area used regularly?
- Is it exclusively used for the business?
- If not exclusive, is it a separately identifiable inventory-storage area?
- Is the area used for administration, photography, packing, inventory storage, or multiple purposes?
- Total home square footage
- Business workspace square footage
- Inventory-storage square footage
- Months used
- Space/home changes during the year
- Simplified or actual-expense method
- Supporting measurement, floor plan, photo, and notes

### Dedicated workspace example

```text
Home:                    1,200 sq. ft.
Dedicated business room:   120 sq. ft.
```

At the 2025 simplified rate, the starting calculation is `120 × $5 = $600`, subject to qualification and limits.

### Inventory-storage example

A regularly used, separately identifiable garage area may qualify under the reseller inventory-storage exception when the home is the business's only fixed location, even if the storage area is not exclusively business use. Preserve the user's answers and evidence; do not automatically assert eligibility.

### Actual-expense fields

- Rent
- Mortgage interest
- Real-estate taxes
- Home insurance
- Utilities
- Repairs and maintenance
- Direct expenses for the business area
- Whole-home indirect expenses
- Business-use allocation

## Documentation and review

Preserve source transaction, receipt/invoice, platform statement, payment evidence, adjustment reason, reviewer, timestamp, accountant notes, tax year, form-mapping version, and export history.

All tax mappings must be versioned by tax year. Draft forms must not be treated as final filing authority.

## Reference material

- [IRS Schedule C and instructions](https://www.irs.gov/forms-pubs/about-schedule-c-form-1040)
- [IRS Publication 334 — Small Business](https://www.irs.gov/publications/p334)
- [IRS Publication 463 — Vehicle and travel records](https://www.irs.gov/publications/p463)
- [IRS Publication 538 — Accounting and inventory methods](https://www.irs.gov/publications/p538)
- [IRS Publication 587 — Business use of home](https://www.irs.gov/publications/p587)
- [IRS Publication 946 — Depreciation](https://www.irs.gov/publications/p946)
- [Stride tax-report export](https://support.stridehealth.com/hc/en-us/articles/12070355021335-What-is-a-CSV-file-and-how-do-I-open-my-tax-reports)

