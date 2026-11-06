# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/cashout-deals | Cashout page: EB deals integration with encrypted key storage, background sync, payout history | profit-tracker-app/src/pages/Cashout.jsx, profit-tracker-app/src/App.jsx, profit-tracker-app/src/components/Layout/Sidebar.jsx, profit-tracker-app/src/hooks/useApi.js, profit-tracker-api/routes/cashouts.js, profit-tracker-api/services/cashouts/, profit-tracker-api/prisma/migrations/, profit-tracker-api/validation/schemas.js, profit-tracker-api/index.js | In progress | 2026-11-05 |
