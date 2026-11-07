# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/cashout-auto-grant | Replace CASHOUT_BETA_USER_IDS with a DB flag auto-granted on a verified cashout key | profit-tracker-api/prisma/schema.prisma, profit-tracker-api/services/cashouts/registry.js, profit-tracker-api/services/cashouts/service.js, profit-tracker-api/test/cashouts.test.mjs, profit-tracker-app/src/pages/Cashout.jsx, profit-tracker-app/src/pages/Cashout.test.jsx | In progress | 2026-11-06 |
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
