# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| `Audit` | Fix all 12 `ideas.md` "ISSUES: URGENT" findings (dashboard/transactions cost mismatch, inventory value formulas, lifecycle status labeling, tax-exempt deductions, card tracker scope labeling, goal progress/period, payment-method spend, sign-in flow, accounts relationship, silent errors, table overflow, missing receipt/tracking data) | `selvora-app/src/pages/*`, `selvora-app/src/components/*`, `selvora-api/routes/*`, `selvora-api/services/*` (broad — spans most of the app; see `ideas.md` for the full list) | **Ready for review** — all 12 fixed/confirmed across 11 commits, full suite green, not yet merged | 2026-10-01 |
