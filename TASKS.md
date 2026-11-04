# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| fix/refund-locked-wording | Stop telling people to reopen a cancelled/returned sale to change its refunds, now that restored sales cannot be reopened | profit-tracker-api/routes/refunds.js, profit-tracker-app/src/components/TransactionDetailModal.jsx, profit-tracker-app/src/pages/refundsScreens.test.jsx | In progress | 2026-11-03 |
