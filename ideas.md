add more into Expenses like store, taxes, convert make it work with schedule C plan thats in the works, also add payment method to work with credit card payments

figure out heiracy of statuses so we can add automations
for example when shipping outbound gets delivered change status to waiting for payment.

reciept to work with google drive to store pngs work in progress not important




ISSUES: URGENT

(Issues 1–10 and the old #12 "receipt/tracking data" from the original audit are resolved, confirmed non-issues, or explicitly dropped as not worth pursuing — see the `Audit` branch's commit log, 2026-10-01, one commit per issue. Only the one not yet fully closed is kept below.)

## 1. Transactions and outbound Shipping tables overflow the screen

**Update 2026-10-01: partially addressed via `Audit` branch; needs a manual browser check.** Code review found both tables already have most of "Work needed" in place, likely from earlier work this doc predates: a horizontal scroll container with a themed scrollbar (`overflow-x-auto` + `.table-scrollbar`), a synced top-scrollbar mirror on Transactions specifically (so the scroll affordance isn't buried below a tall table), and a full mobile card/stacked-row fallback below the `md` breakpoint for both. The one clearly-missing piece -- "freeze important columns or actions" -- is now done for Transactions: the row-selection checkbox (leftmost) and the edit/delete actions (rightmost) are `position: sticky` on both sides, using a solid background matched to the table's base color and its edit-row highlight color, so they stay visible and usable no matter how far the user has scrolled horizontally through the other ~15 configurable columns. Left Shipping's table alone -- it only has 3-4 fixed columns (not 15+ configurable ones), so it's far less likely to actually overflow and already has the same scroll-container + mobile-block fallback pattern. **This is a CSS/layout change I verified by code reading and the full automated test suite + build, not by rendering it in a browser** -- I don't have one available in this environment. Please sanity-check the sticky columns visually (especially during row-hover, where the sticky cell's background won't pick up the same subtle hover tint as the rest of the row) before considering this fully closed.

- The Transactions table is wider than the available viewport and gets cut off.
- The outbound Shipping table has the same problem.
- Important columns and row actions may be inaccessible without an obvious horizontal scrolling method.
- Work needed: add a clearly usable horizontal scroll container, freeze important columns or actions, hide lower-priority columns at smaller widths, and provide a responsive card or compact-table layout for narrow screens.

## Suggested priority

1. Manually verify the Transactions sticky-column fix in a browser (see issue #1's note — built but unverified without one).
