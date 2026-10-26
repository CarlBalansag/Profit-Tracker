# Status Workflow — Future Planning Notes

> Planning notes only. This document does not represent implemented behavior.

## Goal

Replace the current unrestricted status list with a small, trustworthy workflow. Routine actions—adding tracking, receiving an item, recording a sale, and recording a payout—should determine the next status. Users should not normally choose an arbitrary status from a large dropdown.

The first implementation should remain lean and efficient. Store one current receiving status on inventory and one current workflow status on each sale. Derive labels such as **Sold Out** from quantities instead of storing every possible condition as another status.

## Lean data model

### Inventory

Keep:

- `receiving_status` — the current state of the purchase arriving from the vendor
- `qty_purchased`
- `qty_on_hand`
- a listing attribute such as `is_listed` (or a listing record later)
- milestone dates such as `received_at`
- inbound tracking fields for the initial version

Inventory receiving progresses through:

```text
PRE_ORDER → PURCHASED → INBOUND → ON_HAND
```

- `PRE_ORDER` is optional and means the vendor has not released or fulfilled the item yet.
- `PURCHASED` means the order was placed but does not yet have active inbound tracking.
- `INBOUND` means inbound tracking was added and the shipment is being tracked.
- `ON_HAND` means the item was received. It is the successful terminal receiving status.
- Carrier `DELIVERED` should be stored as a milestone date/event and advance inbound inventory to `ON_HAND`; it does not need to remain the current status.

### Sale

Keep:

- `status` — the sale's one current fulfillment/payment workflow step
- `workflow_type` — the workflow selected when the sale was created
- outbound tracking fields
- milestone dates such as `delivered_at` and `paid_at`

The common sale progression is:

```text
AWAITING_SHIPMENT → OUTBOUND → [workflow-specific steps]
                  → WAITING_FOR_PAYMENT → PAID
```

- Show `AWAITING_SHIPMENT` to the user as **Sold — Waiting to Ship**.
- `OUTBOUND` replaces the user-facing term `SHIPPED_OUT`.
- `PAID` is the successful final sale state. A separate `COMPLETED` status is unnecessary.
- Exceptions such as `CANCELLED`, `RETURN_IN_PROGRESS`, `RETURNED`, `DISPUTED`, and `AUTHENTICATION_FAILED` can be sale status values outside the normal forward path.

### Listing and availability

Listing is not a receiving or shipping status:

```text
UNLISTED ↔ LISTED
```

Availability should normally be calculated:

```text
qty_on_hand > 0  → available inventory
qty_on_hand = 0  → SOLD_OUT
```

`SOLD_OUT` is a derived label, not another stored receiving status.

## What happens to ON_HAND after a sale

The inventory receiving status remains `ON_HAND`. It answers whether the purchase was successfully received. Creating a sale starts a separate sale workflow and reduces the available quantity.

Example: purchase five units and sell two.

```text
Inventory receiving: ON_HAND
Quantity purchased: 5
Quantity on hand: 3

Linked sale quantity: 2
Linked sale status: AWAITING_SHIPMENT
```

After adding outbound tracking:

```text
Inventory receiving: ON_HAND
Quantity on hand: 3
Linked sale status: OUTBOUND
```

The interface can emphasize the most useful current information without overwriting the receiving history:

```text
3 available · 2 outbound
```

For a single-unit item after it sells:

```text
Stored receiving status: ON_HAND
Stored quantity on hand: 0
Stored sale status: AWAITING_SHIPMENT

Displayed status: Sold — Waiting to Ship
Availability: Sold Out
```

This is necessary for multi-unit purchases because separate units may be on hand, outbound, returned, and paid at the same time.

## Database efficiency

A normal status change replaces the current value on the existing row. It does not delete the record or create another active status record.

Conceptually:

```sql
UPDATE "Sales"
SET status = 'OUTBOUND'
WHERE id = :sale_id;
```

When the sale advances to `WAITING_FOR_PAYMENT`, that value replaces `OUTBOUND` on the same sale row.

The initial version should store only:

- the current inventory receiving status
- the current sale status
- quantities
- workflow type
- tracking information
- important milestone dates
- optional meaningful correction/audit events

Do not create history for page views, unsuccessful carrier checks, or repeated checks returning the same result. If history is implemented, retain only meaningful business events such as tracking added, delivered, paid, cancelled, voided, returned, disputed, or corrected.

## Platform-specific sale workflows

Each sale receives a workflow when it is created.

### Standard marketplace

```text
AWAITING_SHIPMENT → OUTBOUND → DELIVERED event
                  → WAITING_FOR_PAYMENT → PAID
```

### Authentication marketplace

```text
AWAITING_SHIPMENT → OUTBOUND → DELIVERED_TO_AUTHENTICATOR
                  → AUTHENTICATING → WAITING_FOR_PAYMENT → PAID
```

