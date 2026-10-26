# Tax-Exempt Tracking for Resellers — Future Planning Notes

> Planning and recordkeeping notes only. The current Tax Exempt work remains separate. Sales-tax rules vary by jurisdiction, so the app should preserve facts and documents rather than promise that an exemption is valid.

## Reseller-only scope

Profit Tracker only needs to support three tax-handling situations:

1. The reseller buys inventory tax-free for resale.
2. The reseller sells inventory tax-free to another reseller or cash-out company that provides a resale certificate.
3. A marketplace facilitator collects and remits customer sales tax.

These are different situations and must not share one generic `Tax Exempt` switch.

## 1. Buying inventory tax-free for resale

Example:

```text
The user buys shoes from a vendor.
The user provides a resale certificate.
The vendor does not charge sales tax.
The shoes are intended for resale.
```

### Business resale profile

- Purchaser legal/business name
- Purchaser business address
- Issuing state/jurisdiction
- Seller's permit or resale registration number
- Effective and expiration dates when applicable
- Certificate form/type
- Authorized signer and title
- Signed certificate upload
- Verification status, date, and source
- Revoked/replaced date

### Per purchase

- Was the item purchased using a resale exemption?
- Certificate used
- Vendor
- Purchase/delivery jurisdiction
- Description of property covered
- Was the certificate accepted?
- Was sales tax still charged?
- Was tax later refunded?
- Related receipt/credit memo
- Did the item later leave resale inventory for personal/business use?
- Use-tax review required: Yes/No/Needs review

The ordinary purchase form can remain short:

```text
Purchased using resale exemption? Yes / No
Certificate used: [select]
Sales tax charged: $____
```

## Purchase adjustments and tax refunds

If the vendor refunds sales tax after accepting a resale certificate, link the refund to the original purchase and reduce its inventory cost.

Example:

```text
Original item cost:             $120
Sales tax initially paid:        $10
Inbound shipping:                $10
Original inventory cost:        $140
Later vendor tax refund:        -$10
Adjusted inventory cost:        $130
```

Store adjustment type, amount, date, vendor, reason, purchase link, and evidence. A full vendor return should reverse the purchase and remove/reconcile the inventory quantity.

## 2. Selling to a reseller or cash-out company

Example:

```text
A cash-out company purchases the user's inventory for resale.
The cash-out company provides a valid resale certificate.
The user does not collect sales tax on the covered sale.
```

### Buyer/cash-out certificate

- Buyer legal name and address
- Buyer type: reseller, cash-out/buyback, government, or other supported type
- Exemption reason: resale
- Permit/certificate number
- Issuing state/jurisdiction
- Certificate form/type
- Single transaction or blanket certificate
- Effective, expiration, and revocation dates
- Authorized signer and date
- Certificate upload
- Property covered
- Verification status/date/source

### Per sale

- Buyer/cash-out provider
- Exemption reason
- Certificate that covered the sale
- Delivery/destination jurisdiction
- Taxable amount that would otherwise apply
- Tax collected, if any
- Snapshot of certificate details at the time of sale
- Supporting order/statement

A blanket certificate may cover repeated qualifying sales, but historical transactions must retain the certificate/version and effective dates that applied when each sale occurred.

## 3. Marketplace facilitator collected the tax

Example:

```text
The user sells to an ordinary customer through eBay.
eBay collects and remits the customer's sales tax.
The customer is not tax exempt.
```

This should be recorded as marketplace tax handling, not as `customer_tax_exempt`.

### Platform profile

- Marketplace facilitator: Yes/No
- Marketplace legal name/address
- Jurisdictions where it collects
- Registration/permit number per jurisdiction when available
- Collection effective date per jurisdiction
- Certificate of collection or marketplace agreement
- Document/version
- Expiration or termination date
- Verification date

### Per sale

- Marketplace-facilitated: Yes/No
- Delivery destination/jurisdiction
- Sale taxable or exempt
- Tax charged to customer
- Tax collector: marketplace, seller, or neither
- Applicable marketplace registration/agreement
- Order/statement evidence

