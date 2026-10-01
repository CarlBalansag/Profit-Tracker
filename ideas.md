add more into Expenses like store, taxes, convert make it work with schedule C plan thats in the works, also add payment method to work with credit card payments

figure out heiracy of statuses so we can add automations
for example when shipping outbound gets delivered change status to waiting for payment.

reciept to work with google drive to store pngs work in progress not important




ISSUES: URGENT

(Issues 1–10 from the original audit are resolved — fixed or confirmed already-fixed and locked in with regression tests on the `Audit` branch, 2026-10-01. See that branch's commit log for what changed and why, one commit per issue. Only the two not yet fully closed are kept below.)

## 1. Transactions and outbound Shipping tables overflow the screen

**Update 2026-10-01: partially addressed via `Audit` branch; needs a manual browser check.** Code review found both tables already have most of "Work needed" in place, likely from earlier work this doc predates: a horizontal scroll container with a themed scrollbar (`overflow-x-auto` + `.table-scrollbar`), a synced top-scrollbar mirror on Transactions specifically (so the scroll affordance isn't buried below a tall table), and a full mobile card/stacked-row fallback below the `md` breakpoint for both. The one clearly-missing piece -- "freeze important columns or actions" -- is now done for Transactions: the row-selection checkbox (leftmost) and the edit/delete actions (rightmost) are `position: sticky` on both sides, using a solid background matched to the table's base color and its edit-row highlight color, so they stay visible and usable no matter how far the user has scrolled horizontally through the other ~15 configurable columns. Left Shipping's table alone -- it only has 3-4 fixed columns (not 15+ configurable ones), so it's far less likely to actually overflow and already has the same scroll-container + mobile-block fallback pattern. **This is a CSS/layout change I verified by code reading and the full automated test suite + build, not by rendering it in a browser** -- I don't have one available in this environment. Please sanity-check the sticky columns visually (especially during row-hover, where the sticky cell's background won't pick up the same subtle hover tint as the rest of the row) before considering this fully closed.

- The Transactions table is wider than the available viewport and gets cut off.
- The outbound Shipping table has the same problem.
- Important columns and row actions may be inaccessible without an obvious horizontal scrolling method.
- Work needed: add a clearly usable horizontal scroll container, freeze important columns or actions, hide lower-priority columns at smaller widths, and provide a responsive card or compact-table layout for narrow screens.

## 2. Receipt and inbound tracking data is incomplete

**Update 2026-10-01: verified via `Audit` branch -- confirmed genuine historical data gap, not a bug; partially addressed.** Queried production directly: **0 of 62** Inventory rows have a `receipt_url`, **0 of 62** have a `tracking_number` (worse than the 36/32 figures above, consistent with more unreceipted/untracked purchases accumulating since this doc was written) -- but `Sales.tracking_number` is set on 10 of 49 rows, proving tracking data *can* and does save correctly elsewhere. Traced the save path for inventory end to end: `AddTransaction.jsx` has a working "Tracking Number" input wired to `formData.tracking_number`, submitted unconditionally via `saveInventoryWithReceipt()`'s `JSON.stringify(formData)` to `POST /api/inventory`, which stores it with no validation gap. Nothing failed to migrate or load -- this is confirmed exactly as hedged in the original report: the user simply hasn't been filling these in, not a defect.

Given that, re-scoped "work needed" to what's actually missing:
- "Avoid treating unavailable historical data as a silent success" and a `-- *provide ... remediation tools*" are **already mostly in place**: `Receipts.jsx` has a dedicated "Without Receipt" tab (filterable, with a per-item attach flow) and `Shipping.jsx` has an "untracked" view with a per-row add-tracking-number form -- both already surface incompleteness rather than hiding it, and both already let you fix one record at a time.
- "Flag missing data during entry" was the one real gap -- added a non-blocking reminder banner in `AddTransaction.jsx`, shown when both the tracking number and the receipt are empty at submit time, pointing the user at Receipts/Shipping to finish later. Both fields remain optional; this only adds visibility.
- **Not built**: true bulk (multi-select-and-apply) remediation tooling. The existing one-at-a-time attach/add-tracking flows already cover the "avoid silent success" and "remediation tool" asks at a basic level; building actual bulk editing would be a standalone feature (UI for multi-select, a batch API endpoint, etc.), not a fix, and is left as a separate follow-up task rather than scope-creeping into this pass.

No dedicated test added for the `AddTransaction.jsx` banner -- it's a simple, directly-verifiable conditional on two already-initialized pieces of state, and the page has no existing test harness to extend (it would need mocking ~6 hooks from scratch for one small addition). Verified via the full build + existing suite (unaffected) instead. Full suite green: 79 frontend tests, build passes.

- All **36 records** are missing receipts.
- **32 inbound shipments** have no tracking number.
- This may be missing historical data rather than a calculation defect, but it prevents receipt coverage and shipping status features from being useful.
- Work needed: verify whether existing receipt and tracking data failed to migrate or load, provide bulk remediation tools, flag missing data during entry, and avoid treating unavailable historical data as a silent success.

## Suggested priority

1. Manually verify the Transactions sticky-column fix in a browser (see issue #1's note — built but unverified without one).
2. Decide whether to build true bulk receipt/tracking remediation tooling, or leave the existing one-at-a-time flows as sufficient (see issue #2).
