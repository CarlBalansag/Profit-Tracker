# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/settings-data-reset | Settings > Data reset: transactions only or everything, with confirmation | profit-tracker-api/routes/dataReset.js, profit-tracker-api/services/dataReset.js, profit-tracker-api/validation/schemas.js, profit-tracker-api/index.js, qa/harness.cjs, profit-tracker-app/src/pages/Settings.jsx, profit-tracker-app/src/components/Settings/DataReset.jsx, profit-tracker-app/src/components/UI/ConfirmDialog.jsx, profit-tracker-app/src/hooks/useApi.js | In progress | 2026-11-06 |
