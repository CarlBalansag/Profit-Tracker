# Date display shows the wrong calendar day — findings for a future task

Not part of the status-workflow rework. Logged here per `AGENTS.md`'s rule to
record unrelated issues found during other work rather than folding them in.

## What's reported

Dates sometimes display one day earlier than they should — e.g. a sale dated
Oct 3 shows as Oct 2 somewhere in the app. Reported as "sometimes," i.e.
inconsistent across screens, which matches the root cause below.

## Root cause

Date-only values (`sale_date`, `purchase_date`, and similar) are stored in
some write paths as UTC-midnight timestamps. When displayed via
`new Date(x).toLocaleDateString()` — which formats in the *browser's local*
timezone — anyone in a US timezone (west of UTC) can see that UTC-midnight
value roll back to the previous calendar day.

The team already has a fix for this pattern in one place: `selvora-api`'s
action-payload date parsing (`parseActionDate` in
`services/statusTransitions.js`, and the sibling helper in
`routes/sales.js`/`routes/inventory.js`) reads a date-only input as **local
noon** instead of midnight specifically so it can't roll into the previous
day after a timezone conversion. That fix is not applied to every write path
or every display call site, which is why the bug is intermittent rather than
constant.

## Where it shows up

`new Date(...).toLocaleDateString()` (no explicit timezone) is used in at
least 22 frontend files, found via:

```
grep -rln "toLocaleDateString" selvora-app/src/pages selvora-app/src/components --include="*.jsx"
```

Confirmed call sites include (not exhaustive — re-run the grep above for the
current list before starting the fix):

- `selvora-app/src/pages/AddSale.jsx`
- `selvora-app/src/pages/AddTransaction.jsx`
- `selvora-app/src/pages/Analytics.jsx`
- `selvora-app/src/pages/CashFlow.jsx`
- `selvora-app/src/pages/CreditCard.jsx`
- `selvora-app/src/pages/Dashboard.jsx`
- `selvora-app/src/pages/Expenses.jsx`
- `selvora-app/src/pages/Receipts.jsx`

## What the user asked for

A per-user timezone preference (e.g. PST/EST), set in Dashboard/Settings,
that every date display in the app consistently uses — rather than relying
on (and being at the mercy of) the viewer's browser-local timezone.

## Scope note for whoever picks this up

This is two related but separable pieces of work:

1. **Bug fix**: stop storing/reading date-only values in a way that can roll
   across a day boundary (apply the existing "local noon" pattern
   consistently, or better, store/compare as plain date strings with no
   time-of-day component at all where the field is truly date-only).
2. **New feature**: a stored per-user timezone preference, a settings UI
   control for it, and a shared date-formatting utility (used everywhere
   instead of ad hoc `toLocaleDateString()` calls) that formats against the
   chosen timezone instead of the browser's.

(2) depends on getting (1) right first — a timezone preference doesn't help
if the underlying stored value is already ambiguous about which day it means.