Authentication failure follows an exception/return path:

```text
AUTHENTICATING → AUTHENTICATION_FAILED
               → RETURN_IN_PROGRESS → RETURNED
```

Do not restore inventory merely because authentication failed. Restore it only when the returned item has physically arrived and been accepted.

### Cash-out or buyback provider

```text
AWAITING_SHIPMENT → OUTBOUND → DELIVERED_TO_PROVIDER
                  → WAITING_FOR_SCAN_IN → SCANNED_IN
                  → [ACCEPTED when required]
                  → WAITING_FOR_PAYMENT → PAID
```

`SCANNED_IN` remains useful here as a cash-out workflow step, not as a universal inventory receiving status.

### Direct or local sale

```text
AWAITING_HANDOFF → HANDED_OVER → WAITING_FOR_PAYMENT → PAID
```

If payment and handoff happen together, the action can move directly to `PAID`. If payment arrives before handoff, record `paid_at` while keeping the sale actionable until the item is handed over.

## Workflow configuration

Suggested workflow presets:

- Standard marketplace
- Authentication marketplace
- Cash-out / buyback
- Direct / local
- Custom workflow later

Suggested platform capabilities:

- Requires shipping
- Requires tracking
- Requires authentication
- Requires provider scan-in
- Requires provider acceptance
- Event that begins waiting for payment
- Allows local handoff

Known platforms can receive sensible defaults. Custom platforms should ask the user to select the closest preset.

Copy the chosen workflow onto the sale when it is created. Changing a platform's default workflow later must not change old sales.

## Contextual actions

Replace the unrestricted status dropdown with a read-only current status and actions that make sense for the current record.

| Current state | Primary actions |
| --- | --- |
| Pre-order | Mark Purchased, Cancel |
| Purchased | Add Tracking, Mark On Hand |
| Inbound | Check Tracking, Mark On Hand |
| On Hand | List Item, Record Sale |
| Listed | Record Sale, Unlist |
| Sold — Waiting to Ship | Add Outbound Tracking |
| Outbound | Check Tracking |
| Authenticating | Mark Passed, Mark Failed |
| Waiting for Scan-In | Mark Scanned In |
| Scanned In | Mark Accepted when required |
| Waiting for Payment | Mark Paid |
| Paid | No normal action required |

Secondary exception actions can appear under a **More** menu: Cancel, Void Mistaken Sale, Report Return, Report Dispute, Correct Mistake, or Reopen.

The user performs a real-world action and the server determines the resulting status. Saving inbound tracking moves `PURCHASED` to `INBOUND`; the user does not select `INBOUND` manually.

## Confirmation and undo policy

Confirmations should protect important data without slowing down normal entry.

### Routine, reversible actions: no confirmation

Perform these immediately and show a temporary Undo message:

- Add tracking
- Check tracking
- Mark on hand
- List or unlist
- Mark scanned in
- Mark authentication passed
- Submit a properly completed sale form
- Submit a completed Mark Paid form

Example:

```text
Sale recorded — 2 units removed from inventory. Undo
```

The form's **Save** button is already the user's confirmation. Do not show another “Are you sure?” dialog after it.

### Actions requiring information: one form, no second confirmation

- Record Sale — quantity, price, platform, workflow
- Mark Paid — payment date, amount, optional reference
- Report Return — quantity, reason, refund amount when applicable

Saving the form performs the action.

### Destructive or unusual actions: explicit confirmation

Require confirmation for:

- Void a sale
- Cancel after outbound shipment
- Cancel a multi-unit order when quantities will change
- Reopen a paid sale
- Report a return or dispute when financial records will change
- Mark authentication failed
- Remove or replace tracking after delivery
- Restore or remove inventory manually
- Change the quantity of a paid sale

The confirmation must explain the consequence:

```text
Void this sale?

2 units will be restored to inventory, and the sale will be excluded
from financial reports.
```

## Mistakes and corrections

Contextual actions must not trap users.

The transaction detail view should provide:

- Edit sale
- Void mistaken sale
- Correct workflow step
- Cancel actual sale
- Report return
- Report dispute
- Reopen a paid sale with confirmation

Meanings:

- **Void mistaken sale:** the sale should never have existed. Restore its quantity and exclude it from financial reporting.
- **Cancel sale:** a real sale existed but was cancelled. Preserve the record and restore inventory when appropriate.
- **Return:** preserve the original sale and payment; restore inventory only after the item is received and accepted.
- **Dispute:** preserve the current inventory position until the dispute is resolved.
- **Correct mistake:** the transaction is real, but an incorrect workflow step was recorded.

Changes affecting both sale and inventory must be atomic. Voiding a two-unit sale must restore two units and void the sale together, or save neither change.

## Tracking automation

### Initial version

Keep carrier checks user-triggered to control API usage.

