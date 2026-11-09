# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/cashout-commitments-table-ui | Turn Commitments into a real tab (hides Live Deals), redesign its table to match the Deals table styling with item image/UPC and Bought/Committed At columns, fix column spacing, and show the sale's real workflow status instead of a made-up Active/Logged badge | profit-tracker-api/services/cashouts/commits.js, profit-tracker-app/src/pages/Cashout.jsx, profit-tracker-app/src/pages/Cashout.test.jsx | In progress | 2026-11-08 |
