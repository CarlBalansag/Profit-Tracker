# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/cashout-points4days | Points4Days live deals in Cashouts: sign in with the user's group login and read its deals table (read only, no commitments yet); one row per product when several cashouts list it | profit-tracker-api/services/cashouts/ (new parsefile.js, p4d.js; registry.js, service.js, commits.js, logPurchase.js), profit-tracker-api/routes/cashouts.js (log-purchase), profit-tracker-api/test/cashoutCommits.test.mjs, profit-tracker-api/validation/schemas.js (cashout connection schemas), profit-tracker-api/test/cashoutsP4d.test.mjs, profit-tracker-app/src/components/Settings/CashoutIntegrations.jsx, profit-tracker-app/src/pages/Cashout.jsx + Cashout.test.jsx, profit-tracker-app/src/utils/cashoutDeals.js + test (merge same-product deals across cashouts) | In progress | 2026-11-12 |
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
