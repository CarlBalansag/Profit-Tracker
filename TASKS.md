# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/mcp-refunds | AI assistant can record, list and remove refunds, using one shared refund service | profit-tracker-api/services/refunds.js, profit-tracker-api/routes/refunds.js, profit-tracker-api/routes/mcp.js, profit-tracker-api/test/mcpRefunds.test.mjs, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-04 |