- Add inbound tracking: `PURCHASED → INBOUND`.
- Manual carrier check reports delivered inbound: record `delivered_at`, set `received_at`, and move to `ON_HAND`.
- Add outbound tracking: `AWAITING_SHIPMENT → OUTBOUND`.
- Manual carrier check reports delivered outbound: record `delivered_at` and advance according to the sale's stored workflow.
- Standard marketplace delivery normally advances to `WAITING_FOR_PAYMENT`.
- Authentication delivery advances to `AUTHENTICATING`.
- Cash-out delivery advances to `WAITING_FOR_SCAN_IN`.

Repeated checks must be idempotent and must never move a record backward. Carrier errors, unknown statuses, and rate-limit responses must not change the business status.

When multiple items share one physical tracking number, check the carrier once and apply the normalized result to every related record. Do not spend one carrier API request per row for the same package.

Removing a tracking number must not automatically move a delivered or later-stage record backward. Replacing tracking should clear stale carrier data and record that the tracking number was corrected.

For the first version, carrier delivery can automatically advance inbound inventory to `ON_HAND`, with Undo and a **Report Delivery Issue** action. A future user preference may allow requiring manual receipt confirmation instead.

### Future version

Background polling or carrier webhooks can call the same transition service. Automatic checks should be limited to active shipments, use backoff, and stop once a shipment is terminal.

A dedicated `Shipment` model can be added later if the product needs partial shipments, multiple packages for one sale, or many items in one package. It is not required for the lean first implementation.

## Important milestones and optional history

Milestone columns preserve the most useful facts without requiring a large event system:

- `received_at`
- `delivered_at`
- `paid_at`
- optional cancellation, return, or correction timestamps

If an event history is implemented, useful events include:

- Tracking added or replaced
- Carrier delivered
- Provider scanned in
- Authentication passed or failed
- Payment became available
- Paid
- Corrected, voided, cancelled, returned, or disputed

The current status answers “What needs attention now?” Milestones and events answer “What happened?”

## Completion rule

`PAID` is the normal completed sale state. Marking paid should record the payment date, amount, and an optional reference rather than changing only a label.

Paid sales leave active shipping and payment queues but remain in transaction history, analytics, profit reports, Schedule C data, and cash-flow history. A later return, dispute, or chargeback may explicitly reopen the transaction without deleting the original payment.

## Legacy status migration

Normalize stored values to uppercase constants and migrate carefully:

- `Pre Order` → `PRE_ORDER`
- `PURCHASED` remains `PURCHASED`
- `SHIPPED_IN` → `INBOUND`
- inbound `DELIVERED` or `SCANNED_IN` → `ON_HAND` when supported by the record's meaning
- `LISTED` → receiving status plus the listing attribute
- `SOLD` → `AWAITING_SHIPMENT`
- `SHIPPED_OUT` → `OUTBOUND`
- `AUTHENTICATION` → `AUTHENTICATING`
- `COMPLETED` → `PAID` only where it meant payout confirmed

Do not blindly migrate an inventory status of `SOLD`, `PAID`, or another sale-only value. Use linked sales and quantities to reconstruct the correct inventory receiving/availability display. Keep a migration report for ambiguous records.

## Implementation order

1. Define canonical statuses, display labels, and allowed transitions in one shared registry.
2. Add or rename the inventory receiving status and sale workflow fields.
3. Add workflow type and milestone dates.
4. Write and test the legacy-status migration.
5. Build one server-side transition service; do not scatter transition rules through route handlers.
6. Add action endpoints and return allowed actions with each record.
7. Replace unrestricted dropdowns with contextual actions, Undo, and correction tools.
8. Connect manual carrier checks to the transition service.
9. Update Shipping, Inventory, Transactions, Cash Flow, Dashboard, Credit Card, Tax Exempt, analytics, and the Guide to use the same registry.
10. Add authentication and cash-out presets after the standard inbound/outbound path is stable.
11. Add background tracking or a full Shipment model only when needed.

## Required QA when implemented

- Normal inbound and outbound progression
- Inventory receiving remains `ON_HAND` after partial and complete sales
- One-unit and multi-unit inventory
- Derived available and sold-out labels
- Partial sales from multi-unit purchases
- Every enabled platform workflow preset
- Adding, editing, replacing, and removing tracking
- Shared tracking numbers use one carrier request
- Repeated tracking checks and duplicate delivery responses
- Carrier errors, unknown statuses, and rate limiting
- Authentication and scan-in success/failure
- Mark paid and reopen
- Routine actions without confirmation and destructive-action confirmations
- Immediate Undo and later correction
- Void versus cancel versus return
- Returns restore inventory only after receipt/acceptance
- Concurrent actions and atomic quantity restoration
- Ownership checks for every related record
- Legacy migration, including ambiguous data
- Consistency across Shipping, Inventory, Transactions, Cash Flow, Dashboard, Credit Card, Tax Exempt, Schedule C, and analytics