## Recommended sale-tax choices

Replace a broad customer-exempt boolean with a required tax-handling choice:

- Marketplace collected and remitted
- Seller collected and will remit
- Buyer provided resale certificate
- No tax collected — needs review

If the user selects **Buyer provided resale certificate**, request the certificate. If the user selects **Marketplace collected**, do not mark the buyer as exempt.

## Recommended platform tax role

Replace `Tax Exempt Place` with a more precise platform role:

- Marketplace facilitator
- Resale/cash-out buyer
- Ordinary marketplace/channel
- Direct-sale channel

Platform settings should be effective-dated. Changing a platform setting must not retroactively rewrite every historical sale. Each sale needs an immutable tax-treatment snapshot, with explicit correction history if changed later.

## Current metric concern

The existing **Use Tax Due** metric sums sales tax recorded on exempt purchases. Sales tax already paid is not automatically use tax due.

Until real use-tax review logic exists, rename this metric to:

```text
Sales Tax Paid on Exempt Purchases
```

A future **Use Tax Review** queue can flag inventory bought tax-free that was later consumed, used personally, given away, or otherwise removed from resale inventory.

## Minimal data model concepts

### ResaleCertificate

- Owner user
- Holder/buyer identity
- Jurisdiction and permit number
- Certificate type
- Single/blanket scope
- Effective/expiration/revocation dates
- Document
- Verification metadata

### PurchaseTaxTreatment

- Inventory/purchase
- Exempt-for-resale status
- Certificate
- Jurisdiction
- Tax charged
- Tax refund/adjustment links
- Use-tax review state

### SaleTaxTreatment

- Sale
- Tax-handling choice
- Destination jurisdiction
- Taxable amount
- Tax collected
- Collector
- Exemption certificate or facilitator evidence
- Historical snapshot and correction metadata

### MarketplaceFacilitatorRegistration

- Platform
- Jurisdiction
- Permit/registration number
- Collection effective/end dates
- Supporting document/agreement

## UX principles

- Ask simple transaction questions and move document details into reusable profiles.
- Reuse valid blanket certificates rather than repeatedly typing them.
- Show missing, expired, or unverified certificate warnings.
- Never silently mark every platform sale exempt.
- Separate “tax not charged because buyer is exempt” from “tax collected by marketplace.”
- Store objective source facts; let the user/accountant confirm final treatment.
- Preserve historical evidence and effective dates.

## Required QA when implemented

- Tax-exempt purchase with valid certificate
- Tax paid despite exemption and later refunded
- Full/partial vendor refund
- Cash-out sale covered by blanket certificate
- Certificate expiration/replacement
- Marketplace facilitator collection by jurisdiction/effective date
- Direct sale where seller collected tax
- Unknown/no-tax case entering review queue
- Platform-setting edits do not rewrite history
- Ownership and document-access isolation
- Purchase cost/COGS adjusted consistently after refunds
- Tax Exempt page, Transactions, Inventory, and exports agree

## Reference material

- [MTC Uniform Sales & Use Tax Resale Certificate](https://www.mtc.gov/Resources/Uniform-Sales-Use-Tax-Exemption-Certificate/)
- [MTC certificate FAQ](https://www.mtc.gov/resources/faq-uniform-sales-and-use-tax-certificate/)
- [California valid resale-certificate requirements](https://cdtfa.ca.gov/formspubs/pub103/valid-resale-certificates.htm)
- [New York exemption-certificate guidance](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/exemption_certificates_for_sales_tax.htm)
- [MTC Marketplace Facilitator Tax Collection Certificate](https://www.mtc.gov/wp-content/uploads/2026/04/Marketplace-Facilitator-Tax-Collection-Certificate-4-9-26.pdf)
- [California Marketplace Facilitator Tax Guide](https://cdtfa.ca.gov/industry/MPFAct.htm)

